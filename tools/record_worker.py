import argparse, json, os, pathlib, subprocess, time, shutil, sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def validate_media_interval(ffprobe, video, audio, seconds, name):
    for media, kind in [(video, 'video'), (audio, 'audio')]:
        probe = subprocess.run([str(ffprobe), '-v', 'error', '-show_entries',
                                'format=duration', '-of', 'json', str(media)],
                               capture_output=True, text=True, check=True)
        duration = float(json.loads(probe.stdout)['format']['duration'])
        if not duration > 0 or abs(duration - seconds) > .5:
            raise RuntimeError(f'Incomplete {kind} for {name}: {duration:.3f}s, expected {seconds:.3f}s')

def media_duration(ffprobe, media):
    probe = subprocess.run([str(ffprobe), '-v', 'error', '-show_entries',
                            'format=duration', '-of', 'json', str(media)],
                           capture_output=True, text=True, check=True)
    return float(json.loads(probe.stdout)['format']['duration'])

def audio_tempo_filter(speed):
    """Build atempo filters that slow a fast capture back to normal time."""
    factor = 1.0 / speed
    filters = []
    while factor < 0.5:
        filters.append('atempo=0.5')
        factor /= 0.5
    while factor > 2.0:
        filters.append('atempo=2.0')
        factor /= 2.0
    filters.append(f'atempo={factor:.8g}')
    return ','.join(filters)

def video_encoding_options(bitrate='auto'):
    options = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
               '-force_key_frames', 'expr:gte(t,n_forced)', '-sc_threshold', '0']
    if bitrate == 'auto':
        return options + ['-crf', '18']
    if bitrate not in {'8', '12', '20', '30', '50'}:
        raise ValueError('Unsupported recording bitrate')
    return options + ['-b:v', bitrate + 'M', '-maxrate', bitrate + 'M', '-bufsize', str(int(bitrate) * 2) + 'M']

def finalize_recording(results, output, ffprobe, expected_seconds):
    """Only discard raw takes after every final video has passed validation."""
    output = pathlib.Path(output).resolve()
    for item in results:
        final = pathlib.Path(item['file']).resolve()
        final.relative_to(output / 'players')
        probe = subprocess.run([str(ffprobe), '-v', 'error', '-show_entries',
                                'stream=codec_type', '-of', 'json', str(final)],
                               capture_output=True, text=True, check=True)
        kinds = {stream.get('codec_type') for stream in json.loads(probe.stdout).get('streams', [])}
        if not {'video', 'audio'} <= kinds:
            raise RuntimeError('Final POV is missing audio or video: ' + str(final))
        validate_media_interval(ffprobe, final, final, expected_seconds, item['name'])
    if not results:
        return
    primary = output / 'final.mp4'
    source = pathlib.Path(results[0]['file']).resolve()
    if primary.exists():
        primary.unlink()
    try:
        # Keep the legacy discovery path without duplicating the actual bytes.
        os.link(source, primary)
    except OSError:
        shutil.copyfile(source, primary)
    for item in results:
        raw = pathlib.Path(item['file']).resolve().parent / 'video'
        if raw.is_dir() and not raw.is_symlink():
            raw.resolve().relative_to(output / 'players')
            shutil.rmtree(raw)

def resolve_ffprobe(ffmpeg):
    explicit = os.environ.get('FFPROBE_EXE')
    sibling = pathlib.Path(ffmpeg).with_name('ffprobe.exe')
    candidate = explicit or (str(sibling) if sibling.is_file() else shutil.which('ffprobe'))
    if not candidate or not pathlib.Path(candidate).is_file():
        raise RuntimeError('FFprobe is required to validate full-round recordings; set FFPROBE_EXE or install FFprobe on PATH')
    return pathlib.Path(candidate)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--task',required=True); ap.add_argument('--output',required=True)
    a=ap.parse_args(); task=json.loads(pathlib.Path(a.task).read_text(encoding='utf-8')); out=pathlib.Path(a.output); out.mkdir(parents=True,exist_ok=True)
    demo=os.environ.get('CS2_DEMO') or task.get('demo_path');
    if not demo or not pathlib.Path(demo).is_file(): raise SystemExit('CS2_DEMO/demo_path must point to an existing .dem')
    players=task.get('players') or []
    if not players: raise SystemExit('at least one player is required')
    # Stop just before the next round's actual freeze/buy phase begins.
    # The backend resolves this from Demo phase events, never a duration.
    capture_end_tick=int(task.get('captureEndTick',task['endTick']))
    cfg=out/'hlae-worker.json'; cfg.write_text(json.dumps({'demo_path':str(pathlib.Path(demo).resolve()),'players':players,'start_tick':int(task['startTick']),'end_tick':capture_end_tick,'requested_end_tick':int(task['endTick']),'output_dir':str(out)},ensure_ascii=False,indent=2),encoding='utf-8')
    hlae=os.environ.get('HLAE_EXE',''); cs2=os.environ.get('CS2_EXE','')
    if not pathlib.Path(hlae).is_file(): raise SystemExit(f'HLAE not found: {hlae}')
    if not pathlib.Path(cs2).is_file(): raise SystemExit(f'CS2 not found: {cs2}')
    ffmpeg=os.environ.get('FFMPEG_EXE','')
    if not ffmpeg: raise SystemExit('FFmpeg 路径未设置，请在设置页选择 FFmpeg')
    ffprobe=resolve_ffprobe(ffmpeg)
    try:
        timescale=max(1.0,float(os.environ.get('CS2_POV_TIMESCALE','1')))
    except ValueError:
        timescale=1.0
    launcher=os.environ.get('HLAE_LAUNCH_ARGS','').strip()
    args=[hlae]
    if launcher: args += launcher.split()
    args += ['-console','-insecure',cs2]
    (out/'launch-command.txt').write_text(' '.join(args),encoding='utf-8')
    # HLAE command line options vary by version; allow an explicit wrapper for production.
    wrapper=os.environ.get('HLAE_WRAPPER', str(pathlib.Path(__file__).parent/'pov'/'hlae_wrapper.ps1'))
    if wrapper:
        lock=pathlib.Path(os.environ.get('POV_LOCK',str(out.parent.parent.parent/'.pov-record.lock')))
        try:
            fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
            os.write(fd,str(os.getpid()).encode()); os.close(fd)
        except FileExistsError:
            # Recover locks left behind by a terminated worker.
            try:
                owner=int(lock.read_text(encoding='utf-8').strip())
                os.kill(owner,0)
            except (FileNotFoundError,ValueError,ProcessLookupError,OSError):
                lock.unlink(missing_ok=True)
                fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
                os.write(fd,str(os.getpid()).encode()); os.close(fd)
            else:
                raise SystemExit('another POV recording is already running')
        try:
            # Keep the capture subprocess separate from the backend's render.log;
            # two open writers otherwise overwrite the original failure details.
            capture_log=out/'capture.log'
            with capture_log.open('w',encoding='utf-8') as log:
                # Full-round POVs run sequentially; ten long rounds can exceed
                # the old fixed 15-minute limit even without a recording fault.
                timeout=max(900, len(players)*((capture_end_tick-int(task['startTick']))/64+93)+120)
                try:
                    subprocess.run([os.environ.get('CS2_POWERSHELL','powershell.exe'),'-ExecutionPolicy','Bypass','-File',wrapper,str(cfg)],check=True,timeout=timeout,stdout=log,stderr=subprocess.STDOUT,text=True)
                except subprocess.CalledProcessError as error:
                    log.flush()
                    detail=capture_log.read_text(encoding='utf-8',errors='replace')[-3000:]
                    raise RuntimeError('HLAE capture failed: '+detail) from error
        finally:
            try: lock.unlink()
            except FileNotFoundError: pass
    else:
        raise SystemExit('Set HLAE_WRAPPER to the tested HLAE injection wrapper before recording')
    results=[]
    for p in players:
        name=str(p.get('name') or p.get('steamid') or p.get('slot') or 'player') if isinstance(p,dict) else str(p)
        pdir=out/'players'/f'player_{players.index(p)}'; videos=sorted(pdir.glob('video/take*/video.mp4'))
        video=videos[-1] if videos else next(iter(pdir.glob('**/video.mp4')),None)
        audio=(video.parent/'audio.wav') if video else None
        if not audio or not audio.exists(): audio=next(iter(pdir.glob('**/audio.wav')),None)
        if not video or not audio: raise SystemExit(f'HLAE did not produce video/audio for {name}')
        expected_seconds=(capture_end_tick-int(task['startTick']))/64
        raw_seconds=expected_seconds/timescale
        video_seconds=media_duration(ffprobe,video)
        audio_seconds=media_duration(ffprobe,audio)
        stretch=timescale>1.0 and abs(video_seconds-raw_seconds)<=.5 and abs(audio_seconds-raw_seconds)<=.5
        if not stretch:
            validate_media_interval(ffprobe, video, audio, expected_seconds, name)
        # A loading-screen capture can be encoded as a 1600x96 strip when the
        # first POV starts before the CS2 renderer is ready. Do not publish it
        # as a playable POV; fail with a diagnostic so the job can be retried.
        if ffprobe.exists():
            probe=subprocess.run([str(ffprobe),'-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',str(video)],capture_output=True,text=True)
            dims=probe.stdout.strip().split(',')
            if len(dims)==2 and (int(dims[0])<300 or int(dims[1])<300):
                raise SystemExit(f'Invalid POV video dimensions for {name}: {probe.stdout.strip()}')
        pf=pdir/'final.mp4'
        bitrate = os.environ.get('CS2_POV_BITRATE', 'auto')
        if stretch:
            # Fast demo playback produces a short raw take. Stretch both
            # streams back to the authored tick interval so the web timeline
            # remains one-to-one with the Demo.
            subprocess.run([ffmpeg,'-y','-i',str(video),'-i',str(audio),
                            '-filter_complex',f'[0:v]setpts={timescale:g}*PTS[v];[1:a]{audio_tempo_filter(timescale)}[a]',
                            '-map','[v]','-map','[a]',*video_encoding_options(bitrate),
                            '-c:a','aac','-shortest','-movflags','+faststart',str(pf)],check=True)
        else:
            encoding = video_encoding_options(bitrate)
            subprocess.run([ffmpeg,'-y','-i',str(video),'-i',str(audio),'-map','0:v:0','-map','1:a:0',*encoding,'-c:a','aac','-shortest','-movflags','+faststart',str(pf)],check=True)
        results.append({'name':name,'file':str(pf)})
    # The backend discovers completed jobs through this common entry file,
    # including single-player recordings.
    finalize_recording(results, out, ffprobe, expected_seconds)
    print(json.dumps({'status':'completed','files':results,'file':results[0]['file'] if len(results)==1 else str(out/'final.mp4')},ensure_ascii=False))
if __name__=='__main__': main()


