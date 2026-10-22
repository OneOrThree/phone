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
        self.fail_apply = False
        self.fail_health = False
        self.nginx = True
        self.ignore_stop = False
        self.ignore_nginx_stop = False
        self.fail_restore = False

    def __call__(self, args, **kwargs):
        args = list(map(str, args)); self.calls.append(args)
        out, code = '', 0
        if args[:3] == ['docker', 'image', 'inspect']:
            image = args[3]
            out = json.dumps([{'Id': 'new-data' if image == DATA else 'new-realtime', 'RepoDigests': [image],
                'Config': {'Labels': {'org.opencontainers.image.revision': 'wrong' if self.bad_revision else REVISION}}}])
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
        elif args[:3] == ['sudo', '-n', 'systemctl']:
            if not self.ignore_nginx_stop: self.nginx = args[3] == 'start'
        elif args[0] == 'python3':
            phase = args[args.index('--phase') + 1]
            if phase == 'apply' and self.fail_apply: code = 1
            out = json.dumps({'state': 'current' if phase == 'apply' else 'legacy', 'phase': 'complete' if phase == 'apply' else 'preflight'})
        return SimpleNamespace(stdout=out, stderr='DB 검사 실패' if code else '', returncode=code)


class DeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.args = argparse.Namespace(state_dir=self.directory, data_image=DATA, realtime_image=REALTIME,
            revision=REVISION, runtime_env_file=self.directory / 'dev.env', data_env_file=self.directory / 'data.env', health_timeout=1)
        self.host = FakeHost(self.directory)

    def deploy(self):
        return core.Deployment(self.args, self.host, sleep=lambda _: None).deploy()

    def test_both_images_and_database_preflight_precede_any_stop(self):
        self.deploy()
        first_stop = next(i for i, cmd in enumerate(self.host.calls) if cmd[:4] == ['sudo', '-n', 'systemctl', 'stop'])
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

    def test_incomplete_other_revision_is_rejected_before_pull(self):
        core.durable_json(self.directory / 'deployment.json', {'phase': 'failed', 'revision': 'd' * 40})
        with self.assertRaises(core.DeployError): self.deploy()
        self.assertFalse(self.host.calls)

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
        self.assertFalse(any(cmd[:4] == ['sudo', '-n', 'systemctl', 'start'] for cmd in self.host.calls))
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
        payload.update(SVC_TOKEN_DATA_TO_REALTIME='synthetic-data-rt', SVC_TOKEN_BIZ_TO_REALTIME='synthetic-biz-rt',
                       INTERNAL_API_ENABLED='true')
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


if __name__ == '__main__':
    unittest.main()
