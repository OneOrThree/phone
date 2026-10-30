import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('app_host_v2', ROOT/'server/scripts/runtime-dev-V2/app/deploy.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class AppHostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.patches = [patch.object(m, 'ROOT', root/'app'), patch.object(m, 'RUNTIME', root/'run'),
                        patch.object(m, 'JOURNAL', root/'app/deployment-journal.json')]
        for p in self.patches: p.start(); self.addCleanup(p.stop)
        release = 'a'*40 + '-10-1'
        compose = m.ROOT/'releases'/release/'compose.yml'
        compose.parent.mkdir(parents=True)
        compose.write_text('services: {}\n')
        (compose.parent/'nginx.conf').write_text('server {}\n')
        self.payload = {'release_id':release,'services':['data-api','realtime'], 'compose_path':str(compose),
                        'redis_ip':'10.30.0.7', 'envs':{s:'TEST=1\n' for s in m.SERVICES},
                        'images':{s:f'asia-northeast3-docker.pkg.dev/oneorthree2/{s}/{s}@sha256:'+'b'*64 for s in m.SERVICES}}

    def fake_run(self, args, **kwargs):
        if args[:2] == ['docker', 'inspect']:
            name = args[2].removeprefix('catus-dev-app-v2-').removesuffix('-1')
            service = next(s for s,c in m.SERVICES.items() if c == name)
            return json.dumps([{'State':{'Health':{'Status':'healthy'}},'Config':{'Image':self.payload['images'][service]}}])
        return ''

    def test_success_records_healthy_and_retry_does_not_redeploy(self):
        with patch.object(m, 'run', side_effect=self.fake_run) as run:
            self.assertEqual(m.deploy(self.payload)['status'], 'healthy')
            count = run.call_count
            self.assertEqual(m.deploy(self.payload)['status'], 'healthy')
            self.assertEqual(run.call_count, count + len(m.SERVICES) + 2)
            self.assertFalse(any('up' in call.args[0] for call in run.call_args_list[count:]))

    def test_failure_blocks_next_deployment(self):
        def fail(args, **kwargs):
            if args[:2] == ['docker','compose'] and 'up' in args: raise RuntimeError('failed')
            return self.fake_run(args, **kwargs)
        with patch.object(m,'run',side_effect=fail):
            with self.assertRaises(RuntimeError): m.deploy(self.payload)
            self.assertEqual(json.loads(m.JOURNAL.read_text())['status'], 'failed')
            with self.assertRaises(RuntimeError): m.deploy(self.payload)

    def test_stale_release_cannot_replace_current_host(self):
        with patch.object(m, 'run', side_effect=self.fake_run):
            m.deploy(self.payload)
            other = dict(self.payload, release_id='f'*40 + '-11-1', base_release_id='e'*40 + '-9-1')
            compose = m.ROOT/'releases'/other['release_id']/'compose.yml'
            compose.parent.mkdir(parents=True)
            compose.write_text('services: {}\n')
            (compose.parent/'nginx.conf').write_text('server {}\n')
            other['compose_path'] = str(compose)
            with self.assertRaises(RuntimeError): m.deploy(other)

    def test_pull_failure_does_not_leave_failure_journal(self):
        with patch.object(m, 'run', side_effect=RuntimeError('pull failed')):
            with self.assertRaises(RuntimeError): m.deploy(self.payload)
        self.assertFalse(m.JOURNAL.exists())
        self.assertFalse((m.RUNTIME/self.payload['release_id']).exists())

    def test_reject_single_core_service(self):
        self.payload['services'] = ['realtime']
        with self.assertRaises(ValueError): m.validate(self.payload)


if __name__ == '__main__': unittest.main()
