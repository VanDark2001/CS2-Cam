"""Optional, isolated replay visual extraction; never rewrites match statistics.

The parser's documented parse_grenades stream supplies real projectile points:
https://github.com/LaihoE/demoparser/blob/main/documentation/js/README.md
"""
import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys

from db_schema import connect, settings

VISUAL_EVENTS = ('weapon_fire', 'grenade_thrown', 'hegrenade_detonate', 'decoy_started', 'decoy_detonate')
VISUAL_VERSION = 2


def load_env():
    env_file = Path(__file__).with_name('.env')
    if env_file.is_file():
        for line in env_file.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('\"\''))


def database():
    config = settings()
    return connect(config['user'], config['password'], config['database'])


def safe_json(value):
    if isinstance(value, dict):
        return {key: safe_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe_json(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def trajectories(rows, official_tick):
    """Entity IDs can be reused. Split on owner/type changes or tick gaps."""
    groups = {}
    result = []
    for row in sorted(rows, key=lambda item: int(item.get('tick', 0))):
        tick = int(row.get('tick', 0))
        coords = [row.get(axis) for axis in ('x', 'y', 'z')]
        if tick < official_tick or any(v is None or not math.isfinite(float(v)) for v in coords):
            continue
        entity = row.get('grenade_entity_id', row.get('entity_id'))
        if entity is None:
            continue
        sid = str(row.get('steamid') or '')
        kind = str(row.get('grenade_type') or '')
        key = (str(entity), sid, kind)
        current = groups.get(key)
        if current is None or tick - current['points'][-1][0] > 64:
            current = {'entity_id': entity, 'steamid': sid, 'grenade_type': kind, 'points': []}
            groups[key] = current
            result.append(current)
        # Four-tick samples keep bounces visible without sending every entity tick.
        point = [tick, *[round(float(value), 3) for value in coords]]
        if current['points'] and tick - current['points'][-1][0] < 4:
            current['_last'] = point
        else:
            current['points'].append(point)
            current.pop('_last', None)
    for item in result:
        last = item.pop('_last', None)
        if last is not None:
            item['points'].append(last)
    return [item for item in result if len(item['points']) >= 2]


def extract(match_id):
    from demoparser2 import DemoParser
    connection = database()
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT demo_file_path,COALESCE(official_start_tick,0) FROM matches WHERE id=?', (match_id,))
            match = cursor.fetchone()
        if not match or not Path(match[0]).is_file():
            raise ValueError('Demo file is unavailable')
        parser = DemoParser(match[0])
        entries = []
        features = []
        for event in VISUAL_EVENTS:
            try:
                frame = parser.parse_event(event, player=['X', 'Y', 'Z', 'yaw'])
                rows = frame.to_dict(orient='records') if hasattr(frame, 'to_dict') else []
                for row in rows:
                    tick = int(row.get('tick', 0))
                    if tick >= match[1]:
                        entries.append((event, tick, row.get('user_steamid'), row.get('user_name'), safe_json(row)))
                features.append(event)
            except Exception as error:
                print(f'[replay-effects] {event}: {type(error).__name__}', file=sys.stderr)
        try:
            paths = trajectories(parser.parse_grenades().to_dict(orient='records'), match[1])
            for path in paths:
                entries.append(('grenade_trajectory', path['points'][0][0], path['steamid'] or None, None, path))
            features.append('grenade_trajectory')
        except Exception as error:
            print(f'[replay-effects] trajectories: {type(error).__name__}', file=sys.stderr)
        # Replace only the optional visual stream after extraction succeeds.
        with connection.cursor() as cursor:
            names = (*VISUAL_EVENTS, 'grenade_trajectory', 'replay_effects_ready')
            cursor.execute('DELETE FROM events WHERE match_id=? AND event_name IN (' + ','.join(['?'] * len(names)) + ')', (match_id, *names))
            cursor.executemany('INSERT INTO events(match_id,event_name,tick,player_steamid,player_name,is_warmup,data_json) VALUES(?,?,?,?,?,0,?)', [
                (match_id, event, tick, sid, name, json.dumps(data, ensure_ascii=False, default=str, allow_nan=False))
                for event, tick, sid, name, data in entries
            ])
            cursor.execute("SELECT DISTINCT tick FROM events WHERE match_id=? AND event_name='round_prestart' AND tick>=?", (match_id, match[1]))
            ready_ticks = {match[1], *[row[0] for row in cursor.fetchall()]}
            cursor.executemany('INSERT INTO events(match_id,event_name,tick,is_warmup,data_json) VALUES(?,?,?,0,?)', [
                (match_id, 'replay_effects_ready', tick, json.dumps({'version': VISUAL_VERSION, 'features': features}))
                for tick in ready_ticks
            ])
        connection.commit()
        print(f'[replay-effects] match {match_id}: {len(entries)} events, features={",".join(features)}', flush=True)
    finally:
        connection.close()


def main():
    load_env()
    cli = argparse.ArgumentParser()
    cli.add_argument('--match', type=int)
    cli.add_argument('--all', action='store_true')
    args = cli.parse_args()
    if args.match:
        extract(args.match)
    elif args.all:
        connection = database()
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM matches m WHERE NOT EXISTS(SELECT 1 FROM events e WHERE e.match_id=m.id AND e.event_name='replay_effects_ready' AND JSON_EXTRACT(e.data_json,'$.version')=?) ORDER BY id DESC", (VISUAL_VERSION,))
            ids = [row[0] for row in cursor.fetchall()]
        connection.close()
        failed = []
        for match_id in ids:
            # A native parser crash cannot corrupt another match or stop the batch.
            try:
                worker = subprocess.run([sys.executable, __file__, '--match', str(match_id)], timeout=240)
                if worker.returncode:
                    failed.append(match_id)
            except subprocess.TimeoutExpired:
                failed.append(match_id)
        if failed:
            print(f'[replay-effects] unavailable matches: {failed}', file=sys.stderr)
            return 1
    else:
        cli.error('Specify --match ID or --all')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
