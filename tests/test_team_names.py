import sqlite3
import unittest
import pandas as pd
from team_names import extract_team_names, replace_team_names


class Parser:
    def parse_event(self, name):
        return pd.DataFrame([{'tick': 100, 'winner': 'CT'}, {'tick': 200, 'winner': 'T'}])

    def parse_ticks(self, props, ticks):
        return pd.DataFrame([
            {'tick': 100, 'steamid': 11, 'team_clan_name': 'MOUZ'},
            {'tick': 200, 'steamid': 11, 'team_clan_name': 'MOUZ'},
            {'tick': 200, 'steamid': 22, 'team_clan_name': 'Vitality'},
        ])


class TeamNamesTest(unittest.TestCase):
    def test_names_follow_roster_identity_across_swaps(self):
        roster = [{'steamid': 11, 'team_number': 3}, {'steamid': 22, 'team_number': 2}]
        self.assertEqual(extract_team_names(Parser(), roster), {'3': 'MOUZ', '2': 'Vitality'})
        self.assertEqual(extract_team_names(Parser(), roster, 300), {})

    def test_conflicting_names_remain_unknown(self):
        roster = [{'steamid': 11, 'team_number': 2}, {'steamid': 22, 'team_number': 2}]
        self.assertEqual(extract_team_names(Parser(), roster), {})

    def test_replacement_is_single_metadata_event(self):
        c = sqlite3.connect(':memory:')
        c.execute('CREATE TABLE events(match_id,tick,event_name,is_warmup,data_json)')
        replace_team_names(c, 1, {'2': 'Vitality'})
        replace_team_names(c, 1, {'3': 'MOUZ'})
        self.assertEqual(c.execute('SELECT tick,data_json FROM events').fetchall(), [(0, '{"3": "MOUZ"}')])


if __name__ == '__main__':
    unittest.main()
