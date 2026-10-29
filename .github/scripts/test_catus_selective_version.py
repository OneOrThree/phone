"""실제 Git merge 그래프로 백오피스 선별 승격 경계를 검증한다. GitHub API만 대체한다."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('selective_version', Path(__file__).with_name('catus-version.py'))
version = importlib.util.module_from_spec(spec)
spec.loader.exec_module(version)


class SelectivePromotionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.before = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.before)
        self.git('init', '-q', '-b', 'release')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.com')
        self.git('commit', '--allow-empty', '-qm', 'baseline')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-qb', version.SELECTIVE_BRANCH)

    def git(self, *args):
        return subprocess.check_output(['git', *args], text=True, stderr=subprocess.PIPE).strip()

    def promotion(self, path='server/data-api/content.txt', squash=False):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('approved content\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'reviewed change')
        source = self.git('rev-parse', 'HEAD')
        self.git('checkout', 'release')
        if squash:
            self.git('merge', '--squash', version.SELECTIVE_BRANCH)
            self.git('commit', '-qm', 'squashed')
        else:
            self.git('merge', '--no-ff', version.SELECTIVE_BRANCH, '-m', 'approved promotion')
        self.merge = self.git('rev-parse', 'HEAD')
        repo = {'id': 123, 'full_name': 'OneOrThree/phone'}
        return dict(merged_at='2026-10-30', merge_commit_sha=self.merge,
                    base={'ref':'release','repo':dict(repo)},
                    head={'ref':version.SELECTIVE_BRANCH,'sha':source,'repo':dict(repo)},
                    labels=[{'name':'release:minor'}])

    def labels(self, pr):
        original = subprocess.check_output
        def output(args, **kwargs):
            if args[0] == 'gh':
                sha = args[-1].split('/')[-2]
                return json.dumps([[pr]] if sha == self.merge else [[]])
            return original(args, **kwargs)
        with patch.dict(os.environ, {'GITHUB_REPOSITORY':'OneOrThree/phone'}), \
             patch.object(version.subprocess, 'check_output', side_effect=output):
            return version.release_labels(self.merge, self.base)

    def test_reviewed_source_merge_allowed(self):
        self.assertEqual(self.labels(self.promotion()), ['release:minor'])

    def test_missing_or_multiple_version_labels_rejected(self):
        pr = self.promotion()
        for labels in ([], [{'name':'release:major'},{'name':'release:patch'}]):
            with self.subTest(labels=labels), self.assertRaisesRegex(ValueError, '정확히 하나'):
                self.labels({**pr, 'labels':labels})

    def test_fork_or_missing_repository_identity_rejected(self):
        pr = self.promotion()
        for repo in ({}, {'id':124,'full_name':'OneOrThree/phone'},
                     {'id':123,'full_name':'someone/phone'}):
            with self.subTest(repo=repo), self.assertRaisesRegex(ValueError, '같은 저장소'):
                self.labels({**pr,'head':{**pr['head'],'repo':repo}})

    def test_source_sha_must_be_exact_second_parent(self):
        pr = self.promotion()
        with self.assertRaisesRegex(ValueError, '정확한 소스 부모'):
            self.labels({**pr,'head':{**pr['head'],'sha':self.base}})
        with self.assertRaisesRegex(ValueError, '소스 SHA'):
            self.labels({**pr,'head':{**pr['head'],'sha':'main'}})

    def test_squash_rejected(self):
        with self.assertRaisesRegex(ValueError, 'merge commit'):
            self.labels(self.promotion(squash=True))

    def test_unrelated_frontend_change_rejected(self):
        with self.assertRaisesRegex(ValueError, '범위 밖'):
            self.labels(self.promotion('backoffice/server/index.mjs'))

    def test_realtime_change_rejected(self):
        with self.assertRaisesRegex(ValueError, '범위 밖'):
            self.labels(self.promotion('server/realtime/changes.txt'))

    def test_app_change_rejected(self):
        with self.assertRaisesRegex(ValueError, '범위 밖'):
            self.labels(self.promotion('app/changes.txt'))

    def test_rename_from_forbidden_path_rejected(self):
        # 허용 경로로 이동해도 삭제된 원래 경로까지 범위 검사한다.
        file = self.root / 'app/existing.txt'
        file.parent.mkdir()
        file.write_text('existing\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'existing app baseline')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('branch', '-f', 'release', self.base)
        destination = self.root / 'server/data-api/existing.txt'
        destination.parent.mkdir(parents=True)
        self.git('mv', 'app/existing.txt', 'server/data-api/existing.txt')
        with self.assertRaisesRegex(ValueError, '범위 밖.*app/existing.txt'):
            self.labels(self.promotion())

    def test_other_release_branch_not_whitelisted(self):
        pr = self.promotion()
        with self.assertRaisesRegex(ValueError, '소스 브랜치는 main'):
            self.labels({**pr,'head':{**pr['head'],'ref':'release/backoffice-GROMO-9999'}})

    def test_merge_resolution_change_not_in_reviewed_head_rejected(self):
        pr = self.promotion()
        (self.root/'server/data-api/content.txt').write_text('unreviewed merge change\n')
        self.git('add','.')
        self.git('commit','--amend','--no-edit')
        self.merge = self.git('rev-parse','HEAD')
        with self.assertRaisesRegex(ValueError, '검토된 소스와 다르다'):
            self.labels({**pr,'merge_commit_sha':self.merge})

    def test_main_promotion_keeps_existing_behavior(self):
        pr = self.promotion('app/legitimate-main-change.txt')
        pr['head']['ref'] = 'main'
        self.assertEqual(self.labels(pr), ['release:minor'])
        pr['labels'] = []
        self.assertEqual(self.labels(pr), [])

    def test_main_squash_still_rejected(self):
        pr = self.promotion(squash=True)
        pr['head']['ref'] = 'main'
        with self.assertRaisesRegex(ValueError, 'main.*merge commit'):
            self.labels(pr)


if __name__ == '__main__':
    unittest.main()
