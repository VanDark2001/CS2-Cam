"""Recover flash blindness from CS2 network state, including demos without player_blind."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

from db_schema import connect
from replay_positions import exporter


def extract_blinds(demo, start):
    with tempfile.TemporaryDirectory(prefix='csdemo-blinds-') as directory:
        output = Path(directory) / 'blinds.ndjson'
        result = subprocess.run([str(exporter()), '-demo', str(Path(demo).resolve()),
                                 '-output', str(output), '-start', str(start), '-blinds-only'],
                                capture_output=True, text=True, encoding='utf-8', timeout=240)
        if result.returncode:
            raise RuntimeError(f'Flash extraction failed: {result.stderr[-2000:]}')
        return [json.loads(line) for line in output.read_text(encoding='utf-8').splitlines()]


def replace_blinds(connection, match_id, start, rows):
    # Extraction finishes first: failures preserve previously stored events.
    sql = 'INSERT INTO events(match_id,event_name,tick,player_steamid,player_name,is_warmup,data_json) VALUES(?,?,?,?,?,0,?)'
    values = [(match_id, 'player_blind', row['tick'], row['user_steamid'], row.get('user_name'), json.dumps(row, ensure_ascii=False, allow_nan=False)) for row in rows]
    connection.execute('SAVEPOINT flash_blinds')
    try:
        connection.execute("DELETE FROM events WHERE match_id=? AND event_name IN ('player_blind','flash_blinds_ready')", (match_id,))
        connection.executemany(sql, values)
        connection.execute(sql, (match_id, 'flash_blinds_ready', start, None, None, json.dumps({'version': 1, 'count': len(rows)})))
        connection.execute('RELEASE flash_blinds')
    except Exception:
        connection.execute('ROLLBACK TO flash_blinds')
        connection.execute('RELEASE flash_blinds')
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--match', type=int, required=True)
    args = parser.parse_args()
    with connect() as connection:
        match = connection.execute('SELECT demo_file_path,COALESCE(official_start_tick,warmup_end_tick,0) FROM matches WHERE id=?', (args.match,)).fetchone()
        if not match:
            raise RuntimeError('Match not found')
        rows = extract_blinds(*match)
        replace_blinds(connection, args.match, match[1], rows)
        print(f'[flash-blinds] saved {len(rows)} events for match {args.match}')


if __name__ == '__main__':
    main()
