"""실제 성공 상태를 기준으로 변경된 서비스만 빌드하는 계약을 검증한다."""
import hashlib
import importlib.util
import unittest
import tempfile
import json
import os
import subprocess
import sys
import textwrap
import zipfile
import yaml
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('selective_plan', Path(__file__).with_name('catus-plan.py'))
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


def baseline(source):
    return {'product': 'catus', 'release_id': 'a' * 40 + '-1-1', 'infra_revision': 'b' * 40,
            'source_fingerprints': source,
            'images': {service: f'808715036056.dkr.ecr.ap-northeast-2.amazonaws.com/catus-prod/{service}@sha256:' + 'c' * 64 for service in planner.SERVICES}}


class SelectivePlanTests(unittest.TestCase):
    def test_공통_Gradle_검사_변경은_모든_서비스_지문에_반영된다(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = '.github/workflows/be-gradle.yml'
            path = root / name
            path.parent.mkdir(parents=True)
            path.write_text('before')
            before, _ = planner.fingerprints(root, [name])
            path.write_text('after')
            after, _ = planner.fingerprints(root, [name])
            self.assertTrue(all(before[s] != after[s] for s in planner.SERVICES))

    def setUp(self):
        self.source = {service: hashlib.sha256(service.encode()).hexdigest() for service in planner.SERVICES}
        self.migrations = {service: 'd' * 64 for service in planner.SERVICES}

    def test_Data와_Realtime은_같은_SHA의_이미지_쌍으로_빌드하고_배포한다(self):
        for service in ['data-api', 'realtime']:
            with self.subTest(service=service):
                current = {**self.source, service: 'e' * 64}
                plan = planner.plan(current, self.migrations, baseline(self.source), 'f' * 40, 'b' * 40)
                self.assertEqual(plan['build_services'], ['data-api', 'realtime'])
                self.assertEqual(plan['deploy_services'], ['data-api', 'realtime'])

    def test_명시적_전체빌드는_기존_Infra_성공기록의_이미지를_재사용하지_않는다(self):
        plan = planner.plan(self.source, self.migrations, baseline(self.source), 'f' * 40, 'b' * 40, force=True)
        self.assertEqual(set(plan['build_services']), planner.SERVICES)
        self.assertEqual(set(plan['deploy_services']), planner.SERVICES)

    def test_위성만_변경되면_다른_이미지는_재빌드하지_않는다(self):
        current = {**self.source, 'notification': 'e' * 64}
        plan = planner.plan(current, self.migrations, baseline(self.source), 'f' * 40, 'b' * 40)
        self.assertEqual(plan['build_services'], ['notification'])
        self.assertEqual(plan['deploy_services'], ['notification'])

    def test_이미지에_포함하는_DB전환도구는_문서경로여도_빌드입력이다(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = 'server/data-api/docs/db/v0-rebase/manifest.json'
            path = root / name
            path.parent.mkdir(parents=True)
            path.write_text('before')
            before, migrations_before = planner.fingerprints(root, [name])
            path.write_text('after')
            after, migrations_after = planner.fingerprints(root, [name])
            self.assertEqual({service for service in planner.SERVICES if before[service] != after[service]}, {'data-api'})
            self.assertNotEqual(migrations_before['data-api'], migrations_after['data-api'])


    def test_Infra변경은_앱을_재빌드하지_않고_전체를_배포한다(self):
        plan = planner.plan(self.source, self.migrations, baseline(self.source), 'f' * 40, 'e' * 40)
        self.assertEqual(plan['build_services'], [])
        self.assertEqual(set(plan['deploy_services']), planner.SERVICES)

    def test_최초배포는_전체이며_변경없으면_발행하지_않는다(self):
        initial = planner.plan(self.source, self.migrations, None, 'f' * 40, 'b' * 40)
        self.assertEqual(set(initial['build_services']), planner.SERVICES)
        unchanged = planner.plan(self.source, self.migrations, baseline(self.source), 'f' * 40, 'b' * 40)
        self.assertEqual(unchanged['build_services'], [])
        self.assertEqual(unchanged['deploy_services'], [])


    def test_실제파일지문은_단일소스_SQL_공용빌드변경을_구분한다(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = [f'server/{service}/src/App.java' for service in planner.SERVICES]
            shared = '.github/actions/ci-jar/action.yml'
            sql = 'server/data-api/src/main/resources/db/migration/V1__fixture.sql'
            files += [shared, sql]
            for name in files:
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('initial')
            original, migrations = planner.fingerprints(root, files)
            (root / 'server/data-api/src/App.java').write_text('changed')
            changed, _ = planner.fingerprints(root, files)
            self.assertEqual({service for service in planner.SERVICES if changed[service] != original[service]}, {'data-api'})
            (root / sql).write_text('ALTER TABLE fixture ADD COLUMN new_value int;')
            _, sql_changed = planner.fingerprints(root, files)
            self.assertNotEqual(sql_changed['data-api'], migrations['data-api'])
            (root / shared).write_text('new build contract')
            all_changed, _ = planner.fingerprints(root, files)
            self.assertTrue(all(all_changed[service] != changed[service] for service in planner.SERVICES))

    def test_V0와_기본데이터를_운영_마이그레이션_지문에_포함한다(self):
        for resource in ('v0/V0__baseline.sql', 'seed/insert.sql'):
            with self.subTest(resource=resource), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                name = 'server/data-api/src/main/resources/db/' + resource
                path = root / name
                path.parent.mkdir(parents=True)
                path.write_text('initial SQL')
                _, before = planner.fingerprints(root, [name])
                path.write_text('changed SQL')
                _, after = planner.fingerprints(root, [name])
                self.assertNotEqual(before['data-api'], after['data-api'])
                for service in planner.SERVICES - {'data-api'}:
                    self.assertEqual(before[service], after[service])

    def test_상태조회_권한실패를_최초배포로_오인하지_않는다(self):
        config = SimpleNamespace(returncode=0, stdout=json.dumps({'PRODUCT': 'catus', 'DEPLOY_BUCKET': 'catus-prod-deploy-artifacts-808715036056'}))
        denied = SimpleNamespace(returncode=1, stderr='AccessDenied (403)')
        with patch.object(planner.subprocess, 'run', side_effect=[config, denied]), self.assertRaises(RuntimeError):
            planner.fetch_previous(Path('never-created.json'))
        absent = SimpleNamespace(returncode=1, stderr='NoSuchKey')
        with patch.object(planner.subprocess, 'run', side_effect=[config, absent]):
            self.assertIsNone(planner.fetch_previous(Path('never-created.json')))

    def test_서비스밖으로_파일을_이동해도_PR검사가_원본서비스를_포함한다(self):
        for destination, expected in [('server/realtime/src/App.java', ['data-api', 'realtime']),
                                      ('docs/App.java', ['data-api'])]:
            with self.subTest(destination=destination), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                def git(*args):
                    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
                git('init', '-q')
                source = root / 'server/data-api/src/App.java'
                source.parent.mkdir(parents=True)
                source.write_text('class App {}\n')
                git('add', '.')
                git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', '기준')
                base = git('rev-parse', 'HEAD')
                target = root / destination
                target.parent.mkdir(parents=True, exist_ok=True)
                git('mv', str(source), str(target))
                git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', '이동')
                revision = git('rev-parse', 'HEAD')
                # 실제 R100 변경을 만들고 planner CLI가 원본 삭제까지 검사하는지 확인한다.
                self.assertIn('R100', git('diff', '--name-status', '--find-renames', base, revision))
                output = root / 'plan.json'
                result = subprocess.run([sys.executable, planner.__file__, '--output', str(output), '--pr-base', base],
                    cwd=root, env={**os.environ, 'GITHUB_SHA': revision, 'GITHUB_OUTPUT': str(root / 'outputs')},
                    capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(output.read_text())['build_services'], expected)


    def test_잘못된_Gromo기준이나_이미지를_재사용하지_않는다(self):
        previous = baseline(self.source)
        previous['images']['data-api'] = 'gromo-prod-back:latest'
        with self.assertRaises(ValueError):
            planner.plan(self.source, self.migrations, previous, 'f' * 40, 'b' * 40)
        previous = baseline(self.source)
        previous['product'] = 'focuscat'
        with self.assertRaises(ValueError):
            planner.plan(self.source, self.migrations, previous, 'f' * 40, 'b' * 40)


if __name__ == '__main__':
    unittest.main()
