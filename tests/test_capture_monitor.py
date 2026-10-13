import json
import tempfile
import time
import unittest
from pathlib import Path

from websockets.sync.client import connect
from tools.pov.capture_monitor import CaptureMonitor


class CaptureMonitorTests(unittest.TestCase):
    def completed(self):
        return [
            dict(type='started', player=0, steamid='90000000000000001',
                 observedSteamid='90000000000000001', mode=2, tick=1300),
            dict(type='finished', player=0, steamid='90000000000000001', reason='round_end', tick=1428),
            dict(type='done'),
        ]

    def test_accepts_only_verified_first_person_identity(self):
        with tempfile.TemporaryDirectory() as root:
            monitor = CaptureMonitor(root)
            monitor.events = self.completed()
            monitor.validate([dict(steamid='90000000000000001')], 1300, 1428)
            for key, wrong in [('mode', 3), ('observedSteamid', 'wrong')]:
                monitor.events = self.completed()
                monitor.events[0][key] = wrong
                with self.assertRaises(RuntimeError):
                    monitor.validate([dict(steamid='90000000000000001')], 1300, 1428)

    def test_refuses_partial_output_and_lost_camera(self):
        with tempfile.TemporaryDirectory() as root:
            monitor = CaptureMonitor(root)
            monitor.events = self.completed()[:-1]
            with self.assertRaisesRegex(RuntimeError, 'completion'):
                monitor.validate([dict(steamid='90000000000000001')], 1300, 1428)
            monitor.events = self.completed() + [dict(type='error', reason='POV changed')]
            with self.assertRaisesRegex(RuntimeError, 'POV changed'):
                monitor.validate([dict(steamid='90000000000000001')], 1300, 1428)

    def test_loopback_transport_writes_provenance(self):
        with tempfile.TemporaryDirectory() as root:
            with CaptureMonitor(root) as monitor:
                with connect(monitor.url) as client:
                    for event in self.completed():
                        client.send(json.dumps(event))
                deadline = time.monotonic() + 2
                while len(monitor.events) < 3 and time.monotonic() < deadline:
                    time.sleep(.01)
                monitor.validate([dict(steamid='90000000000000001')], 1300, 1428)
            lines = (Path(root) / 'capture-events.jsonl').read_text().splitlines()
            self.assertEqual(len(lines), 3)

    def test_refuses_death_truncation_wrong_end_identity_and_shifted_interval(self):
        with tempfile.TemporaryDirectory() as root:
            monitor = CaptureMonitor(root)
            for event_index, key, wrong in [(1, 'reason', 'death'), (1, 'tick', 1390),
                                             (1, 'steamid', 'wrong'), (0, 'tick', 1320)]:
                monitor.events = self.completed()
                monitor.events[event_index][key] = wrong
                with self.assertRaisesRegex(RuntimeError, 'interval'):
                    monitor.validate([dict(steamid='90000000000000001')], 1300, 1428)


if __name__ == '__main__':
    unittest.main()
