import sqlite3
import unittest
from flash_blinds import replace_blinds


class FlashBlindStorageTest(unittest.TestCase):
    def test_repair_is_idempotent_and_failed_write_preserves_previous_events(self):
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE events(match_id,event_name,tick,player_steamid,player_name,is_warmup,data_json)')
            rows = [{'tick': 120, 'user_steamid': '2', 'attacker_steamid': '1', 'blind_duration': 2}]
            replace_blinds(db, 1, 100, rows)
            replace_blinds(db, 1, 100, rows)
            previous = db.execute('SELECT * FROM events').fetchall()
            self.assertEqual(2, len(previous))
            db.execute("CREATE TRIGGER reject_blind BEFORE INSERT ON events WHEN NEW.tick=130 BEGIN SELECT RAISE(ABORT,'write failure'); END")
            with self.assertRaises(sqlite3.IntegrityError):
                replace_blinds(db, 1, 100, [dict(rows[0], tick=130)])
            self.assertEqual(previous, db.execute('SELECT * FROM events').fetchall())
            replace_blinds(db, 1, 100, [])
            self.assertEqual([('flash_blinds_ready',)], db.execute('SELECT event_name FROM events').fetchall())


if __name__ == '__main__':
    unittest.main()
