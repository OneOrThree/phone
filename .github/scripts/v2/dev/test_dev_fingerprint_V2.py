import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('fingerprint', Path(__file__).with_name('dev-fingerprint-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class FingerprintTest(unittest.TestCase):
    """진짜 임시 Git 저장소로 지문을 계산한다. git을 목으로 덮으면 ls-tree 동작을 검증하지 못한다."""

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.git('init', '-q')
        for service in m.SERVICES:
            self.write(f'server/{service}/src/Main.java', 'class Main {}')
            self.write(f'server/{service}/README.md', '문서')
        self.first = self.commit('첫 커밋')

    def git(self, *args):
        env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
        return subprocess.run(['git', *args], cwd=self.root, env=env, check=True, stdout=subprocess.PIPE).stdout.decode().strip()

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, message):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', message)
        return self.git('rev-parse', 'HEAD')

    def fingerprints(self, revision):
        previous = os.getcwd()
        os.chdir(self.root)
        try:
            return m.fingerprint(revision)
        finally:
            os.chdir(previous)

    def test_md_change_keeps_fingerprint(self):
        self.write('server/data-api/README.md', '문서 수정')
        self.write('server/notification/docs/new.md', '새 문서')
        self.assertEqual(self.fingerprints(self.first), self.fingerprints(self.commit('문서만')))

    def test_non_md_change_changes_only_that_service(self):
        self.write('server/data-api/src/Main.java', 'class Main { int x; }')
        before, after = self.fingerprints(self.first), self.fingerprints(self.commit('코드'))
        self.assertNotEqual(before['data-api'], after['data-api'])
        self.assertEqual(before['realtime'], after['realtime'])


if __name__ == '__main__':
    unittest.main()
