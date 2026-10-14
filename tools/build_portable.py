"""Build a Windows x64 trial folder from explicit, local runtime sources.

Never copies a developer database, .env, virtualenv launchers, demos or POVs.
All outputs are new directories under the ignored .cache/portable-builds.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PYTHON_URL = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
PYTHON_MD5 = 'fe8ef205f2e9c3ba44d0cf9954e1abd3'
APP_FILES = ['main.cjs', 'preload.cjs', 'portable-runtime.cjs', 'backend-build.cjs', 'package.json', 'updater.cjs', 'release-config.json', 'install-update.ps1', 'assets/app-icon.ico', 'assets/app-icon.png']
ROOT_SCRIPTS = ['demoparser2_mysql.py', 'team_names.py', 'flash_blinds.py', 'replay_positions.py', 'replay_effects.py', 'db_schema.py', 'match_scoring.py', 'steam_avatar_scraper.py', 'requirements.txt', 'sqlite_schema.sql', 'sqlite_schema_v2.sql']
POV_FILES = ['export_single_pov.ps1', 'hlae_wrapper.ps1', 'hlae_wrapper.py', 'batch_capture.js', 'recording_profile.py', 'capture_monitor.py']


def document_path(name):
    local = ROOT / 'docs' / name
    return local if local.is_file() else ROOT / name


def copy_file(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def copy_tree(source, destination):
    shutil.copytree(source, destination, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'tests', '.env', '*.log', '*.dem'))


def run(command, cwd=None):
    print('Building:', Path(command[0]).name, flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def find(command):
    result = shutil.which(command)
    if not result:
        raise RuntimeError(f'Build prerequisite not found: {command}')
    return Path(result).resolve()


def manifest(app,version):
    entries=[]
    for file in sorted(app.rglob('*')):
        if file.is_file() and file.name!='update-manifest.json':
            relative=file.relative_to(app).as_posix()
            if any(part.lower() in {'data','uploads','avatars','pov-output'} for part in file.relative_to(app).parts):raise RuntimeError('Personal data in release: '+relative)
            if file.name.lower() in {'hlae.exe','ffmpeg.exe','ffprobe.exe'} or file.suffix.lower() in {'.dem','.sqlite3','.log'}:raise RuntimeError('Test tool/data in release: '+relative)
            entries.append({'path':relative,'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest()})
    (app/'update-manifest.json').write_text(json.dumps({'product':'CS2 Cam','version':version,'files':entries},indent=2),encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hlae-home', type=Path, help='Optional HLAE directory. Omit to ship a statistics-only package and configure recording tools in Settings.')
    ap.add_argument('--java-home', type=Path)
    ap.add_argument('--ffprobe', type=Path)
    ap.add_argument('--jar', type=Path, help='Explicit validated backend JAR; otherwise use last build marker')
    ap.add_argument('--skip-build', action='store_true', help='Reuse already validated JAR/frontend artifacts')
    archive_options = ap.add_mutually_exclusive_group()
    archive_options.add_argument('--zip', action='store_true', help='Also create a distribution ZIP (opt-in)')
    archive_options.add_argument('--no-zip', action='store_true', help='Compatibility option; folder-only is the default')
    args = ap.parse_args()
    if sys.platform != 'win32' or sys.version_info[:2] != (3, 12):
        raise RuntimeError('Run the builder with Windows x64 Python 3.12')
    if args.hlae_home:
        for source in [args.hlae_home / 'HLAE.exe', args.hlae_home / 'x64/AfxHookSource2.dll', args.hlae_home / 'ffmpeg/bin/ffmpeg.exe']:
            if not source.is_file():
                raise RuntimeError(f'Missing runtime source: {source}')
    java_home = args.java_home or find('java').parents[1]
    ffprobe = (args.ffprobe or find('ffprobe')) if args.hlae_home else None
    build_id = str(uuid.uuid4())
    output = ROOT / '.cache/portable-builds' / build_id
    app_dir = output / 'CS2 Cam'
    output.mkdir(parents=True)
    if not args.skip_build:
        run([str(find('node')), str(ROOT / 'electron/backend-build.cjs')], ROOT)
        run([os.environ.get('ComSpec', 'cmd.exe'), '/d', '/c', 'npm run build'], ROOT / 'web')
    if args.jar:
        jar = args.jar.resolve()
    else:
        marker = json.loads((ROOT / 'server/.cache/electron-backend.json').read_text(encoding='utf-8'))
        jar = ROOT / 'server' / marker['jar']
        jar.resolve().relative_to((ROOT / 'server/.cache/electron-builds').resolve())
    with zipfile.ZipFile(jar) as archive:
        if not any(name.startswith('BOOT-INF/classes/') for name in archive.namelist()):
            raise RuntimeError('Backend artifact is not a repackaged Spring Boot JAR')
    electron = ROOT / 'electron/node_modules/electron/dist'
    if not (electron / 'electron.exe').is_file():
        raise RuntimeError('Build Electron dependencies in electron/ first')
    for child in electron.iterdir():
        if child.name == 'electron.exe':
            copy_file(child, app_dir / 'CS2 Cam.exe')
        elif child.is_dir():
            copy_tree(child, app_dir / child.name)
        else:
            copy_file(child, app_dir / child.name)
    # Leave default_app.asar unused: resources/app/package.json selects our application.
    resources = app_dir / 'resources'
    run([str(find('node')), str(ROOT / 'electron/app-icon.cjs'), str(app_dir / 'CS2 Cam.exe')], ROOT)
    for name in APP_FILES:
        copy_file(ROOT / 'electron' / name, resources / 'app' / name)
    project = resources / 'project'
    copy_file(jar, project / 'server/target/demo-show-0.0.1-SNAPSHOT.jar')
    copy_tree(ROOT / 'web/dist', project / 'web/dist')
    for name in ROOT_SCRIPTS:
        copy_file(ROOT / name, project / name)
    for name in ['GAME_ASSETS.md', 'STATISTICS_RULES.md', 'PORTABLE_THIRD_PARTY.md']:
        copy_file(document_path(name), project / 'docs' / name)
    for name in POV_FILES:
        copy_file(ROOT / 'tools/pov' / name, project / 'tools/pov' / name)
    for name in ['record_worker.py', 'portable_database.py']:
        copy_file(ROOT / 'tools' / name, project / 'tools' / name)
    exporter = ROOT / 'tools/replay_positions/replay_positions.exe'
    if not exporter.is_file():
        run([str(find('go')), 'build', '-o', str(exporter), '.'], exporter.parent)
    copy_file(exporter, project / 'tools/replay_positions/replay_positions.exe')

    runtime = resources / 'runtime'
    print('Preparing bundled Java, Python, SQLite and HLAE...', flush=True)
    run([str(java_home / 'bin/jlink.exe'), '--add-modules', 'java.se,jdk.crypto.ec,jdk.unsupported,jdk.management,jdk.charsets,jdk.zipfs,jdk.naming.dns',
         '--strip-debug', '--no-header-files', '--no-man-pages', '--output', str(runtime / 'java')])
    if (java_home / 'NOTICE').exists():
        copy_file(java_home / 'NOTICE', runtime / 'java/NOTICE')
    cache = ROOT / '.cache/portable-downloads/python-3.12.10-embed-amd64.zip'
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists():
        urllib.request.urlretrieve(PYTHON_URL, cache)
    if hashlib.md5(cache.read_bytes()).hexdigest() != PYTHON_MD5:
        raise RuntimeError('Embedded Python archive differs from Python.org release checksum')
    python = runtime / 'python'
    with zipfile.ZipFile(cache) as archive:
        archive.extractall(python)
    (python / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages\n../../project\n../../project/tools/pov\nimport site\n', encoding='utf-8')
    source_packages = Path(sys.prefix) / 'Lib/site-packages'
    # Use the exact locally verified parser dependency set, with its dist-info/licenses.
    for child in source_packages.iterdir():
        if child.name.startswith(('pip', 'vpk')) or child.name == '__pycache__':
            continue
        destination = python / 'Lib/site-packages' / child.name
        if child.is_dir():
            copy_tree(child, destination)
        elif child.suffix in ('.py', '.pyd', '.dll', '.pth'):
            copy_file(child, destination)
    if args.hlae_home:
        for source in (args.hlae_home / 'x64').glob('*140*.dll'):
            copy_file(source, python / source.name)
            copy_file(source, runtime / 'java/bin' / source.name)
    # Confirm this Python does not depend on sys.base_prefix, PATH or the build venv.
    run([str(python / 'python.exe'), '-c', 'import demoparser2,pandas,numpy,pyarrow,polars,sqlite3,websockets,db_schema; print("Bundled Python imports OK")'], output)
    if args.hlae_home:
        copy_tree(args.hlae_home, runtime / 'hlae')
        copy_file(ffprobe, runtime / 'hlae/ffmpeg/bin/ffprobe.exe')
        ffprobe_notice = ffprobe.parent.parent / 'LICENSE'
        if ffprobe_notice.exists():
            copy_file(ffprobe_notice, runtime / 'hlae/ffmpeg/FFPROBE-LICENSE')
    licenses = resources / 'licenses'
    copy_file(document_path('PORTABLE_THIRD_PARTY.md'), licenses / 'THIRD-PARTY.md')
    copy_file(document_path('CS2_CAM_QUICK_START.md'), app_dir / '使用说明.md')
    version = json.loads((ROOT / 'electron/package.json').read_text(encoding='utf-8'))['version']
    info = {'version': version, 'product': 'CS2 Cam', 'platform': 'win32-x64', 'build': build_id,
            'python': '3.12.10', 'database': 'SQLite', 'dataDirectory': 'data',
            'recordingTools': bool(args.hlae_home),
            'sources': {'python': PYTHON_URL, 'sqlite': 'https://www.sqlite.org/', 'hlae': 'https://github.com/advancedfx/advancedfx/releases/tag/v2.192.5', 'ffmpeg': 'https://github.com/BtbN/FFmpeg-Builds/releases'}}
    (resources / 'portable.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
    manifest(app_dir, version)
    run([str(runtime / 'java/bin/java.exe'), '-version'])
    if args.hlae_home:
        run([str(runtime / 'hlae/ffmpeg/bin/ffprobe.exe'), '-version'])
    if args.zip:
        zip_app(app_dir, output / f'CS2-Cam-{version}-win-x64.zip')
    (ROOT / '.cache/portable-build-latest.json').write_text(json.dumps({'build': build_id, 'directory': str(app_dir)}), encoding='utf-8')
    print(f'PORTABLE_FOLDER={app_dir}', flush=True)


def zip_app(app_dir, destination):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
        for file in sorted(app_dir.rglob('*')):
            if file.is_file() and file.relative_to(app_dir).parts[0] != 'data':
                archive.write(file, Path(app_dir.name) / file.relative_to(app_dir))
    with destination.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    destination.with_suffix('.zip.sha256').write_text(f'{digest}  {destination.name}\n', encoding='ascii')


if __name__ == '__main__':
    main()
