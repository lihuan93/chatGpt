"""Exercise the real upgrade shell with a mocked macOS Foundation bridge on Linux."""
from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent

class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='diffnote upgrade ')
        self.base = Path(self.tmp.name)
        self.package = self.base / 'new package'
        self.package.mkdir()
        self.source = self.package / 'diffnote'
        shutil.copytree(ROOT / 'extension', self.source)
        self.target = self.base / 'old custom folder'
        shutil.copytree(ROOT / 'extension', self.target)
        self.script = self.package / '更新Mac.command'
        osascript = self.base / 'osascript-mock'
        osascript.write_text('''#!/usr/bin/env node
const fs=require('fs'),vm=require('vm');
const sandbox={ObjC:{import(){},unwrap:x=>x},$:{NSUTF8StringEncoding:4,NSString:{stringWithContentsOfFileEncodingError(path){try{return fs.readFileSync(path,'utf8')}catch{return null}}},NSFileManager:{defaultManager:{isReadableFileAtPath(path){try{fs.accessSync(path,fs.constants.R_OK);return true}catch{return false}}}}}};
try {vm.createContext(sandbox);vm.runInContext(fs.readFileSync(0,'utf8'),sandbox);console.log(sandbox.run([process.argv.at(-1)]));}catch(e){console.error(e.message);process.exit(1)}
''')
        osascript.chmod(0o755)
        ditto = self.base / 'ditto-mock'
        ditto.write_text('#!/usr/bin/env python3\nimport shutil,sys\nshutil.copytree(sys.argv[1],sys.argv[2],dirs_exist_ok=True)\n')
        ditto.chmod(0o755)
        shell = (ROOT / '更新Mac.command').read_text()
        # Only replace platform executables in a temporary copy, never production code.
        self.script.write_text(shell.replace('/usr/bin/osascript', '"' + str(osascript) + '"').replace('/usr/bin/ditto', '"' + str(ditto) + '"'))
        self.script.chmod(0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def run_upgrade(self, shell='bash', target=None):
        return subprocess.run([shell, str(self.script), str(target or self.target)], capture_output=True, text=True)

    def assert_success(self, shell='bash'):
        before = self.target.stat().st_ino
        manifest_inode = (self.target / 'manifest.json').stat().st_ino
        (self.target / 'index.html').write_text('<title>DiffNote · 文本对比</title>old code')
        (self.target / 'keep-user-file.txt').write_text('keep')
        result = self.run_upgrade(shell)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.target.stat().st_ino, before)
        self.assertEqual((self.target / 'manifest.json').stat().st_ino, manifest_inode)
        backups = list(self.base.glob('diffnote-backup.*'))
        self.assertEqual(len(backups), 1)
        self.assertIn('old code', (backups[0] / 'index.html').read_text())
        self.assertEqual((self.target / 'keep-user-file.txt').read_text(), 'keep')
        for file in self.source.rglob('*'):
            if file.is_file():
                self.assertEqual(file.read_bytes(), (self.target / file.relative_to(self.source)).read_bytes())

    def test_bash_preserves_original_directory_and_manifest_inodes_and_backup(self):
        self.assert_success()

    def test_sh_switches_to_bash(self):
        self.assert_success('sh')

    def test_repair_broken_or_missing_old_manifest(self):
        for value in ['not json', None]:
            with self.subTest(value=value):
                if value is None:
                    (self.target / 'manifest.json').unlink()
                else:
                    (self.target / 'manifest.json').write_text(value)
                result = self.run_upgrade()
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads((self.target / 'manifest.json').read_text())['version'], json.loads((ROOT / 'extension/manifest.json').read_text())['version'])

    def test_incomplete_source_changes_nothing(self):
        (self.source / 'app.js').unlink()
        before = (self.target / 'manifest.json').read_bytes()
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.target / 'manifest.json').read_bytes(), before)
        self.assertEqual(list(self.base.glob('diffnote-backup.*')), [])

    def test_wrong_extension_and_plain_directory_rejected(self):
        for manifest in [{'manifest_version': 3, 'name': 'Other extension'}, None]:
            with self.subTest(manifest=manifest):
                (self.target / 'manifest.json').write_text(json.dumps(manifest))
                (self.target / 'index.html').write_text('ordinary folder')
                result = self.run_upgrade()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(list(self.base.glob('diffnote-backup.*')), [])

    def test_symlink_parent_rejected_before_any_copy(self):
        shutil.rmtree(self.target / 'vendor')
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'code-editor.js').write_text('must stay')
        (self.target / 'vendor').symlink_to(outside, target_is_directory=True)
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((outside / 'code-editor.js').read_text(), 'must stay')
        self.assertEqual(list(self.base.glob('diffnote-backup.*')), [])

    def test_package_source_and_ancestor_rejected(self):
        for target in [self.source, self.package]:
            result = self.run_upgrade(target=target)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.base.glob('diffnote-backup.*')), [])

    def test_repository_layout(self):
        self.source.rename(self.package / 'extension')
        self.source = self.package / 'extension'
        self.assert_success()

if __name__ == '__main__':
    unittest.main()
