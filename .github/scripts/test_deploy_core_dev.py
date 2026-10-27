"""공동 배포의 사전 검증, 장애 격리, 재실행 경계를 검증한다."""
import argparse
import copy
import importlib.util
import json
import os
import subprocess
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import yaml

SPEC = importlib.util.spec_from_file_location('core', Path(__file__).with_name('deploy-core-dev.py'))
core = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(core)
REVISION = 'a' * 40
DATA = 'example/data@sha256:' + 'b' * 64
REALTIME = 'example/realtime@sha256:' + 'c' * 64


def container(name, service=None, running=True):
    return {'Name': '/' + name, 'Image': 'old', 'Config': {'Labels': {
        'com.docker.compose.project': 'phone', 'com.docker.compose.service': service or name}},
        'State': {'Running': running, 'Health': {'Status': 'healthy'}}, 'RestartCount': 0}


def config():
    shared = {'JWT_SECRET': 'jwt', 'SVC_TOKEN_REALTIME_TO_DATA': 'rt-data', 'SVC_TOKEN_DATA_TO_REALTIME': 'data-rt'}
    return {'services': {
        'data-api': {'image': DATA, 'environment': {**shared, 'SPRING_PROFILES_ACTIVE': 'dev,satellites,realtime-authorization'}},
        'realtime': {'image': REALTIME, 'environment': {**shared, 'SVC_TOKEN_BIZ_TO_REALTIME': 'biz-rt', 'KAFKA_BOOTSTRAP_SERVERS': 'kafka:9092'}},
        'realtime-db-init': {'image': 'postgres:16.14-alpine'}}, 'networks': {'app-network': {'name': 'phone_app-network'}}}


class FakeHost:
    def __init__(self, directory):
        self.directory = directory
        self.calls = []
        self.containers = {item['Name'][1:]: item for item in [container('phone-data-api', 'data-api'),
            container('phone-realtime', 'realtime'), container('phone-business-api-1', 'business-api'),
            container('phone-notification-1', 'notification', False), container('gromo-postgres-exporter', 'postgres-exporter'),
            container('phone-db', 'db'), container('phone-redis', 'redis'), container('phone-kafka', 'kafka')]}
        self.rendered = config()
        self.bad_revision = False
        self.revision = REVISION
        self.database_state = 'legacy'
        self.other_connections = 0
        self.fail_preflight = False
        self.fail_apply = False
        self.fail_health = False
        self.nginx = True
        self.ignore_stop = False
        self.ignore_nginx_stop = False
        self.fail_restore = False
        self.deny_sudo_action = None

    def __call__(self, args, **kwargs):
        args = list(map(str, args)); self.calls.append(args)
        out, code = '', 0
        if args[:3] == ['docker', 'image', 'inspect']:
            image = args[3]
            out = json.dumps([{'Id': 'new-data' if image == self.rendered['services']['data-api']['image'] else 'new-realtime', 'RepoDigests': [image],
                'Config': {'Labels': {'org.opencontainers.image.revision': 'wrong' if self.bad_revision else self.revision}}}])
        elif args[:3] == ['docker', 'ps', '-aq']:
            out = '\n'.join(self.containers)
        elif args[:2] == ['docker', 'inspect']:
            out = json.dumps([self.containers[name] for name in args[2:]])
        elif args[:2] == ['docker', 'stop']:
            for name in args[4:]:
                if not self.ignore_stop: self.containers[name]['State']['Running'] = False
        elif args[:2] == ['docker', 'start']:
            self.containers[args[2]]['State']['Running'] = True
            if self.fail_restore: self.containers[args[2]]['State']['Health']['Status'] = 'unhealthy'
        elif args[:2] == ['docker', 'create']:
            out = 'package-container'
        elif args[:2] == ['docker', 'cp']:
            file = Path(args[3]) / 'docs/db/deploy-v0.py'
            file.parent.mkdir(parents=True, exist_ok=True); file.touch()
        elif args[:2] == ['docker', 'compose']:
            if args[-3:] == ['config', '--format', 'json']:
                out = json.dumps(self.rendered)
            elif 'up' in args:
                for service, name in core.CORE.items():
                    self.containers[name]['Image'] = 'new-data' if service == 'data-api' else 'new-realtime'
                    self.containers[name]['State'] = {'Running': True, 'Health': {'Status': 'unhealthy' if self.fail_health else 'healthy'}}
        elif args[:3] == ['systemctl', 'is-active', '--quiet']:
            code = 0 if self.nginx else 3
        elif args[:2] == ['systemctl', 'show']:
            out = 'active' if self.nginx else 'inactive'
        elif args[:3] == ['sudo', '-n', '-l'] and args[4] == self.deny_sudo_action:
            raise core.DeployError('sudo 명령 실패 (exit 1)')
        elif args[:3] == ['sudo', '-n', core.NGINX_SYSTEMCTL]:
            if not self.ignore_nginx_stop: self.nginx = args[3] == 'start'
        elif args[0] == 'python3':
            phase = args[args.index('--phase') + 1]
            if phase == 'apply' and self.fail_apply: code = 1
            if phase == 'preflight' and self.fail_preflight: code = 1
            if phase == 'apply' and not code: self.database_state = 'current'
            out = json.dumps({'state': self.database_state, 'other_connections': self.other_connections,
                              'phase': 'complete' if phase == 'apply' else 'preflight'})
        return SimpleNamespace(stdout=out, stderr='DB 검사 실패' if code else '', returncode=code)


class FakeClock:
    def __init__(self):
        self.now = 0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class ReadinessTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.args = argparse.Namespace(state_dir=self.directory, data_image=DATA, realtime_image=REALTIME,
            revision=REVISION, health_timeout=900)
        self.host = FakeHost(self.directory)
        self.clock = FakeClock()

    def healthy(self, run=None, expected_id='old'):
        deployment = core.Deployment(self.args, run or self.host, sleep=self.clock.sleep)
        with patch.object(core.time, 'monotonic', self.clock.monotonic):
            deployment.healthy('phone-data-api', expected_id)

    def test_unhealthy_can_recover_before_deadline_for_new_and_restored_containers(self):
        for expected_id in ('old', None):
            with self.subTest(expected_id=expected_id):
                self.clock = FakeClock()
                statuses = iter(('starting', 'unhealthy', 'unhealthy', 'healthy'))

                def inspect(args):
                    self.host.containers['phone-data-api']['State']['Health']['Status'] = next(statuses)
                    return self.host(args)

                self.healthy(inspect, expected_id)
                self.assertEqual(self.clock.now, 15)
                self.assertEqual(self.clock.sleeps, [5, 5, 5])

    def test_permanent_unhealthy_fails_at_explicit_deadline(self):
        self.host.containers['phone-data-api']['State']['Health']['Status'] = 'unhealthy'
        with self.assertRaisesRegex(core.DeployError, 'readiness 대기 시간이 지났습니다'):
            self.healthy()
        self.assertEqual(self.clock.now, self.args.health_timeout)
        self.assertEqual(len(self.host.calls), self.args.health_timeout // 5)

    def test_invalid_container_fails_immediately_without_waiting_for_health(self):
        for failure in ('stopped', 'restarting', 'paused', 'restarted', 'image', 'no_healthcheck'):
            with self.subTest(failure=failure):
                self.host = FakeHost(self.directory)
                self.clock = FakeClock()
                item = self.host.containers['phone-data-api']
                item['State']['Health']['Status'] = 'unhealthy'
                if failure == 'stopped': item['State']['Running'] = False
                elif failure == 'restarting': item['State']['Restarting'] = True
                elif failure == 'paused': item['State']['Paused'] = True
                elif failure == 'restarted': item['RestartCount'] = 1
                elif failure == 'image': item['Image'] = 'unexpected-image'
                else: del item['State']['Health']
                with self.assertRaises(core.DeployError):
                    self.healthy()
                self.assertEqual(self.clock.sleeps, [])
                self.assertEqual(len(self.host.calls), 1)


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.args = argparse.Namespace(state_dir=self.directory, data_image=DATA, realtime_image=REALTIME,
            revision=REVISION, runtime_env_file=self.directory / 'dev.env', data_env_file=self.directory / 'data.env', health_timeout=1)
        self.host = FakeHost(self.directory)
        self.clock = FakeClock()

    def deploy(self):
        with patch.object(core.time, 'monotonic', self.clock.monotonic):
            return core.Deployment(self.args, self.host, sleep=self.clock.sleep).deploy()

    def test_both_images_and_database_preflight_precede_any_stop(self):
        self.deploy()
        first_stop = next(i for i, cmd in enumerate(self.host.calls) if cmd[:4] == ['sudo', '-n', core.NGINX_SYSTEMCTL, 'stop'])
        apply = next(i for i, cmd in enumerate(self.host.calls) if '--phase' in cmd and 'apply' in cmd)
        preflight = next(i for i, cmd in enumerate(self.host.calls) if '--phase' in cmd and 'preflight' in cmd)
        self.assertLess(preflight, first_stop); self.assertLess(first_stop, apply)
        self.assertEqual(json.loads((self.directory / 'deployment.json').read_text())['phase'], 'complete')
        self.assertTrue(self.host.nginx)
        self.assertTrue(self.host.containers['phone-business-api-1']['State']['Running'])
        self.assertFalse(self.host.containers['phone-notification-1']['State']['Running'])
        stops = [cmd for cmd in self.host.calls if cmd[:2] == ['docker', 'stop']]
        for cmd in stops:
            self.assertTrue({'phone-db', 'phone-redis', 'phone-kafka'}.isdisjoint(cmd))
        start = next(cmd for cmd in self.host.calls if '--force-recreate' in cmd)
        self.assertEqual(start[-2:], ['data-api', 'realtime']); self.assertIn('--no-deps', start)

    def test_nginx_sudo_denial_explains_command_before_service_stop(self):
        for action in ('stop', 'start'):
            with self.subTest(action=action):
                self.host = FakeHost(self.directory)
                self.host.deny_sudo_action = action
                with self.assertRaisesRegex(core.DeployError, f'sudo -n -l /usr/bin/systemctl {action} nginx') as failure:
                    self.deploy()
                self.assertIn('실행 계정:', str(failure.exception))
                self.assertIn('provision-dev-nginx-sudo.sh', str(failure.exception))
                self.assertFalse((self.directory / 'deployment.json').exists())
                self.assertFalse(any(cmd[:3] == ['sudo', '-n', core.NGINX_SYSTEMCTL] for cmd in self.host.calls))
                self.assertFalse(any('--phase' in cmd and 'apply' in cmd for cmd in self.host.calls))
                self.assertTrue(self.host.nginx)

    def test_mismatched_revision_or_token_never_stops_running_services(self):
        for failure in ('revision', 'token'):
            with self.subTest(failure=failure):
                self.host = FakeHost(self.directory)
                if failure == 'revision': self.host.bad_revision = True
                else: self.host.rendered['services']['realtime']['environment']['SVC_TOKEN_REALTIME_TO_DATA'] = 'wrong'
                with self.assertRaises(core.DeployError): self.deploy()
                self.assertFalse(any(cmd[:2] == ['docker', 'stop'] for cmd in self.host.calls))
                self.assertTrue(self.host.nginx)

    def test_db_failure_stays_closed_and_same_attempt_restores_original_state(self):
        self.host.fail_apply = True
        with self.assertRaises(core.DeployError): self.deploy()
        self.assertFalse(self.host.nginx)
        with self.assertRaises(core.DeployError): core.require_idle(self.directory)
        self.assertFalse(self.host.containers['phone-business-api-1']['State']['Running'])
        self.host.fail_apply = False
        self.deploy()
        self.assertTrue(self.host.nginx)
        self.assertTrue(self.host.containers['phone-business-api-1']['State']['Running'])
        core.require_idle(self.directory)

    def test_readiness_failure_stops_new_pair_without_restarting_old_images(self):
        self.host.fail_health = True
        with self.assertRaises(core.DeployError): self.deploy()
        self.assertFalse(self.host.nginx)
        self.assertFalse(self.host.containers['phone-data-api']['State']['Running'])
        self.assertFalse(self.host.containers['phone-realtime']['State']['Running'])
        self.assertFalse(any(cmd[:2] == ['docker', 'start'] for cmd in self.host.calls))

    def failed_readiness(self):
        self.host.fail_health = True
        with self.assertRaises(core.DeployError): self.deploy()
        self.host.fail_health = False
        self.host.calls.clear()
        return (self.directory / 'deployment.json').read_bytes()

    def replacement_images(self):
        self.args.revision = 'd' * 40
        self.args.data_image = 'example/data@sha256:' + 'e' * 64
        self.args.realtime_image = 'example/realtime@sha256:' + 'f' * 64
        self.host.revision = self.args.revision
        for service in core.CORE:
            self.host.rendered['services'][service]['image'] = getattr(self.args, service.replace('-api', '') + '_image')

    def test_new_pair_recovers_readiness_failure_and_preserves_restore_list_and_backup(self):
        original = json.loads(self.failed_readiness())
        backup = self.directory / 'backups/before-change.dump'
        backup.parent.mkdir(); backup.write_bytes(b'existing-backup')
        self.replacement_images()
        self.deploy()
        state = json.loads((self.directory / 'deployment.json').read_text())
        self.assertEqual(state['phase'], 'complete')
        for key in ('revision', 'data_image', 'realtime_image'):
            self.assertEqual(state[key], getattr(self.args, key))
        for key in ('running', 'overlays', 'nginx_active'):
            self.assertEqual(state[key], original[key])
        self.assertEqual(backup.read_bytes(), b'existing-backup')
        self.assertTrue(self.host.nginx)
        self.assertTrue(self.host.containers['phone-business-api-1']['State']['Running'])
        self.assertFalse(self.host.containers['phone-notification-1']['State']['Running'])
        runners = [cmd for cmd in self.host.calls if '--phase' in cmd]
        self.assertEqual([cmd[cmd.index('--phase') + 1] for cmd in runners], ['preflight', 'apply'])
        for cmd in runners:
            self.assertEqual(cmd[cmd.index('--state-file') + 1], str(self.directory / 'database.json'))
            self.assertEqual(cmd[cmd.index('--backup-dir') + 1], str(backup.parent))
        for image in (self.args.data_image, self.args.realtime_image):
            self.assertIn(['docker', 'image', 'inspect', image], self.host.calls)

    def test_replacement_rejects_active_writer_or_nginx_before_pull(self):
        original = self.failed_readiness()
        self.replacement_images()
        for service in ('phone-business-api-1', 'nginx'):
            with self.subTest(service=service):
                if service == 'nginx': self.host.nginx = True
                else: self.host.containers[service]['State']['Running'] = True
                self.host.calls.clear()
                with self.assertRaises(core.DeployError): self.deploy()
                self.assertEqual((self.directory / 'deployment.json').read_bytes(), original)
                self.assertFalse(any(cmd[:2] == ['docker', 'pull'] for cmd in self.host.calls))
                if service == 'nginx': self.host.nginx = False
                else: self.host.containers[service]['State']['Running'] = False

    def test_replacement_preflight_failure_does_not_change_existing_deployment(self):
        original = self.failed_readiness()
        self.replacement_images()
        for failure in ('legacy', 'empty', 'connections', 'database', 'image', 'token'):
            with self.subTest(failure=failure):
                self.host.calls.clear()
                self.host.database_state = failure if failure in ('legacy', 'empty') else 'current'
                self.host.other_connections = 1 if failure == 'connections' else 0
                self.host.fail_preflight = failure == 'database'
                self.host.bad_revision = failure == 'image'
                self.host.rendered['services']['realtime']['environment']['SVC_TOKEN_REALTIME_TO_DATA'] = (
                    'wrong' if failure == 'token' else 'rt-data')
                with self.assertRaises(core.DeployError): self.deploy()
                self.assertEqual((self.directory / 'deployment.json').read_bytes(), original)
                self.assertFalse(any('--phase' in cmd and 'apply' in cmd for cmd in self.host.calls))
                self.assertFalse(any(cmd[:2] == ['docker', 'stop'] or 'up' in cmd for cmd in self.host.calls))

    def test_manual_recovery_rejects_fresh_and_completed_deployments_before_host_access(self):
        self.args.recovery_only = True
        with self.assertRaises(core.DeployError): self.deploy()
        self.assertFalse(self.host.calls)
        core.durable_json(self.directory / 'deployment.json', {'phase': 'complete'})
        with self.assertRaises(core.DeployError): self.deploy()
        self.assertFalse(self.host.calls)

    def test_manual_same_image_recovery_requires_current_and_then_restores_services(self):
        original = self.failed_readiness()
        self.args.recovery_only = True
        for state in ('legacy', 'empty'):
            with self.subTest(state=state):
                self.host.database_state = state
                self.host.calls.clear()
                with self.assertRaises(core.DeployError): self.deploy()
                self.assertEqual((self.directory / 'deployment.json').read_bytes(), original)
                self.assertFalse(any('--phase' in cmd and 'apply' in cmd for cmd in self.host.calls))
        self.host.database_state = 'current'
        self.deploy()
        self.assertTrue(self.host.nginx)
        self.assertTrue(self.host.containers['phone-business-api-1']['State']['Running'])

    def test_stop_success_without_stopped_state_never_applies_database(self):
        for flag in ('ignore_stop', 'ignore_nginx_stop'):
            with self.subTest(flag=flag):
                self.host = FakeHost(self.directory)
                setattr(self.host, flag, True)
                with self.assertRaises(core.DeployError): self.deploy()
                self.assertFalse(any('--phase' in cmd and 'apply' in cmd for cmd in self.host.calls))

    def test_satellite_readiness_failure_keeps_nginx_closed(self):
        self.host.fail_restore = True
        with self.assertRaises(core.DeployError): self.deploy()
        self.assertFalse(self.host.nginx)
        self.assertFalse(any(cmd[:4] == ['sudo', '-n', core.NGINX_SYSTEMCTL, 'start'] for cmd in self.host.calls))
        self.assertFalse(self.host.containers['phone-business-api-1']['State']['Running'])

    def test_journal_is_private_and_atomically_replaced(self):
        core.durable_json(self.directory / 'deployment.json', {'phase': 'stopping'})
        self.assertEqual((self.directory / 'deployment.json').stat().st_mode & 0o777, 0o600)
        self.assertFalse(list(self.directory.glob('.state-*')))


class ComposeContractTest(unittest.TestCase):
    def test_actual_compose_combines_data_and_realtime_contracts(self):
        spec = importlib.util.spec_from_file_location('writer', Path(__file__).with_name('write-compose-env.py'))
        writer = importlib.util.module_from_spec(spec); spec.loader.exec_module(writer)
        payload = {key: 'synthetic-' + key for key in set(writer.LEGACY_REQUIRED_KEYS) | set(writer.SERVICE_REQUIRED_KEYS['data-api'])}
        payload.update(SVC_TOKEN_DATA_TO_REALTIME='synthetic-data-rt', SVC_TOKEN_BIZ_TO_REALTIME='synthetic-biz-rt')
        with tempfile.TemporaryDirectory() as temporary:
            runtime, data = Path(temporary) / 'dev.env', Path(temporary) / 'data.env'
            runtime.write_text(writer.render(payload, DATA, 'legacy'))
            data.write_text(writer.render(payload, DATA, 'data-api', environment='dev', data_profiles='dev,satellites,realtime-authorization'))
            for overlays in ([], ['datadog', 'kafka']):
                with self.subTest(overlays=overlays):
                    args = ['docker', 'compose', '--env-file', str(runtime)]
                    for name in ['dev', *overlays, 'realtime', 'satellites.data.dev']:
                        args += ['-f', str(core.ROOT / f'server/scripts/docker-compose.{name}.yml')]
                    args += ['config', '--format', 'json']
                    result = subprocess.run(args, check=True, capture_output=True, text=True,
                        env={**os.environ, 'APP_IMAGE': DATA, 'REALTIME_IMAGE': REALTIME, 'DATA_API_ENV_FILE': str(data),
                             'DATA_API_PROFILES': 'dev,satellites,realtime-authorization', 'DEPLOY_ENV': 'dev',
                             'DD_API_KEY': 'synthetic-datadog', 'IMAGE_REVISION': REVISION, 'IMAGE_VERSION': REVISION})
                    self.assertEqual(core.validate_contract(json.loads(result.stdout), DATA, REALTIME), 'phone_app-network')


class RecoveryBuildTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.source = {'id': 123, 'event': 'push', 'head_branch': 'main', 'head_sha': REVISION,
                       'path': '.github/workflows/data-api-ci.dev.yml', 'conclusion': 'failure',
                       'head_repository': {'full_name': 'OneOrThree/Phone'}}
        self.jobs = [{'id': index, 'name': name, 'head_sha': REVISION,
                      'status': 'completed', 'conclusion': 'success'} for index, name in enumerate((
                          'Dev 이미지 build · GAR push',
                          'Realtime 공동 이미지 / 채팅 이미지 build · GAR push'), start=1)]

    def api(self, args):
        self.calls.append(args)
        if 'actions/workflows/' in args[-1]: data = [{'workflow_runs': [self.source]}]
        else: data = [{'jobs': self.jobs[:1]}, {'jobs': self.jobs[1:]}]
        return SimpleNamespace(stdout=json.dumps(data))

    def test_successful_pair_is_accepted_even_when_satellite_failure_fails_overall_ci(self):
        self.assertEqual(core.verify_recovery_builds('OneOrThree/Phone', REVISION, self.api), 123)
        self.assertIn('head_sha=' + REVISION, self.calls[0][-1])
        self.assertIn('filter=all', self.calls[1][-1])
        self.assertTrue(all('--paginate' in call for call in self.calls))

    def test_wrong_source_cannot_prove_image_validation(self):
        for key, value in (('event', 'pull_request'), ('head_branch', 'release'), ('head_sha', 'd' * 40),
                           ('path', '.github/workflows/untrusted.yml'), ('head_repository', {'full_name': 'fork/Phone'})):
            with self.subTest(key=key):
                old = self.source[key]; self.source[key] = value
                with self.assertRaises(core.DeployError): core.verify_recovery_builds('OneOrThree/Phone', REVISION, self.api)
                self.source[key] = old

    def test_both_builds_must_have_successful_latest_execution(self):
        original = copy.deepcopy(self.jobs)
        for service in (0, 1):
            for status, conclusion in (('completed', 'failure'), ('completed', 'skipped'), ('in_progress', None)):
                with self.subTest(service=service, status=status, conclusion=conclusion):
                    self.jobs = copy.deepcopy(original)
                    self.jobs.append(dict(original[service], id=10, status=status, conclusion=conclusion))
                    with self.assertRaises(core.DeployError): core.verify_recovery_builds('OneOrThree/Phone', REVISION, self.api)
        self.jobs = original[:1]
        with self.assertRaises(core.DeployError): core.verify_recovery_builds('OneOrThree/Phone', REVISION, self.api)


class WorkflowTest(unittest.TestCase):
    def test_only_data_main_ci_owns_two_digests_and_common_cd(self):
        def workflow(name):
            return yaml.load((core.ROOT / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)
        data = workflow('data-api-ci.dev.yml'); realtime = workflow('realtime-ci.dev.yml'); cd = workflow('data-api-cd.dev.yml')
        self.assertNotIn('push', realtime['on']); self.assertNotIn('deploy', realtime['jobs'])
        self.assertIn('image-digest', realtime['on']['workflow_call']['outputs'])
        self.assertEqual(data['jobs']['deploy']['needs'], ['build', 'realtime', 'satellites-ready'])
        self.assertIn('realtime_image_digest', data['jobs']['deploy']['with'])
        self.assertEqual(cd['concurrency']['group'], 'dev-vm-deploy')
        self.assertNotIn('concurrency', data['jobs']['satellites-ready'])
        self.assertFalse((core.ROOT / '.github/workflows/realtime-cd.dev.yml').exists())
        for pattern in ('server/realtime/**', 'server/data-api/docs/db/**/*.py', 'server/data-api/docs/db/**/*.sql', 'server/data-api/docs/db/**/*.json'):
            self.assertIn(pattern, data['on']['push']['paths'])

    def test_dispatch_is_main_only_and_cannot_bypass_current_database_recovery_guard(self):
        cd = yaml.load((core.ROOT / '.github/workflows/data-api-cd.dev.yml').read_text(), Loader=yaml.BaseLoader)
        data = yaml.load((core.ROOT / '.github/workflows/data-api-ci.dev.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(set(cd['on']['workflow_dispatch']['inputs']), set(cd['on']['workflow_call']['inputs']))
        self.assertEqual(cd['jobs']['deploy']['if'], "github.ref == 'refs/heads/main'")
        self.assertEqual(cd['jobs']['deploy']['permissions']['actions'], 'read')
        self.assertEqual(data['jobs']['deploy']['permissions']['actions'], 'read')
        steps = cd['jobs']['deploy']['steps']
        self.assertEqual(steps[0]['with']['fetch-depth'], '0')
        self.assertIn('--verify-recovery-builds', steps[1]['run'])
        self.assertIn('git merge-base --is-ancestor "$IMAGE_REVISION" "$GITHUB_SHA"', steps[1]['run'])
        health = next(step for step in steps if step.get('id') == 'health')
        self.assertIn('workflow_dispatch', health['run'])
        self.assertIn('recovery+=(--recovery-only)', health['run'])
        self.assertIn('"${recovery[@]}"', health['run'])
        self.assertFalse(any('${{ inputs.' in step.get('run', '') for step in steps))

    def test_input_validation_rejects_wrong_ref_sha_or_digest_without_shell_expansion(self):
        cd = yaml.load((core.ROOT / '.github/workflows/data-api-cd.dev.yml').read_text(), Loader=yaml.BaseLoader)
        script = cd['jobs']['deploy']['steps'][1]['run']
        values = {**os.environ, 'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': REVISION, 'IMAGE_REVISION': REVISION,
                  'DATA_DIGEST': 'sha256:' + 'b' * 64, 'REALTIME_DIGEST': 'sha256:' + 'c' * 64, 'GITHUB_EVENT_NAME': 'push'}
        self.assertEqual(subprocess.run(['bash', '-c', script], env=values, capture_output=True).returncode, 0)
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'injected'
            for key, value in (('GITHUB_REF', 'refs/heads/release'), ('IMAGE_REVISION', 'd' * 40),
                               ('DATA_DIGEST', 'sha256:invalid'), ('REALTIME_DIGEST', '$(touch ' + str(marker) + ')')):
                with self.subTest(key=key):
                    result = subprocess.run(['bash', '-c', script], env={**values, key: value}, capture_output=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(marker.exists())

    def test_manual_recovery_uses_tested_ancestor_after_docs_only_main_commit(self):
        cd = yaml.load((core.ROOT / '.github/workflows/data-api-cd.dev.yml').read_text(), Loader=yaml.BaseLoader)
        script = cd['jobs']['deploy']['steps'][1]['run']
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)

            def git(*args):
                return subprocess.run(['git', *args], cwd=directory, check=True, capture_output=True, text=True).stdout.strip()

            def commit(message):
                git('add', '.')
                git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', message)
                return git('rev-parse', 'HEAD')

            git('init', '-b', 'main')
            (directory / 'application.txt').write_text('tested main image B')
            built = commit('B image built')
            git('checkout', '-b', 'unmerged')
            (directory / 'other.txt').write_text('not merged')
            unmerged = commit('unmerged image')
            git('checkout', 'main')
            (directory / 'README.md').write_text('C docs-only main change')
            current = commit('C docs only')
            package = directory / '.github/scripts'
            package.mkdir(parents=True)
            (package / 'deploy-core-dev.py').write_text((core.ROOT / '.github/scripts/deploy-core-dev.py').read_text())
            evidence = directory / 'evidence.json'
            evidence.write_text(json.dumps({
                'runs': [{'workflow_runs': [{'id': 123, 'event': 'push', 'head_branch': 'main', 'head_sha': built,
                    'path': '.github/workflows/data-api-ci.dev.yml', 'head_repository': {'full_name': 'fixture/phone'}}]}],
                'jobs': [{'jobs': [{'id': index, 'name': name, 'head_sha': built, 'status': 'completed', 'conclusion': 'success'}
                    for index, name in enumerate(('Dev 이미지 build · GAR push',
                        'Realtime 공동 이미지 / 채팅 이미지 build · GAR push'))]}]}))
            binary = directory / 'bin'
            binary.mkdir()
            gh = binary / 'gh'
            gh.write_text('#!/usr/bin/env python3\nimport json, os, pathlib, sys\n'
                          'pathlib.Path(os.environ["CI_QUERY_MARKER"]).touch()\n'
                          'data = json.loads(pathlib.Path(os.environ["CI_EVIDENCE"]).read_text())\n'
                          'print(json.dumps(data["runs" if "actions/workflows/" in sys.argv[-1] else "jobs"]))\n')
            gh.chmod(0o700)
            marker = directory / 'ci-queried'
            env = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                   'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': current, 'IMAGE_REVISION': built,
                   'DATA_DIGEST': 'sha256:' + 'b' * 64, 'REALTIME_DIGEST': 'sha256:' + 'c' * 64,
                   'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REPOSITORY': 'fixture/phone',
                   'CI_EVIDENCE': str(evidence), 'CI_QUERY_MARKER': str(marker)}
            result = subprocess.run(['bash', '-c', script], cwd=directory, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(marker.exists())
            marker.unlink()
            for revision, event in ((unmerged, 'workflow_dispatch'), ('0' * 40, 'workflow_dispatch'), (built, 'push')):
                with self.subTest(revision=revision, event=event):
                    result = subprocess.run(['bash', '-c', script], cwd=directory,
                        env={**env, 'IMAGE_REVISION': revision, 'GITHUB_EVENT_NAME': event}, capture_output=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
