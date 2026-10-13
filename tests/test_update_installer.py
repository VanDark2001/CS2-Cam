import hashlib,json,os,subprocess,tempfile,unittest,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
HELPER=ROOT/'electron/install-update.ps1'

@unittest.skipUnless(os.name=='nt','Windows portable installer')
class InstallerTest(unittest.TestCase):
    def setUp(self):
        (ROOT/'.cache').mkdir(exist_ok=True)

    def package(self,base):
        app=base/'installed';app.mkdir();(app/'CS2 Cam.exe').write_bytes(b'old executable')
        for relative in ['data/csdemo.sqlite3','resources/project/data/settings.json']:
            file=app/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'personal data')
        work=base/'work';work.mkdir();payload={'CS2 Cam.exe':b'new executable','resources/app/package.json':b'{"version":"0.2.0"}'}
        manifest={'product':'CS2 Cam','version':'0.2.0','files':[{'path':p,'sha256':hashlib.sha256(v).hexdigest()} for p,v in payload.items()]}
        archive=work/'update.zip'
        with zipfile.ZipFile(archive,'w') as z:
            for name,data in payload.items():z.writestr('CS2 Cam/'+name,data)
            z.writestr('CS2 Cam/update-manifest.json',json.dumps(manifest))
        plan=work/'plan.json';plan.write_text(json.dumps({'appRoot':str(app),'work':str(work),'archive':str(archive),'expectedVersion':'0.2.0','parentPid':0,'resultFile':str(work/'result.json')}),encoding='utf-8')
        return app,work,plan
    def run_helper(self,plan,*extra):
        shell=Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
        return subprocess.run([str(shell),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(HELPER),'-Plan',str(plan),*extra],capture_output=True,timeout=60)
    def test_install_preserves_both_data_locations(self):
        with tempfile.TemporaryDirectory(prefix='cs2-update-',dir=ROOT/'.cache') as directory:
            app,work,plan=self.package(Path(directory))
            ready=self.run_helper(plan,'-PrepareOnly');self.assertEqual(ready.returncode,0,ready.stderr)
            result=self.run_helper(plan,'-NoRestart');self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual((app/'CS2 Cam.exe').read_bytes(),b'new executable')
            self.assertEqual((work/'backup/CS2 Cam.exe').read_bytes(),b'old executable')
            self.assertEqual((app/'data/csdemo.sqlite3').read_bytes(),b'personal data')
            self.assertEqual((app/'resources/project/data/settings.json').read_bytes(),b'personal data')
            self.assertTrue(json.loads((work/'result.json').read_text(encoding='utf-8'))['success'])
    def test_failure_rolls_back_already_replaced_files(self):
        with tempfile.TemporaryDirectory(prefix='cs2-update-',dir=ROOT/'.cache') as directory:
            app,work,plan=self.package(Path(directory))
            (app/'resources/app/package.json').mkdir(parents=True)
            self.assertEqual(self.run_helper(plan,'-PrepareOnly').returncode,0)
            result=self.run_helper(plan,'-NoRestart');self.assertNotEqual(result.returncode,0)
            self.assertEqual((app/'CS2 Cam.exe').read_bytes(),b'old executable')
            self.assertFalse(json.loads((work/'result.json').read_text(encoding='utf-8'))['success'])
    def test_zip_cannot_escape_the_staging_directory(self):
        with tempfile.TemporaryDirectory(prefix='cs2-update-',dir=ROOT/'.cache') as directory:
            app,work,plan=self.package(Path(directory))
            with zipfile.ZipFile(work/'update.zip','a') as z:z.writestr('../../escaped.txt','escape')
            self.assertNotEqual(self.run_helper(plan,'-PrepareOnly').returncode,0)
            self.assertFalse((Path(directory)/'escaped.txt').exists())
            self.assertEqual((app/'CS2 Cam.exe').read_bytes(),b'old executable')

if __name__=='__main__':unittest.main()
