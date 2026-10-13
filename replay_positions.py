"""Validated replay snapshots and atomic position-only repair for old imports."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

POSITION_FIELDS = [
    'X', 'Y', 'Z', 'yaw', 'health', 'm_ArmorValue', 'armor_value',
    'm_bHasDefuser', 'has_defuser', 'm_bHasHelmet', 'has_helmet', 'team_num',
    'player_steamid', 'steamid', 'is_alive', 'm_iAccount', 'balance',
    'm_pInGameMoneyServices.m_iAccount', 'money', 'weapon', 'active_weapon_name',
    'm_hActiveWeapon', 'm_pClippingWeapon', 'inventory', 'm_hMyWeapons', 'm_pWeaponServices',
    'CCSPlayerController.m_hPlayerPawn', 'entity_id',
]
CORE_FIELDS = ['X', 'Y', 'Z', 'yaw', 'health', 'm_ArmorValue', 'team_num', 'player_steamid', 'steamid', 'is_alive', 'CCSPlayerController.m_hPlayerPawn', 'entity_id']
INSERT_SQL = (
    'INSERT INTO player_positions(match_id,tick,steamid,x,y,z,yaw,health,armor,alive,team_number,money,weapon,inventory) '
    'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
)


def steamid(value):
    value = str(value or '').strip()
    if value.endswith('.0') and value[:-2].isdigit():
        value = value[:-2]
    return value if value.isdigit() and value != '0' else ''


def finite(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None


def handle_mismatches(rows):
    result = set()
    for row in rows:
        handle, entity = row.get('CCSPlayerController.m_hPlayerPawn'), row.get('entity_id')
        if finite(handle) is None or finite(entity) is None:
            continue
        handle = int(handle)
        if handle in (0xFFFFFF, 0xFFFFFFFF):
            continue
        if (handle & 0x3FFF) != int(entity):
            result.add(steamid(row.get('steamid')))
    return result - {''}


def needs_handle_fallback(parser, official_tick):
    fields = ['CCSPlayerController.m_hPlayerPawn', 'entity_id', 'X', 'Y']
    try:
        rows = parser.parse_ticks(fields, ticks=[official_tick + offset for offset in (64, 4096, 16384)])
        return handle_mismatches(rows.to_dict(orient='records'))
    except Exception as error:
        print(f'[positions] handle probe unavailable: {type(error).__name__}', file=sys.stderr)
        return set()


def exporter():
    packaged = os.getenv('CS2_REPLAY_EXPORTER')
    if packaged:
        binary = Path(packaged)
        if not binary.is_file():
            raise RuntimeError('Bundled replay exporter is missing: ' + str(binary))
        return binary
    directory = Path(__file__).parent / 'tools' / 'replay_positions'
    binary = directory / ('replay_positions.exe' if os.name == 'nt' else 'replay_positions')
    sources = [directory / name for name in ('main.go', 'go.mod', 'go.sum')]
    if not binary.is_file() or any(source.stat().st_mtime > binary.stat().st_mtime for source in sources):
        go = shutil.which('go')
        if not go:
            raise RuntimeError('Replay exporter is missing or outdated; build tools/replay_positions with Go 1.24+')
        subprocess.run([go, 'build', '-o', str(binary), '.'], cwd=directory, check=True, timeout=120)
    return binary


@contextmanager
def exported_positions(demo, official_tick, roster):
    with tempfile.TemporaryDirectory(prefix='csdemo-positions-') as temporary:
        path = Path(temporary) / 'positions.ndjson'
        result = subprocess.run(
            [str(exporter()), '-demo', str(Path(demo).resolve()), '-output', str(path), '-start', str(official_tick)],
            capture_output=True, text=True, encoding='utf-8', timeout=240,
        )
        if result.returncode:
            raise RuntimeError(f'Replay extraction failed ({result.returncode}): {result.stderr[-3000:]}')
        summary = json.loads(result.stderr.strip().splitlines()[-1])
        missing = set(roster) - set(summary.get('players', {}))
        if missing:
            raise RuntimeError('Replay extraction has no coordinates for: ' + ','.join(sorted(missing)))
        print('[positions] validated demoinfocs coverage:', len(roster), 'players', file=sys.stderr)
        with path.open(encoding='utf-8') as stream:
            yield (json.loads(line) for line in stream)


@contextmanager
def position_stream(parser, demo, official_tick, roster):
    mismatches = needs_handle_fallback(parser, official_tick)
    rows = None
    if mismatches:
        print('[positions] incorrect entity handle indices:', ','.join(sorted(mismatches)), file=sys.stderr)
    else:
        try:
            rows = parser.parse_ticks(POSITION_FIELDS).to_dict(orient='records')
        except Exception as error:
            print(f'[positions] combined fields unavailable: {error}', file=sys.stderr)
            try:
                rows = parser.parse_ticks(CORE_FIELDS).to_dict(orient='records')
            except Exception as core_error:
                print(f'[positions] core fields unavailable: {core_error}', file=sys.stderr)
                rows = []
        covered = {
            steamid(row.get('player_steamid') or row.get('steamid')) for row in rows
            if int(row.get('tick', 0)) >= official_tick and finite(row.get('X')) is not None and finite(row.get('Y')) is not None
        }
        # Entity indices can grow past 2047 late in an overtime Demo.
        if set(roster) <= covered and not handle_mismatches(rows):
            yield rows
            return
        print('[positions] incomplete native coverage; trying demoinfocs', file=sys.stderr)
        del rows
    with exported_positions(demo, official_tick, roster) as snapshots:
        yield snapshots


def position_values(rows, match_id, official_tick, roster, normalize_weapon=lambda value: value):
    previous_positions, previous_weapons = {}, {}
    for raw in rows:
        row = {key: None if isinstance(value, float) and not math.isfinite(value) else value for key, value in raw.items()}
        tick = int(row.get('tick', 0) or 0)
        sid = steamid(row.get('player_steamid') or row.get('steamid'))
        if sid not in roster or tick < official_tick:
            continue

        def number(*keys):
            return next((value for key in keys if (value := finite(row.get(key))) is not None), None)

        x, y = number('X', 'x', 'pos_x'), number('Y', 'y', 'pos_y')
        previous = previous_positions.get(sid)
        if x is None or y is None:
            if not previous:
                continue
            x, y = x if x is not None else previous[0], y if y is not None else previous[1]
        previous_positions[sid] = (x, y)
        inventory = row.get('inventory', row.get('m_hMyWeapons', row.get('m_pWeaponServices')))
        try:
            inventory = json.loads(inventory) if isinstance(inventory, str) else (list(inventory) if inventory is not None else [])
        except (ValueError, TypeError):
            inventory = []
        if row.get('m_bHasDefuser') is True or row.get('has_defuser') is True:
            inventory.append('defuser')
        weapon = None
        for key in ('weapon', 'active_weapon_name', 'm_pClippingWeapon', 'm_hActiveWeapon'):
            value = row.get(key)
            if isinstance(value, str) and value.strip().lower() not in ('', 'none', 'null', '0'):
                weapon = normalize_weapon(value)
                break
        if weapon is None:
            weapon = previous_weapons.get(sid)
        else:
            previous_weapons[sid] = weapon
        yield (
            match_id, tick, sid, x, y, number('Z', 'z', 'pos_z'), number('yaw', 'eye_yaw'),
            row.get('health'), number('m_ArmorValue', 'armor_value', 'armor'), row.get('is_alive', row.get('alive')),
            number('team_num', 'team_number'), number('m_iAccount', 'balance', 'm_pInGameMoneyServices.m_iAccount', 'money'),
            weapon, json.dumps(inventory, ensure_ascii=False, default=str),
        )


def compact_position_values(values, step=4):
    """Keep 16 Hz motion plus exact HUD changes and each player's endpoints."""
    last, pending = {}, {}
    for value in values:
        key = (value[0], value[2])
        previous = last.get(key)
        if previous is None or value[1] - previous[1] >= step or value[7:14] != previous[7:14]:
            last[key] = value
            pending.pop(key, None)
            yield value
        else:
            pending[key] = value
    yield from pending.values()


def write_positions(cursor, rows, match_id, official_tick, roster, normalize_weapon=lambda value: value):
    counts, batch = {}, []
    for values in compact_position_values(position_values(rows, match_id, official_tick, roster, normalize_weapon)):
        counts[values[2]] = counts.get(values[2], 0) + 1
        batch.append(values)
        if len(batch) >= 2000:
            cursor.executemany(INSERT_SQL, batch)
            batch.clear()
    if batch:
        cursor.executemany(INSERT_SQL, batch)
    missing = set(roster) - set(counts)
    if missing:
        raise RuntimeError('Refusing incomplete replay import; missing players: ' + ','.join(sorted(missing)))
    return counts


def repair(match_id, demo_override=None):
    from replay_effects import load_env, database
    load_env()
    connection = database()
    try:
        connection.execute('BEGIN IMMEDIATE')
        with connection.cursor() as cursor:
            cursor.execute('SELECT demo_file_path,COALESCE(official_start_tick,warmup_end_tick,0) FROM matches WHERE id=?', (match_id,))
            match = cursor.fetchone()
            if not match:
                raise ValueError('Match does not exist')
            demo = Path(demo_override or match[0])
            cursor.execute('SELECT steamid FROM match_players WHERE match_id=? AND team_number IN (2,3)', (match_id,))
            roster = {row[0] for row in cursor.fetchall()}
            if not roster:
                raise ValueError('Match has no playing roster')
            with exported_positions(demo, match[1], roster) as rows:
                cursor.execute('DELETE FROM player_positions WHERE match_id=?', (match_id,))
                counts = write_positions(cursor, rows, match_id, match[1], roster)
            connection.commit()
            print(json.dumps({'match_id': match_id, 'positions_by_player': counts}, ensure_ascii=False))
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == '__main__':
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument('--match', type=int, required=True)
    arguments.add_argument('--demo', help='Optional original Demo path')
    args = arguments.parse_args()
    repair(args.match, args.demo)
