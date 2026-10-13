import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from tools.record_worker import validate_media_interval, resolve_ffprobe


class PovMediaIntervalTests(unittest.TestCase):
    def probe(self, duration):
        return Mock(stdout=json.dumps({'format': {'duration': str(duration)}}))

    @patch('tools.record_worker.subprocess.run')
    def test_accepts_frame_rounding_for_video_and_audio(self, run):
        run.side_effect = [self.probe(76.683), self.probe(76.66)]
        validate_media_interval('ffprobe', 'video.mp4', 'audio.wav', 76.65625, 'player')
        self.assertEqual(run.call_count, 2)

    @patch('tools.record_worker.subprocess.run')
    def test_short_video_or_audio_is_not_published(self, run):
        for durations in [(8, 76.66), (76.66, 8), (100, 76.66), (float('nan'), 76.66)]:
            run.side_effect = [self.probe(value) for value in durations]
            with self.assertRaisesRegex(RuntimeError, 'Incomplete'):
                validate_media_interval('ffprobe', 'video.mp4', 'audio.wav', 76.65625, 'player')

    @patch.dict(os.environ, {}, clear=True)
    @patch('tools.record_worker.shutil.which')
    def test_hlae_ffmpeg_without_bundled_probe_uses_path(self, which):
        with tempfile.TemporaryDirectory() as root:
            probe = Path(root) / 'installed-ffprobe.exe'
            probe.touch()
            which.return_value = str(probe)
            self.assertEqual(resolve_ffprobe(Path(root) / 'hlae' / 'ffmpeg.exe'), probe)
            which.return_value = None
            with self.assertRaisesRegex(RuntimeError, 'FFprobe'):
                resolve_ffprobe(Path(root) / 'hlae' / 'ffmpeg.exe')

    @patch('tools.record_worker.shutil.which')
    def test_explicit_probe_overrides_path(self, which):
        with tempfile.TemporaryDirectory() as root:
            probe = Path(root) / 'explicit.exe'
            probe.touch()
            with patch.dict(os.environ, {'FFPROBE_EXE': str(probe)}):
                self.assertEqual(resolve_ffprobe(Path(root) / 'ffmpeg.exe'), probe)
            which.assert_not_called()


if __name__ == '__main__':
    unittest.main()
