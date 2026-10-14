"""실제 성공 상태를 기준으로 변경된 서비스만 빌드하는 계약을 검증한다."""
import hashlib
import importlib.util
import unittest
import tempfile
import json
import yaml
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('selective_plan', Path(__file__).with_name('focuscat-plan.py'))
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


def baseline(source):
    return {'product': 'focuscat', 'release_id': 'a' * 40 + '-1-1', 'infra_revision': 'b' * 40,
            'source_fingerprints': source,
            'images': {service: f'808715036056.dkr.ecr.ap-northeast-2.amazonaws.com/focuscat-prod/{service}@sha256:' + 'c' * 64 for service in planner.SERVICES}}


class SelectivePlanTests(unittest.TestCase):
    def setUp(self):
        self.source = {service: hashlib.sha256(service.encode()).hexdigest() for service in planner.SERVICES}
        self.migrations = {service: 'd' * 64 for service in planner.SERVICES}

    def test_Data변경은_Data만_빌드하고_배포한다(self):
        current = {**self.source, 'data-api': 'e' * 64}
        plan = planner.plan(current, self.migrations, baseline(self.source), 'f' * 40, 'b' * 40)
        self.assertEqual(plan['build_services'], ['data-api'])
        self.assertEqual(plan['deploy_services'], ['data-api'])

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

    def test_상태조회_권한실패를_최초배포로_오인하지_않는다(self):
        config = SimpleNamespace(returncode=0, stdout=json.dumps({'PRODUCT': 'focuscat', 'DEPLOY_BUCKET': 'focuscat-prod-deploy-artifacts-808715036056'}))
        denied = SimpleNamespace(returncode=1, stderr='AccessDenied (403)')
        with patch.object(planner.subprocess, 'run', side_effect=[config, denied]), self.assertRaises(RuntimeError):
            planner.fetch_previous(Path('never-created.json'))
        absent = SimpleNamespace(returncode=1, stderr='NoSuchKey')
        with patch.object(planner.subprocess, 'run', side_effect=[config, absent]):
            self.assertIsNone(planner.fetch_previous(Path('never-created.json')))

    def test_release가_유일한_prod자동발행_브랜치다(self):
        workflows = Path(__file__).parents[1] / 'workflows'
        ci = yaml.load((workflows / 'prod-ci.yml').read_text(), Loader=yaml.BaseLoader)
        cd = yaml.load((workflows / 'prod-cd.yml').read_text(), Loader=yaml.BaseLoader)
        satellite = yaml.load((workflows / 'satellite-ci.prod.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(ci['on']['push']['branches'], ['release'])
        self.assertEqual(cd['jobs']['deploy']['if'], "github.ref == 'refs/heads/release'")
        self.assertNotIn('push', satellite['on'])
        self.assertEqual(satellite['on']['pull_request']['branches'], ['release'])

    def test_잘못된_Gromo기준이나_이미지를_재사용하지_않는다(self):
        previous = baseline(self.source)
        previous['images']['data-api'] = 'gromo-prod-back:latest'
        with self.assertRaises(ValueError):
            planner.plan(self.source, self.migrations, previous, 'f' * 40, 'b' * 40)

    def test_공용빌드입력_변경은_PR검사와_release발행을_모두_시작한다(self):
        import fnmatch
        path = Path(__file__).parents[1] / 'workflows' / 'prod-ci.yml'
        ci = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        shared_inputs = ['.github/actions/ci-jar/action.yml', '.github/scripts/ci-jar.py',
                         '.dockerignore', 'server/gradle/shared.gradle']
        for event in ['pull_request', 'push']:
            for name in shared_inputs:
                with self.subTest(event=event, path=name):
                    self.assertTrue(any(fnmatch.fnmatchcase(name, pattern)
                                        for pattern in ci['on'][event]['paths']))


if __name__ == '__main__':
    unittest.main()
