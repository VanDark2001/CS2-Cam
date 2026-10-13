import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from db_schema import connect, database_path, ensure_schema, open_application_database


class SQLiteStorageTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.file = Path(self.directory.name) / '中文 数据' / 'csdemo.sqlite3'
        self.environment = patch.dict(os.environ, {'CS2_DATABASE': str(self.file),
                                                   'MYSQL_DATABASE': 'never_used'})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        self.directory.cleanup()

    def test_shared_schema_unicode_path_and_repeat_initialization(self):
        c = open_application_database()
        try:
            self.assertEqual(database_path(), self.file.resolve())
            self.assertEqual(c.execute('PRAGMA foreign_keys').fetchone()[0], 1)
            self.assertEqual(c.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            c.execute('INSERT INTO matches(id,map_name) VALUES(22,?)', ('de_ancient',))
            c.commit()
            ensure_schema(c)
            self.assertEqual(c.execute('SELECT map_name FROM matches WHERE id=22').fetchone()[0], 'de_ancient')
            with self.assertRaises(sqlite3.IntegrityError):
                c.execute('INSERT INTO match_players(match_id,steamid) VALUES(99,?)', ('90000000000000004',))
        finally:
            c.close()

    def test_failed_writer_rolls_back_and_wal_reader_sees_only_committed_rows(self):
        writer = open_application_database()
        reader = connect()
        try:
            writer.execute('BEGIN IMMEDIATE')
            writer.execute('INSERT INTO matches(map_name) VALUES(?)', ('de_inferno',))
            self.assertEqual(reader.execute('SELECT COUNT(*) FROM matches').fetchone()[0], 0)
            with self.assertRaises(sqlite3.IntegrityError):
                writer.execute('INSERT INTO match_players(match_id,steamid) VALUES(99,?)', ('missing',))
            writer.rollback()
            self.assertEqual(reader.execute('SELECT COUNT(*) FROM matches').fetchone()[0], 0)
            writer.execute('INSERT INTO matches(map_name) VALUES(?)', ('de_anubis',))
            writer.commit()
            self.assertEqual(reader.execute('SELECT map_name FROM matches').fetchone()[0], 'de_anubis')
        finally:
            writer.close()
            reader.close()

    def test_competing_writer_waits_or_fails_without_overwriting(self):
        first = open_application_database()
        second = connect()
        try:
            second.execute('PRAGMA busy_timeout=10')
            first.execute('BEGIN IMMEDIATE')
            with self.assertRaises(sqlite3.OperationalError):
                second.execute('BEGIN IMMEDIATE')
            first.rollback()
            second.execute('BEGIN IMMEDIATE')
            second.rollback()
        finally:
            first.close()
            second.close()

    def test_schema_upgrade_preserves_roster_and_rejects_null_primary_keys(self):
        c = open_application_database()
        try:
            c.execute("INSERT INTO matches(id,map_name) VALUES(22,'de_inferno')")
            c.execute("INSERT INTO players VALUES('90000000000000004','玩家')")
            c.execute("INSERT INTO match_players VALUES(22,'90000000000000004',3,1200,'本场昵称')")
            c.commit()
            c.execute('PRAGMA user_version=1')
            ensure_schema(c)
            self.assertEqual(c.execute('PRAGMA user_version').fetchone()[0], 2)
            self.assertEqual(c.execute('SELECT team_number,total_damage,display_name FROM match_players').fetchone(), (3, 1200, '本场昵称'))
            with self.assertRaises(sqlite3.IntegrityError):
                c.execute('INSERT INTO players(steamid) VALUES(NULL)')
            c.rollback()
            with self.assertRaises(sqlite3.IntegrityError):
                c.execute("INSERT INTO match_players(match_id,steamid) VALUES(NULL,'90000000000000004')")
            c.rollback()
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(), [])
        finally:
            c.close()


if __name__ == '__main__':
    unittest.main()
