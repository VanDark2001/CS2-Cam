import ctypes, json, os, pathlib, subprocess, time
from ctypes import wintypes
from recording_profile import prepare_profile, launch_arguments, launch_environment, hook_dll_path, configure_hlae_ffmpeg
from capture_monitor import CaptureMonitor
user32=ctypes.WinDLL('user32',use_last_error=True)
FindWindowW=user32.FindWindowW; SetForegroundWindow=user32.SetForegroundWindow; EnumWindows=user32.EnumWindows; GetWindowTextW=user32.GetWindowTextW; IsWindowVisible=user32.IsWindowVisible
class KEYBDINPUT(ctypes.Structure): _fields_=[('wVk',wintypes.WORD),('wScan',wintypes.WORD),('dwFlags',wintypes.DWORD),('time',wintypes.DWORD),('dwExtraInfo',ctypes.POINTER(ctypes.c_ulong))]
class MOUSEINPUT(ctypes.Structure):
    _fields_=[('dx',wintypes.LONG),('dy',wintypes.LONG),('mouseData',wintypes.DWORD),('dwFlags',wintypes.DWORD),('time',wintypes.DWORD),('dwExtraInfo',ctypes.c_size_t)]
class INPUTUNION(ctypes.Union):
    _fields_=[('ki',KEYBDINPUT),('mi',MOUSEINPUT)]
class INPUT(ctypes.Structure):
    _anonymous_=('u',)
    _fields_=[('type',wintypes.DWORD),('u',INPUTUNION)]
user32.SendInput.argtypes=[wintypes.UINT,ctypes.POINTER(INPUT),ctypes.c_int]
user32.SendInput.restype=wintypes.UINT
def send_vk(vk):
    user32.keybd_event(vk,0,0,0); user32.keybd_event(vk,0,2,0)
def send_text(text):
    for ch in text:
        code=ord(ch)
        inp=INPUT(); inp.type=1; inp.ki=KEYBDINPUT(0,code,4,0,None)
        for flag in (4,6):
            inp.ki.dwFlags=flag
            if user32.SendInput(1,ctypes.byref(inp),ctypes.sizeof(inp)) != 1:
                raise ctypes.WinError(ctypes.get_last_error())
def find_game_window():
    found=[]
    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, lparam):
        if IsWindowVisible(hwnd):
            b=ctypes.create_unicode_buffer(512); GetWindowTextW(hwnd,b,512)
            if 'Counter-Strike' in b.value or 'cs2' in b.value.lower(): found.append(hwnd)
        return True
    EnumWindows(cb,0)
    return found[0] if found else 0

def command(hwnd, text):
    SetForegroundWindow(hwnd); time.sleep(.3); send_vk(0xC0); time.sleep(.2); send_text(text); send_vk(0x0D)
def short_path(value):
    buf=ctypes.create_unicode_buffer(32768)
    n=ctypes.windll.kernel32.GetShortPathNameW(str(value),buf,len(buf))
    return buf.value if n else str(value)

def run_capture(c, monitor):
    out=pathlib.Path(c['output_dir']).resolve(); out.mkdir(parents=True,exist_ok=True)
    if os.environ.get('CS2_NATIVE_DATA') and os.environ.get('CS2_DATA_ROOT'):
        # HLAE's native encoder path also needs an ASCII view of the same files.
        out=pathlib.Path(os.environ['CS2_NATIVE_DATA'])/out.relative_to(pathlib.Path(os.environ['CS2_DATA_ROOT']).resolve())
    cs2=os.environ.get('CS2_EXE','')
    hlae=os.environ.get('HLAE_EXE','')
    if not cs2 or not hlae: raise SystemExit('CS2/HLAE 路径未设置，请在设置页选择录制工具')
    ffmpeg = os.environ.get('FFMPEG_EXE')
    if not ffmpeg:
        raise SystemExit('FFmpeg 路径未设置，请在设置页选择 FFmpeg 后重试录制')
    try:
        config = configure_hlae_ffmpeg(hlae, ffmpeg, short_path)
        subprocess.run([ffmpeg, '-version'], check=True, capture_output=True, timeout=15)
    except (OSError, subprocess.SubprocessError, ValueError, RuntimeError) as error:
        raise SystemExit('HLAE 视频编码器配置失败：' + str(error))
    (out/'encoder-config.log').write_text(str(config) + '\n' + config.read_text(encoding='utf-8'), encoding='utf-8')
    # HLAE finds its base directory with GetModuleHandleW("AfxHookSource2.dll").
    # Shorten the directory only: shortening the DLL basename to AFXHOO~2.DLL
    # breaks that lookup and makes the encoder executable path invalid.
    dll=hook_dll_path(hlae, short_path)
    hlae=short_path(hlae); cs2=short_path(cs2)
    profile=prepare_profile()
    cfg_dir=profile/'cfg'
    # Never share the startup CFG between exports: a second queued job can
    # otherwise overwrite the first job's demo/tick/player commands.
    cfg_token=str(abs(hash(str(out))) % 100000000)
    cfg_name=f'csdemo_auto_start_{cfg_token}.cfg'; stop_name=f'csdemo_auto_stop_{cfg_token}.cfg'
    demo=str(pathlib.Path(c['demo_path']).resolve()).replace('\\','/')
    players=c.get('players') or [{'slot': c.get('player_slot',1), 'name': c.get('player_name','player')}]
    def safe(v): return ''.join(ch if ord(ch) < 128 and (ch.isalnum() or ch in '-_') else '_' for ch in str(v))[:48] or 'player'
    script=pathlib.Path(__file__).with_name('batch_capture.js')
    enriched=[]
    for i,p in enumerate(players):
        pdir=out/'players'/f'player_{i}'
        pdir.mkdir(parents=True,exist_ok=True)
        enriched.append({'steamid':str(p.get('steamid','')),'name':p.get('name',''),'slot':int(p.get('slot',1)),'capture_path':str(pdir/'video').replace('\\','/')})
    runtime_script=out/'batch_capture_runtime.js'
    try:
        timescale=max(1.0,float(os.environ.get('CS2_POV_TIMESCALE','1')))
    except ValueError:
        timescale=1.0
    runtime_script.write_text(script.read_text(encoding='utf-8').replace('__CONFIG__',json.dumps({'demo_path':demo,'players':enriched,'start_tick':int(c['start_tick']),'end_tick':int(c['end_tick']),'monitor_url':monitor.url,'demo_timescale':timescale},ensure_ascii=False)),encoding='utf-8')
    # Disable CS2 demo prediction before loading the demo. Prediction can
    # advance the client command stream while demo_gototick/spec locking is
    # settling, which may leave the observer on the wrong player or make the
    # capture start before the requested tick. Keep this in the startup CFG
    # so it is applied on every fresh HLAE/CS2 launch.
    encoder='mirv_streams settings edit afxDefault settings afxFfmpegYuv420p\n'
    encoder+='mirv_streams record screen settings afxFfmpegYuv420p\n'
    console_log=str(out/'game-console.log').replace(chr(92),chr(47))
    def enabled(name):
        return os.environ.get(name, '').strip().lower() in {'1', 'true', 'yes', 'on'}
    # These are intentionally explicit CS2 console switches. They are applied
    # on every isolated launch, so recording settings never leak into Steam's
    # normal profile or depend on a stale autoexec.
    visual = [
        f"cl_drawhud {0 if enabled('CS2_POV_HIDE_HUD') else 1}",
        f"r_drawviewmodel {0 if enabled('CS2_POV_HIDE_VIEWMODEL') else 1}",
        f"spec_show_xray {1 if enabled('CS2_POV_SHOW_XRAY') else 0}",
        # CS2 names this mode "draw only death notices": it keeps the kill
        # feed visible while removing the rest of the HUD.
        f"cl_draw_only_deathnotices {1 if enabled('CS2_POV_HIDE_KILLFEED') else 0}",
    ]
    custom = os.environ.get('CS2_POV_CUSTOM_CFG')
    custom_command = ''
    if custom and pathlib.Path(custom).is_file():
        # Snapshot into the isolated profile, preserving spaces/Unicode paths.
        custom_name = f'csdemo_custom_{cfg_token}.cfg'
        (cfg_dir/custom_name).write_text(pathlib.Path(custom).read_text(encoding='utf-8-sig'), encoding='utf-8')
        custom_command = f'exec {custom_name}\n'
    start=f'con_logfile "{console_log}"\ncl_demo_predict 0\ndemo_timescale 1\nspec_autodirector 0\n' + '\n'.join(visual) + '\n' + custom_command + 'mirv_streams record screen enabled 1\nmirv_streams record fps 60\n'+encoder+f'mirv_script_load "{str(runtime_script).replace(chr(92),chr(47))}"\n'
    (cfg_dir/cfg_name).write_text(start,encoding='utf-8'); (cfg_dir/stop_name).write_text('demo_pause\nmirv_streams record end\n',encoding='utf-8')
    # USRLOCALCSGO redirects video and user settings before CS2 initializes.
    # The cloud-disable flag alone does not isolate local Steam configuration.
    launch_args=launch_arguments(hlae,cs2,dll,cfg_name,profile)
    # Ensure a previous failed export cannot supply a stale CS2 window.
    (out/'wrapper-started.log').write_text(f'python_pid={os.getpid()}\n',encoding='utf-8')
    # HLAE custom loader must own the only CS2 process. Starting another
    # instance produces a modal "Only one instance" warning and can leave
    # the export worker retrying forever.
    existing = subprocess.run(['tasklist','/FI','IMAGENAME eq cs2.exe','/NH'],capture_output=True,text=True,errors='replace')
    if 'cs2.exe' in existing.stdout.lower():
        (out/'startup-error.log').write_text('CS2 正在运行，请先手动关闭游戏再录制；不会强制关闭你的游戏。',encoding='utf-8')
        raise SystemExit('CS2 is already running; close it before recording')
    steam=subprocess.run(['tasklist','/FI','IMAGENAME eq steam.exe','/NH'],capture_output=True,text=True,errors='replace')
    if 'steam.exe' not in steam.stdout.lower():
        raise SystemExit('Steam is not running; start Steam before recording')
    (out/'hlae-launch-command.txt').write_text(json.dumps(launch_args,ensure_ascii=False,indent=2),encoding='utf-8')
    # Keep the HLAE loader process hidden; CS2 itself remains visible because
    # the recorder needs its rendered game window for screen capture.
    startupinfo=subprocess.STARTUPINFO()
    startupinfo.dwFlags|=subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow=subprocess.SW_HIDE
    p=subprocess.Popen(launch_args,cwd=str(pathlib.Path(hlae).parent),env=launch_environment(),startupinfo=startupinfo,stdout=(out/'loader.log').open('w',encoding='utf-8'),stderr=subprocess.STDOUT,text=True)
    time.sleep(3)
    (out/'hlae-launch-status.txt').write_text(f'pid={p.pid} poll={p.poll()}\n',encoding='utf-8')
    capture_duration=max(3,(int(c['end_tick'])-int(c['start_tick']))/64+3); startup_deadline=time.time()+60
    hwnd=0
    while time.time()<startup_deadline:
        hwnd=find_game_window() or hwnd
        if hwnd: break
        time.sleep(.5)
    if not hwnd: raise SystemExit('Counter-Strike 2 window not found after HLAE launch')
    deadline=time.monotonic()+max(180, len(players)*(capture_duration+90))
    def game_running():
        check=subprocess.run(['tasklist','/FI','IMAGENAME eq cs2.exe','/NH'],capture_output=True,text=True,errors='replace')
        return 'cs2.exe' in check.stdout.lower()
    while game_running() and time.monotonic()<deadline:
        time.sleep(1)
    if game_running():
        raise SystemExit('Batch capture timed out; game left paused for diagnosis')
    monitor.validate(enriched, int(c['start_tick']), int(c['end_tick']))
    for player in enriched:
        root=pathlib.Path(player['capture_path'])
        videos=sorted(root.glob('take*/video.mp4'))
        if not videos:
            raise SystemExit(f"HLAE 未输出视频（玩家 {player['steamid']}）。请检查 FFmpeg 路径和编码器；诊断文件：{out/'encoder-config.log'}")
        if not (videos[-1].parent/'audio.wav').is_file():
            raise SystemExit(f"Capture incomplete for {player['steamid']}; HLAE/CS2 exit code {p.returncode}")

def main():
    import argparse
    ap=argparse.ArgumentParser(); ap.add_argument('config'); a=ap.parse_args()
    c=json.loads(pathlib.Path(a.config).read_text(encoding='utf-8'))
    out=pathlib.Path(c['output_dir']).resolve(); out.mkdir(parents=True,exist_ok=True)
    with CaptureMonitor(out) as monitor:
        run_capture(c, monitor)

if __name__=='__main__': main()

