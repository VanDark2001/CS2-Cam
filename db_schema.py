"""Shared SQLite storage for the parser and Java backend.

Legacy connect arguments remain accepted for maintenance callers;
MYSQL_* variables never select the application database.
"""
import os
import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).with_name('sqlite_schema.sql')


def database_path():
    explicit = os.getenv('CS2_DATABASE')
    if explicit:
        return Path(explicit).expanduser().resolve()
    root = Path(os.getenv('CS2_DATA_ROOT', str(Path(__file__).parent / 'data')))
    return (root / 'csdemo.sqlite3').resolve()


def settings():
    return {'database': str(database_path()), 'user': '', 'password': ''}


class Cursor(sqlite3.Cursor):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class Connection(sqlite3.Connection):
    def cursor(self, factory=Cursor):
        return super().cursor(factory)


def connect(user=None, password=None, database=None, autocommit=False):
    file = Path(database).resolve() if database else database_path()
    file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(file, timeout=60, factory=Connection,
                                 isolation_level=None if autocommit else 'IMMEDIATE')
    connection.execute('PRAGMA foreign_keys=ON')
    connection.execute('PRAGMA busy_timeout=60000')
    connection.execute('PRAGMA synchronous=FULL')
    return connection


def ensure_schema(connection):
    version = connection.execute('PRAGMA user_version').fetchone()[0]
    if version > 2:
        raise RuntimeError('SQLite schema is newer than this application')
    if version == 2:
        return
    if connection.in_transaction:
        raise RuntimeError('Schema initialization must precede business transactions')
    connection.execute('PRAGMA journal_mode=WAL')
    schema = SCHEMA.with_name('sqlite_schema_v2.sql') if version == 1 else SCHEMA
    connection.executescript('BEGIN IMMEDIATE;\n' + schema.read_text(encoding='utf-8') + '\nCOMMIT;')


def bootstrap_database():
    connection = connect()
    try:
        ensure_schema(connection)
    finally:
        connection.close()
    return settings()


def open_application_database():
    connection = connect()
    try:
        ensure_schema(connection)
        return connection
    except BaseException:
        connection.close()
        raise
