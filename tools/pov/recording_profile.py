import os
from pathlib import Path


PROFILE_ROOT = Path(os.getenv('CS2_POV_PROFILE', str(Path(__file__).resolve().parents[2] / '.pov-profile')))


def configure_hlae_ffmpeg(hlae, ffmpeg, shortener=lambda value: str(value)):
    """HLAE's default encoder reads ffmpeg/ffmpeg.ini, not FFMPEG_EXE."""
    executable = Path(ffmpeg).absolute()
    if not executable.is_file():
        raise RuntimeError('FFmpeg executable is missing: ' + str(executable))
    directory = Path(hlae).absolute().parent / 'ffmpeg'
    directory.mkdir(parents=True, exist_ok=True)
    config = directory / 'ffmpeg.ini'
    encoder_path = str(shortener(executable))
    if '\n' in encoder_path or '\r' in encoder_path:
        raise ValueError('Invalid FFmpeg executable path')
    temporary = directory / 'ffmpeg.ini.tmp'
    temporary.write_text('[Ffmpeg]\nPath=' + encoder_path + '\n', encoding='utf-8')
    os.replace(temporary, config)
    return config


def prepare_profile(root=PROFILE_ROOT):
    """Create a recording-only USRLOCAL tree without copying Steam settings."""
    # Keep the portable ASCII junction instead of resolving it back to Unicode.
    root = Path(root).absolute()
    cfg = root / 'cfg'
    cfg.mkdir(parents=True, exist_ok=True)
    # Shadow a gaming autoexec from the shared game installation.
    autoexec = cfg / 'autoexec.cfg'
    if not autoexec.exists():
        autoexec.write_text('// CS2 Demo Show recording profile.\n', encoding='utf-8')
    return root


def launch_arguments(hlae, cs2, dll, startup_cfg, profile):
    # Keep the long-standing 1920x1080 default while allowing the portable
    # recording menu to choose a common CS2 capture size per export.
    resolution = os.getenv('CS2_POV_RESOLUTION', '1920x1080').lower().replace(' ', '')
    try:
        width, height = (int(value) for value in resolution.split('x', 1))
        if width < 640 or height < 360 or width > 7680 or height > 4320:
            raise ValueError
    except (TypeError, ValueError):
        width, height = 1920, 1080
    cmdline = (
        '-steam -insecure -worldwide +sv_lan 1 -console -novid '
        f'-afxDisableSteamStorage -sw -w {width} -h {height} '
        f'+exec {startup_cfg}'
    )
    if os.getenv('CS2_POV_CONDEBUG') == '1':
        cmdline += ' -condebug'
    return [
        str(hlae), '-noConfig', '-noGui', '-customLoader', '-autoStart',
        '-hookDllPath', str(dll), '-programPath', str(cs2),
        '-addEnv', f'USRLOCALCSGO={Path(profile).absolute()}',
        '-cmdLine', cmdline,
    ]


def hook_dll_path(hlae, shortener):
    """Shorten only the folder so HLAE's module-name lookup still succeeds."""
    dll = Path(hlae).parent / 'x64' / 'AfxHookSource2.dll'
    return str(Path(shortener(dll.parent)) / dll.name)


def steam_install_path():
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam') as key:
        return str(Path(winreg.QueryValueEx(key, 'SteamPath')[0]).resolve())


def launch_environment(steam_path=None):
    # HLAE appends -addEnv to the inherited environment. Remove a conflicting
    # entry so Windows cannot choose a different USRLOCALCSGO from a duplicate.
    steam = {
        'SteamPath': str(steam_path or steam_install_path()),
        'SteamClientLaunch': '1',
        'SteamGameId': '730',
        'SteamAppId': '730',
        'SteamOverlayGameId': '730',
    }
    replaced = {'USRLOCALCSGO'} | {key.upper() for key in steam}
    environment = {key: value for key, value in os.environ.items()
                   if key.upper() not in replaced}
    # Match HLAE's official CS2 launcher; -steam alone cannot establish IPC.
    environment.update(steam)
    return environment
