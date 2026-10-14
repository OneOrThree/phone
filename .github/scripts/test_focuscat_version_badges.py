"""버전 증가·버전 지정 롤백·실제 배포 결과와 배지의 연결을 검증한다."""
import ast
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import yaml

ROOT = Path(__file__).parents[2]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


version = module('version', 'focuscat-version.py')
badge = module('badge', 'deployment-badges.py')


def workflow(filename):
    return yaml.load((ROOT / '.github/workflows' / filename).read_text(), Loader=yaml.BaseLoader)


def record(service='data-api', result='success', stamp='2026-01-01T00:00:00+00:00'):
    return {'environment': 'dev', 'service': service, 'result': result,
            'revision': 'a' * 40, 'finished_at': stamp}


class VersionBadgeTests(unittest.TestCase):
    def test_초기2_버전과_PR라벨_증가_기존Gromo태그는_제외(self):
        self.assertEqual(version.next_version(['v9.0.0'], []), 'focuscat-v2.0.0')
        tags = ['focuscat-v2.9.0', 'focuscat-v2.10.0', 'v99.0.0']
        for label, expected in [('release:major', 'focuscat-v3.0.0'), ('release:minor', 'focuscat-v2.11.0'),
                                ('release:patch', 'focuscat-v2.10.1')]:
            self.assertEqual(version.next_version(tags, [label, 'workflow']), expected)
        self.assertEqual(version.next_version(tags, []), 'focuscat-v2.10.1')
        with self.assertRaises(ValueError):
            version.next_version(tags, ['release:major', 'release:minor'])

    def test_네서비스_확인전에_dev전체_배포완료라고_표시하지_않는다(self):
        state = badge.merge({}, [record()])
        self.assertEqual(badge.badges(state)['dev.json']['message'], '배포 확인 1/4')
        state = badge.merge(state, [record(service) for service in badge.DEV])
        self.assertEqual(badge.badges(state)['dev.json']['message'], '배포 완료 4/4')
        state = badge.merge(state, [record('notification', 'failure', '2026-01-02T00:00:00+00:00')])
        self.assertEqual(badge.badges(state)['dev.json']['color'], 'red')
        state = badge.merge(state, [record('realtime', 'success', '2026-01-03T00:00:00+00:00')])
        self.assertEqual(badge.badges(state)['dev.json']['color'], 'red')
        self.assertIn('성공 3/4', badge.badges(state)['dev.json']['message'])

    def test_늦게_도착한_이전실행이_최신배포를_덮지_않는다(self):
        latest = record(stamp='2026-01-02T00:00:00+00:00')
        state = badge.merge({}, [latest])
        self.assertEqual(badge.merge(state, [record(result='failure')]), state)

    def test_PR과_fork는_쓰기권한을_갖는_배지게시에서_제외한다(self):
        event = {'repository': {'id': 1}, 'workflow_run': {'path': '.github/workflows/data-api-ci.dev.yml',
                 'event': 'push', 'head_branch': 'main', 'head_repository': {'id': 1}}}
        self.assertIsNotNone(badge.trusted_run(event))
        event['workflow_run']['event'] = 'pull_request'
        self.assertIsNone(badge.trusted_run(event))
        event['workflow_run']['event'] = 'push'
        event['workflow_run']['head_repository']['id'] = 2
        self.assertIsNone(badge.trusted_run(event))

    def test_prod는_성공버전만_받고_롤백성공시_이전버전을_표시한다(self):
        prod = {**record('focuscat'), 'environment': 'prod', 'version': 'focuscat-v2.1.0',
                'release_id': 'a' * 40 + '-1-1', 'infra_revision': 'b' * 40}
        rule = badge.RULES['.github/workflows/prod-cd.yml']
        state = badge.merge({}, badge.validate([prod], rule))
        rollback = {**prod, 'version': 'focuscat-v2.0.0', 'finished_at': '2026-01-02T00:00:00+00:00'}
        state = badge.merge(state, badge.validate([rollback], rule))
        self.assertEqual(badge.badges(state)['prod.json']['message'], 'focuscat-v2.0.0')
        with self.assertRaises(ValueError):
            badge.validate([{**prod, 'result': 'failure'}], rule)

    def test_CI실패로_CD가_미실행돼도_이전_초록배지가_유지되지_않는다(self):
        state = badge.merge({}, [record(service) for service in badge.DEV])
        run = {'conclusion': 'failure', 'head_sha': 'b' * 40, 'updated_at': '2026-01-02T00:00:00Z'}
        rule = badge.RULES['.github/workflows/data-api-ci.dev.yml']
        failures = badge.missing_result(run, rule)
        state = badge.merge(state, failures)
        self.assertEqual(badge.badges(state)['dev.json']['color'], 'red')
        self.assertEqual(state['dev/data-api']['revision'], 'b' * 40)
        run['conclusion'] = 'success'
        self.assertEqual(badge.missing_result(run, rule), [])
        run['conclusion'] = 'failure'
        self.assertEqual(badge.missing_result(run, badge.RULES['.github/workflows/prod-cd.yml']), [])
        rule = badge.planned_rule(badge.RULES['.github/workflows/satellite-ci.dev.yml'], {'business-api': True, 'notification': False})
        self.assertEqual([item['service'] for item in badge.missing_result(run, rule)], ['business-api'])
        with self.assertRaises(ValueError):
            badge.planned_rule(rule, {'business-api': 'false', 'notification': False})

    def test_공개상태에_비밀값_키를_추가할_수_없다(self):
        with self.assertRaises(ValueError):
            badge.validate([{**record(), 'DB_PASSWORD': 'should-not-be-public'}], badge.RULES['.github/workflows/data-api-ci.dev.yml'])

    def test_브랜치_충돌은_최신상태와_병합하고_force_push하지_않는다(self):
        import base64
        import urllib.error
        class API:
            def __init__(self): self.patches, self.states = 0, []
            def request(self, path, method='GET', data=None):
                if path.startswith('/git/ref/'):
                    return {'object': {'sha': 'tip'}}
                if path == '/git/commits/tip': return {'tree': {'sha': 'base'}}
                if path == '/git/trees/base': return {'tree': [{'path': 'state.json', 'sha': 'blob'}]}
                if path == '/git/blobs/blob':
                    existing = {'dev/realtime': record('realtime', stamp='2026-01-02T00:00:00+00:00')}
                    return {'content': base64.b64encode(json.dumps(existing).encode()).decode()}
                if path == '/git/trees':
                    self.states.append(json.loads(next(item['content'] for item in data['tree'] if item['path'] == 'state.json')))
                    return {'sha': 'tree'}
                if path == '/git/commits': return {'sha': 'new'}
                if path.startswith('/git/refs/'):
                    if data['force']: raise AssertionError('force push 금지')
                    self.patches += 1
                    if self.patches == 1: raise urllib.error.HTTPError('', 422, 'race', {}, None)
                    return {}
                raise AssertionError(path)
        api = API()
        with patch.object(badge.time, 'sleep'):
            badge.publish(api, [record()])
        self.assertEqual(api.patches, 2)
        self.assertIn('dev/realtime', api.states[-1])
        self.assertIn('dev/data-api', api.states[-1])

    def test_Satellite는_부분성공을_서비스별로_기록한다(self):
        steps = workflow('satellite-cd.dev.yml')['jobs']['deploy']['steps']
        script = next(step['run'] for step in steps if step.get('name') == 'README 배포 상태 기록')
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'satellite-health.txt').write_text('business-api success\nnotification failure\n')
            env = {**os.environ, 'RUNNER_TEMP': directory, 'BADGE_REVISION': 'a' * 40,
                   'BADGE_RESULT': 'failure', 'BUSINESS_SELECTED': 'true', 'NOTIFICATION_SELECTED': 'true'}
            result = subprocess.run(['bash', '-c', script], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            records = json.loads(Path(directory, 'deployment-status/dev.json').read_text())
            self.assertEqual({r['service']: r['result'] for r in records}, {'business-api': 'success', 'notification': 'failure'})

    def test_Satellite_CD는_하나만_실패해도_전체_헬스체크가_실패한다(self):
        steps = workflow('satellite-cd.dev.yml')['jobs']['deploy']['steps']
        script = next(step['run'] for step in steps if step.get('id') == 'health')
        script = script.replace('${{ needs.plan.outputs.business }}', 'true').replace('${{ needs.plan.outputs.notification }}', 'true')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'bin').mkdir()
            docker = root / 'bin/docker'
            docker.write_text('#!/bin/bash\nif [ "$1" = inspect ]; then echo "/${@: -1}"; else echo "${@: -1}"; fi\n')
            docker.chmod(0o755)
            helper = root / '.github/scripts/wait-healthy.sh'
            helper.parent.mkdir(parents=True)
            helper.write_text('#!/bin/bash\n[ "$1" != "$FAILURE_SERVICE" ]\n')
            helper.chmod(0o755)
            env = {**os.environ, 'PATH': str(root / 'bin') + os.pathsep + os.environ['PATH'],
                   'RUNNER_TEMP': directory, 'RUNTIME_ENV_FILE': str(root / 'dev.env'), 'SATELLITE_RUNTIME_DIR': directory}
            for failed, expected in [('business-api', 1), ('notification', 1), ('none', 0)]:
                result = subprocess.run(['bash', '-c', script], cwd=root,
                    env={**env, 'FAILURE_SERVICE': failed}, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_수동롤백_버전을_릴리스ID로_해석하고_SSM성공후에만_기록한다(self):
        script = workflow('prod-cd.yml')['jobs']['deploy']['steps'][2]['run']
        script = script.split("<<'PYTHON'\n", 1)[1].rsplit('\nPYTHON', 1)[0]
        tree = ast.parse(script)
        tree.body = [item for item in tree.body if not (isinstance(item, ast.Expr) and isinstance(item.value, ast.Call)
                     and isinstance(item.value.func, ast.Name) and item.value.func.id == 'main')]
        namespace = {}
        exec(compile(tree, '<workflow>', 'exec'), namespace)
        envelope = {'version': 'focuscat-v2.0.0', 'release_id': 'a' * 40 + '-1-1',
                    'source_revision': 'a' * 40, 'infra_revision': 'b' * 40, 'bundle_sha256': 'c' * 64}
        config = {'PRODUCT': 'focuscat', 'SSM_DOC': 'focuscat-prod-deploy',
                  'DEPLOY_BUCKET': 'focuscat-prod-deploy-artifacts-808715036056', 'INSTANCE_ID': 'i-focuscat'}
        calls = []
        def aws(*args):
            calls.append(args)
            if args[0] == 'secretsmanager': return {'SecretString': json.dumps(config)}
            if args[1] == 'send-command': return {'Command': {'CommandId': 'command'}}
            return {'Status': 'Success'}
        def download(args, **kwargs):
            self.assertIn('versions/focuscat-v2.0.0.json', args)
            Path(args[-1]).write_text(json.dumps(envelope))
        namespace['aws'] = aws
        with tempfile.TemporaryDirectory() as directory:
            before = Path.cwd()
            try:
                os.chdir(directory)
                with patch.object(sys, 'argv', ['request', '--release-id', 'focuscat-v2.0.0', '--operation', 'rollback']), \
                     patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(Path(directory, 'summary'))}), \
                     patch.object(subprocess, 'run', download):
                    namespace['main']()
                params = json.loads(next(call for call in calls if call[1] == 'send-command')[-1])
                self.assertEqual(params['ReleaseId'], [envelope['release_id']])
                self.assertEqual(params['Operation'], ['rollback'])
                self.assertEqual(json.loads(Path('deployment-status-prod.json').read_text())[0]['version'], envelope['version'])
            finally:
                os.chdir(before)

    def test_workflow의_모든_인라인Python은_실행가능한_구문이다(self):
        for filename in ['prod-ci.yml', 'prod-cd.yml', 'data-api-cd.dev.yml',
                         'realtime-cd.dev.yml', 'satellite-cd.dev.yml']:
            for job in workflow(filename)['jobs'].values():
                for step in job.get('steps', []):
                    script = step.get('run', '')
                    for delimiter in ['PYTHON', 'PY']:
                        marker = "<<'" + delimiter + "'\n"
                        if marker in script:
                            ast.parse(script.split(marker, 1)[1].split('\n' + delimiter, 1)[0])


if __name__ == '__main__':
    unittest.main()
