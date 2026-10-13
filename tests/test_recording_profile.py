import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.pov.recording_profile import (
    PROFILE_ROOT, launch_arguments, launch_environment, prepare_profile, hook_dll_path,
    configure_hlae_ffmpeg,
)


class RecordingProfileTests(unittest.TestCase):
    def test_separately_installed_ffmpeg_is_connected_to_hlae_encoder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ffmpeg = root / 'separate tools' / 'ffmpeg.exe'
            ffmpeg.parent.mkdir();ffmpeg.write_bytes(b'test')
            config = configure_hlae_ffmpeg(root/'hlae'/'HLAE.exe', ffmpeg, lambda value: 'C:/TOOLS/ffmpeg.exe')
            self.assertEqual(config.read_text(encoding='utf-8'), '[Ffmpeg]\nPath=C:/TOOLS/ffmpeg.exe\n')
            with self.assertRaises(RuntimeError):
                configure_hlae_ffmpeg(root/'hlae'/'HLAE.exe', root/'missing.exe')
            self.assertIn('C:/TOOLS/ffmpeg.exe', config.read_text(encoding='utf-8'))

    def test_hook_dll_shortens_directory_but_preserves_module_name(self):
        calls = []
        def shortener(value):
            calls.append(value)
            return 'C:/TEMP/CS2DEM~1/x64'
        dll = Path(hook_dll_path('C:/My app/HLAE.exe', shortener))
        self.assertEqual(dll.name, 'AfxHookSource2.dll')
        self.assertEqual(calls, [Path('C:/My app/x64')])
        self.assertEqual(dll.parent, Path('C:/TEMP/CS2DEM~1/x64'))

    def test_default_is_project_local_not_game_installation(self):
        self.assertEqual(PROFILE_ROOT.parent, Path(__file__).resolve().parents[1])
        self.assertEqual(PROFILE_ROOT.name, '.pov-profile')

    def test_creates_independent_cfg_without_copying_personal_video(self):
        with tempfile.TemporaryDirectory() as directory:
            root = prepare_profile(Path(directory) / 'recording')
            self.assertTrue((root / 'cfg' / 'autoexec.cfg').is_file())
            self.assertFalse((root / 'cfg' / 'cs2_video.txt').exists())
            self.assertNotIn('exec', (root / 'cfg' / 'autoexec.cfg').read_text())

    def test_preserves_existing_recording_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            root = prepare_profile(directory)
            cfg = root / 'cfg'
            (cfg / 'autoexec.cfg').write_text('fps_max 120\n')
            (cfg / 'cs2_video.txt').write_text('recording video settings')
            prepare_profile(directory)
            self.assertEqual((cfg / 'autoexec.cfg').read_text(), 'fps_max 120\n')
            self.assertEqual((cfg / 'cs2_video.txt').read_text(), 'recording video settings')

    def test_launch_redirects_local_storage_and_disables_cloud_and_hlae_save(self):
        with tempfile.TemporaryDirectory(prefix='pov profile ') as directory:
            args = launch_arguments('HLAE.exe', 'cs2.exe', 'AfxHookSource2.dll',
                                    'csdemo_auto_start_123.cfg', directory)
            self.assertIn('-noConfig', args)
            self.assertEqual(args[args.index('-addEnv') + 1],
                             f'USRLOCALCSGO={Path(directory).resolve()}')
            cmdline = args[args.index('-cmdLine') + 1]
            self.assertIn('-afxDisableSteamStorage', cmdline)
            self.assertIn('-insecure', cmdline)
            self.assertIn('-sw -w 1920 -h 1080', cmdline)
            self.assertIn('+exec csdemo_auto_start_123.cfg', cmdline)

    def test_does_not_leak_an_inherited_profile_or_modify_parent_environment(self):
        with patch.dict(os.environ, {'USRLOCALCSGO': 'personal', 'KEEP_ME': 'yes'}, clear=True):
            environment = launch_environment('C:/Steam')
            self.assertNotIn('USRLOCALCSGO', environment)
            self.assertEqual(environment['KEEP_ME'], 'yes')
            self.assertEqual(os.environ['USRLOCALCSGO'], 'personal')

    def test_steam_ipc_environment_matches_official_cs2_launcher(self):
        with patch.dict(os.environ, {'steamappid': 'wrong', 'SteamPath': 'old'}, clear=True):
            self.assertEqual(launch_environment('C:/Steam'), {
                'SteamPath': 'C:/Steam',
                'SteamClientLaunch': '1',
                'SteamGameId': '730',
                'SteamAppId': '730',
                'SteamOverlayGameId': '730',
            })


if __name__ == '__main__':
    unittest.main()
