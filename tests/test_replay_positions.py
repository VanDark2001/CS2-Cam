import json
import math
import unittest
import tempfile
from pathlib import Path
import numpy as np
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import replay_positions as positions


class ReplayPositionsTests(unittest.TestCase):
    def test_compaction_keeps_endpoints_and_exact_hud_changes(self):
        rows = [(1, tick, '1', tick, 0, 0, 0, 100 if tick < 3 else 50,
                 100, True, 3, 800, 'ak47', '[]') for tick in range(11)]
        result = list(positions.compact_position_values(rows))
        self.assertEqual([r[1] for r in result], [0, 3, 7, 10])
        self.assertEqual(result[1][7], 50)

    def test_compaction_keeps_each_players_final_frame(self):
        rows = [(1, tick, sid, 0, 0, 0, 0, 100, 100, True, 3, 800, 'ak47', '[]')
                for tick in range(6) for sid in ('1', '2')]
        result = list(positions.compact_position_values(rows))
        for sid in ('1', '2'):
            self.assertEqual([r[1] for r in result if r[2] == sid], [0, 4, 5])

    def test_packaged_exporter_needs_neither_go_nor_source_files(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'replay_positions.exe'
            binary.write_bytes(b'packaged exporter')
            with patch.dict('os.environ', {'CS2_REPLAY_EXPORTER': str(binary)}), patch.object(positions.shutil, 'which', side_effect=AssertionError('must not invoke Go')):
                self.assertEqual(positions.exporter(), binary)
                binary.unlink()
                with self.assertRaisesRegex(RuntimeError, 'Bundled replay exporter is missing'):
                    positions.exporter()

    def test_handle_probe_detects_truncation_even_when_wrong_entity_has_coordinates(self):
        rows = [
            {'steamid': '90000000000000004', 'CCSPlayerController.m_hPlayerPawn': 16533536, 'entity_id': 32, 'X': 1, 'Y': 2},
            {'steamid': '90000000000000001', 'CCSPlayerController.m_hPlayerPawn': 15991385, 'entity_id': 601},
            {'steamid': '90000000000000003', 'CCSPlayerController.m_hPlayerPawn': 1935881, 'entity_id': 2569},
            {'steamid': '1', 'CCSPlayerController.m_hPlayerPawn': 0xFFFFFF, 'entity_id': 2047},
        ]
        self.assertEqual(positions.handle_mismatches(rows), {'90000000000000004'})

    def test_snapshots_filter_warmup_preserve_unknowns_and_use_only_past_coordinates(self):
        rows = [
            {'tick': 9, 'steamid': '1', 'X': 100, 'Y': 100},
            {'tick': 10, 'steamid': '1', 'X': math.nan, 'Y': math.nan},
            {'tick': 11, 'steamid': '1', 'X': 0, 'Y': 20, 'health': 0, 'balance': 0, 'inventory': ['flashbang', 'flashbang']},
            {'tick': 12, 'steamid': '1', 'X': math.nan, 'Y': 21, 'health': math.nan},
            {'tick': 13, 'steamid': '2', 'X': 3, 'Y': 4},
        ]
        snapshots = list(positions.position_values(rows, 22, 10, {'1'}))
        self.assertEqual(len(snapshots), 2)
        self.assertEqual(snapshots[0][3:5], (0, 20))
        self.assertEqual(snapshots[0][7], 0)
        self.assertEqual(snapshots[0][11], 0)
        self.assertEqual(json.loads(snapshots[0][13]), ['flashbang', 'flashbang'])
        self.assertEqual(snapshots[1][3:5], (0, 21))
        self.assertIsNone(snapshots[1][7])
        self.assertIsNone(snapshots[1][8])

    def test_missing_player_cannot_silently_commit(self):
        cursor = MagicMock()
        with self.assertRaisesRegex(RuntimeError, 'missing players: 2'):
            positions.write_positions(cursor, [{'tick': 10, 'steamid': '1', 'X': 3, 'Y': 4}], 22, 10, {'1', '2'})

    def test_native_numpy_inventory_is_preserved(self):
        row = {'tick': 10, 'steamid': '1', 'X': 3, 'Y': 4, 'inventory': np.array(['ak47', 'flashbang']), 'has_defuser': True}
        snapshot = list(positions.position_values([row], 22, 10, {'1'}))[0]
        self.assertEqual(json.loads(snapshot[13]), ['ak47', 'flashbang', 'defuser'])

    def test_late_handle_mismatch_uses_fallback_despite_complete_coordinate_coverage(self):
        parser = MagicMock()
        parser.parse_ticks.return_value.to_dict.return_value = [
            {'tick': 20000, 'steamid': '1', 'X': 10, 'Y': 20, 'entity_id': 32, 'CCSPlayerController.m_hPlayerPawn': 16533536},
        ]

        @contextmanager
        def export(*args):
            yield iter([{'tick': 20000, 'steamid': '1', 'X': 30, 'Y': 40}])

        with patch.object(positions, 'needs_handle_fallback', return_value=set()), patch.object(positions, 'exported_positions', export):
            with positions.position_stream(parser, 'example.dem', 10, {'1'}) as rows:
                self.assertEqual(list(rows)[0]['X'], 30)

    def test_repair_rolls_back_when_stream_fails_after_delete(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [('example.dem', 10), (1,)]
        cursor.fetchall.return_value = [('1',)]

        @contextmanager
        def failing_export(*args):
            def stream():
                yield {'tick': 10, 'steamid': '1', 'X': 3, 'Y': 4}
                raise ValueError('invalid snapshot')
            yield stream()

        with patch('replay_effects.load_env'), patch('replay_effects.database', return_value=connection), patch.object(positions, 'exported_positions', failing_export):
            with self.assertRaisesRegex(ValueError, 'invalid snapshot'):
                positions.repair(22)
        connection.commit.assert_not_called()
        connection.rollback.assert_called_once()
        connection.close.assert_called_once()
        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual([sql for sql in statements if sql.startswith('DELETE')], ['DELETE FROM player_positions WHERE match_id=?'])


if __name__ == '__main__':
    unittest.main()
