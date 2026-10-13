import unittest
from replay_effects import trajectories


class ReplayExtractionTests(unittest.TestCase):
    def row(self, tick, **extra):
        return dict(grenade_entity_id=7, steamid='11', grenade_type='CSmokeGrenadeProjectile',
                    tick=tick, x=tick, y=10, z=4, **extra)

    def test_real_parser_entity_column_and_reuse(self):
        result = trajectories([self.row(t) for t in (100, 101, 104, 107, 200, 204)], 100)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['entity_id'], 7)
        self.assertEqual(result[0]['points'][-1][0], 107)

    def test_nan_and_pre_match_rows_are_excluded(self):
        row = self.row(100)
        row['x'] = float('nan')
        self.assertEqual(trajectories([row], 0), [])
        self.assertEqual(trajectories([self.row(100), self.row(104)], 200), [])


if __name__ == '__main__':
    unittest.main()
