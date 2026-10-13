import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('source_export',Path(__file__).resolve().parents[1]/'tools/export_source.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class SourceExportTest(unittest.TestCase):
    def test_handoff_private_data_and_build_outputs_are_excluded(self):
        for name in ['AGENTS.md','docs/design/design.md','docs/design/templates/replay.md','docs/PORTABLE_BUILD.md','.env','data/csdemo.sqlite3','data/database-wal','web/node_modules/x.js','server/target/app.jar','.cache/token.txt','server/pov-output/demo.mp4','avatars/a.jpg']:
            self.assertIsNone(module.public_path(name),name)
    def test_source_and_required_public_documents_are_kept(self):
        self.assertEqual(module.public_path('docs/STATISTICS_RULES.md'),'STATISTICS_RULES.md')
        for name in ['README.md','web/src/theme.css','tools/record_worker.py','.env.example','PORTABLE_THIRD_PARTY.md']:
            self.assertEqual(module.public_path(name),name)
    def test_paths_cannot_escape_the_export(self):
        for name in ['../secret.txt','/secret.txt']:
            with self.assertRaises(ValueError):module.public_path(name)

if __name__=='__main__':unittest.main()
