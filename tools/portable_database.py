"""Check/bootstrap only the app-owned SQLite file; never use a global .env."""
import argparse
import json
import sys
from pathlib import Path

from db_schema import bootstrap_database, connect, settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['ready', 'schema', 'shutdown'])
    args = parser.parse_args()
    if args.action == 'schema':
        import os
        from db_schema import database_path
        root = Path(os.environ['CS2_DATA_ROOT']).resolve()
        if database_path() != root / 'csdemo.sqlite3':
            raise RuntimeError('Database is not owned by this portable app')
        if (root / 'mysql').exists() and not database_path().exists():
            raise RuntimeError('旧 MySQL 数据已保留。当前版本只支持 SQLite，请从原版本导出比赛包后导入，或重新解析 Demo。')
        bootstrap_database()
        relocate_demos()
    elif args.action == 'ready':
        connection = connect()
        try:
            connection.execute('SELECT 1')
        finally:
            connection.close()
    # SQLite has no database process to shut down.
    print(json.dumps({'status': 'ok'}))


def relocate_demos():
    """Only rebase Demo paths owned by this data directory after a folder move."""
    import os
    root = Path(os.environ['CS2_DATA_ROOT']).resolve()
    marker = root / 'data-location.json'
    previous = Path(json.loads(marker.read_text(encoding='utf-8'))['root']) if marker.exists() else root
    if previous != root:
        config = settings()
        connection = connect(config['user'], config['password'], config['database'])
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT id,demo_file_path FROM matches')
                for match_id, stored in cursor.fetchall():
                    try:
                        relative = Path(stored).relative_to(previous / 'uploads')
                    except (ValueError, TypeError):
                        continue
                    replacement = root / 'uploads' / relative
                    if replacement.is_file():
                        cursor.execute('UPDATE matches SET demo_file_path=? WHERE id=?', (str(replacement), match_id))
            connection.commit()
            (root / 'server' / '.cache' / 'matches.json').unlink(missing_ok=True)
        finally:
            connection.close()
    temporary = marker.with_suffix('.tmp')
    temporary.write_text(json.dumps({'root': str(root)}), encoding='utf-8')
    temporary.replace(marker)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
