import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from tools.record_worker import audio_tempo_filter, video_encoding_options
from tools.record_worker import finalize_recording


class RecordingEncodingTests(unittest.TestCase):
    def test_raw_cleanup_occurs_only_after_validated_final_and_primary_is_link(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory); final=out/'players/player_0/final.mp4'
            raw=final.parent/'video/take0000';raw.mkdir(parents=True)
            final.write_bytes(b'final');(raw/'audio.wav').write_bytes(b'audio')
            results=[{'file':str(final),'name':'player'}]
            with patch('tools.record_worker.subprocess.run',return_value=SimpleNamespace(stdout=json.dumps({'streams':[{'codec_type':'audio'},{'codec_type':'video'}]}))), patch('tools.record_worker.validate_media_interval'):
                finalize_recording(results,out,'ffprobe',10)
            self.assertFalse(raw.exists())
            self.assertTrue(final.samefile(out/'final.mp4'))

    def test_failed_validation_preserves_raw_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory); final=out/'players/player_0/final.mp4'
            raw=final.parent/'video';raw.mkdir(parents=True);final.write_bytes(b'bad')
            with patch('tools.record_worker.subprocess.run',return_value=SimpleNamespace(stdout='{"streams":[]}')):
                with self.assertRaises(RuntimeError):finalize_recording([{'file':str(final),'name':'p'}],out,'ffprobe',10)
            self.assertTrue(raw.exists())
    def test_four_times_audio_restores_normal_duration(self):
        self.assertEqual(audio_tempo_filter(4), 'atempo=0.5,atempo=0.5')

    def test_selected_bitrate_controls_both_target_and_buffer(self):
        for rate in ('8', '12', '20', '30', '50'):
            args = video_encoding_options(rate)
            self.assertEqual(args[args.index('-b:v') + 1], rate + 'M')
            self.assertEqual(args[args.index('-bufsize') + 1], str(int(rate) * 2) + 'M')
            self.assertNotIn('-crf', args)
        self.assertIn('-crf', video_encoding_options('auto'))
        with self.assertRaises(ValueError):
            video_encoding_options('malformed')

    def test_random_access_recording_forces_a_keyframe_each_second(self):
        args=video_encoding_options('auto')
        self.assertEqual(args[args.index('-force_key_frames')+1], 'expr:gte(t,n_forced)')
        self.assertEqual(args[args.index('-pix_fmt')+1], 'yuv420p')
