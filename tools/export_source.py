"""Export tracked public source while excluding local handoff and private files."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import subprocess
import zipfile

PUBLIC_DOCUMENTS = {'STATISTICS_RULES.md','GAME_ASSETS.md','PORTABLE_THIRD_PARTY.md','CS2_CAM_QUICK_START.md'}
PRIVATE_PARTS = {'.git','.cache','node_modules','target','dist','data','uploads','avatars','pov-output','__pycache__','.pov-profile'}
PRIVATE_SUFFIXES = {'.dem','.sqlite3','.sqlite','.db','.log','.mp4','.webm','.pyc','.pem','.key'}

def public_path(relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts: raise ValueError('Invalid source path')
    if path.name in {'AGENTS.md','HANDOFF.md','.env'} or any(part.lower() in PRIVATE_PARTS or part.startswith('.venv') for part in path.parts): return None
    if path.suffix.lower() in PRIVATE_SUFFIXES or path.name.endswith(('-wal','-shm')): return None
    if path.parts[0] == 'docs':
        return path.name if len(path.parts)==2 and path.name in PUBLIC_DOCUMENTS else None
    return path.as_posix()

def export(root, output):
    files = subprocess.check_output(['git','ls-files','-z'],cwd=root).decode('utf-8').split('\0')
    entries = {}
    for relative in filter(None,files):
        name = public_path(relative)
        if name is None: continue
        source = root / relative
        if not source.is_file(): continue
        if source.is_symlink(): raise ValueError('Source symlinks must not be published')
        if name in entries and relative.startswith('docs/'): continue
        entries[name] = source
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,source in sorted(entries.items()):
            data=source.read_bytes()
            if name.endswith('README.md'):
                text=data.decode('utf-8')
                for document in PUBLIC_DOCUMENTS:text=text.replace('docs/'+document,document)
                text=text.replace('docs/PORTABLE_BUILD.md','README.md')
                data=text.encode('utf-8')
            archive.writestr('CS2-Cam/'+name,data)
    with output.open('rb') as file:digest=hashlib.file_digest(file,'sha256').hexdigest()
    output.with_suffix(output.suffix+'.sha256').write_text(f'{digest}  {output.name}\n',encoding='ascii')
    return len(entries)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    print(f'Exported {export(root,args.output)} public source files: {args.output}')
