"""dev 이미지 삭제가 성공 이력·컨테이너 참조·환경 경계를 지키는지 검증한다."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

import yaml

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location('retention', ROOT / '.github/scripts/dev-image-retention.py')
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)
NOW = datetime.datetime(2026, 10, 22, tzinfo=datetime.timezone.utc)


def image_id(n):
    return 'sha256:' + f'{n:064x}'


def image(n, service='data-api', age=8, refs=None):
    return {'Id': image_id(n), 'Created': (NOW - datetime.timedelta(days=age)).isoformat(),
            'RepoTags': refs if refs is not None else [retention.REPOSITORIES[service] + ':old'],
            'RepoDigests': []}


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'history.json'
        self.current = {service: image_id(i + 1) for i, service in enumerate(retention.SERVICES)}
        self.history = {service: [value, image_id(i + 11)]
                        for i, (service, value) in enumerate(self.current.items())}

    def test_keep_current_previous_success_and_all_container_references(self):
        images = [image(1), image(11), image(20), image(21)]
        self.assertEqual(retention.candidates(images, self.history, {image_id(20)}, NOW), [image_id(21)])

    def test_only_old_dev_application_images_are_candidates(self):
        images = [image(20, age=6), image(21, refs=['postgres:17']),
                  image(22, refs=['prod.example/data-api:old']), image(23, refs=[]),
                  image(24, refs=[retention.REPOSITORIES['data-api'] + ':old', 'prod.example/api:old']),
                  image(25)]
        self.assertEqual(retention.candidates(images, self.history, set(), NOW), [image_id(25)])

    def test_first_observation_does_not_delete_unknown_previous_success(self):
        history = {service: [value] for service, value in self.current.items()}
        self.assertEqual(retention.candidates([image(20)], history, set(), NOW), [])

    def test_docker_nanosecond_created_timestamp(self):
        value = image(20)
        value['Created'] = '2026-10-14T09:32:26.438889776Z'
        self.assertEqual(retention.candidates([value], self.history, set(), NOW), [image_id(20)])

    def test_successful_rollout_keeps_two_distinct_images_and_retry_keeps_previous(self):
        history = retention.advance(self.history, self.current)
        self.assertEqual(history, self.history)
        changed = {**self.current, 'data-api': image_id(30)}
        advanced = retention.advance(history, changed)
        self.assertEqual(advanced['data-api'], [image_id(30), self.current['data-api']])
        self.assertEqual(advanced['realtime'], self.history['realtime'])

    def test_missing_history_is_conservative_and_corrupt_history_fails_closed(self):
        self.assertTrue(all(not v for v in retention.load_history(self.path).values()))
        self.path.write_text('{broken')
        with self.assertRaises(ValueError):
            retention.load_history(self.path)
        bad = {'version': 1, 'images': {**self.history, 'data-api': ['not-an-image']}}
        self.path.write_text(json.dumps(bad))
        with self.assertRaises(ValueError):
            retention.load_history(self.path)

    def test_atomic_history_roundtrip(self):
        retention.save_history(self.path, self.history)
        self.assertEqual(retention.load_history(self.path), self.history)

    def test_non_dev_environment_refuses_before_docker_or_history_write(self):
        with patch.dict(os.environ, {'DEPLOY_ENV': 'prod'}), patch.object(retention, 'docker') as docker:
            with self.assertRaises(ValueError):
                retention.run(self.path, apply=True)
            docker.assert_not_called()
            self.assertFalse(self.path.exists())

    def mock_docker(self):
        images = [image(i) for i in range(1, 5)] + [image(i) for i in range(11, 15)] + [image(20)]
        for value in images:
            value['Created'] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=30)).isoformat()
        calls = []

        def docker(*args):
            calls.append(args)
            if args[:2] == ('image', 'ls'):
                return '\n'.join(value['Id'] for value in images)
            if args[:2] == ('image', 'inspect'):
                return json.dumps(images)
            if args[:2] == ('image', 'rm'):
                return args[-1]
            raise AssertionError(args)

        return docker, calls

    def test_dry_run_does_not_update_history_or_delete(self):
        retention.save_history(self.path, self.history)
        docker, calls = self.mock_docker()
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), patch.object(retention, 'docker', docker), \
                patch.object(retention, 'current_images', return_value=self.current), \
                patch.object(retention, 'referenced_images', return_value=set()):
            retention.run(self.path)
        self.assertFalse(any(call[:2] == ('image', 'rm') for call in calls))
        self.assertEqual(retention.load_history(self.path), self.history)

    def test_apply_checks_fresh_references_and_never_forces_removal(self):
        retention.save_history(self.path, self.history)
        docker, calls = self.mock_docker()
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), patch.object(retention, 'docker', docker), \
                patch.object(retention, 'current_images', return_value=self.current), \
                patch.object(retention, 'referenced_images', side_effect=[set(), {image_id(20)}]):
            retention.run(self.path, apply=True)
        self.assertFalse(any(call[:2] == ('image', 'rm') for call in calls))

        docker, calls = self.mock_docker()
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), patch.object(retention, 'docker', docker), \
                patch.object(retention, 'current_images', return_value=self.current), \
                patch.object(retention, 'referenced_images', return_value=set()):
            retention.run(self.path, apply=True)
        self.assertIn(('image', 'rm', '--no-prune', image_id(20)), calls)
        self.assertFalse(any('--force' in call or '-f' in call for call in calls))

    def test_deploy_changes_abort_cleanup(self):
        retention.save_history(self.path, self.history)
        docker, calls = self.mock_docker()
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), patch.object(retention, 'docker', docker), \
                patch.object(retention, 'current_images', side_effect=[self.current, {**self.current, 'data-api': image_id(30)}]), \
                patch.object(retention, 'referenced_images', return_value=set()):
            with self.assertRaises(RuntimeError):
                retention.run(self.path, apply=True)
        self.assertFalse(any(call[:2] == ('image', 'rm') for call in calls))

    def test_container_validation_rejects_wrong_project_and_unhealthy(self):
        containers = [{'Name': '/' + name, 'Image': self.current[service],
                       'Config': {'Image': retention.REPOSITORIES[service] + ':sha',
                                  'Labels': {'com.docker.compose.project': 'phone', 'com.docker.compose.service': service}},
                       'State': {'Running': True, 'Health': {'Status': 'healthy'}}}
                      for service, name in retention.SERVICES.items()]
        with patch.object(retention, 'inspect', return_value=containers):
            self.assertEqual(retention.current_images(), self.current)
            containers[0]['Config']['Labels']['com.docker.compose.project'] = 'prod'
            with self.assertRaises(ValueError):
                retention.current_images()
            containers[0]['Config']['Labels']['com.docker.compose.project'] = 'phone'
            containers[0]['State']['Health']['Status'] = 'unhealthy'
            with self.assertRaises(ValueError):
                retention.current_images()

    def test_missing_rollback_image_aborts_without_deleting_or_replacing_history(self):
        self.history['data-api'][1] = image_id(999)
        retention.save_history(self.path, self.history)
        docker, calls = self.mock_docker()
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), patch.object(retention, 'docker', docker), \
                patch.object(retention, 'current_images', return_value=self.current):
            with self.assertRaisesRegex(ValueError, '로컬에 없음'):
                retention.run(self.path, apply=True)
        self.assertFalse(any(call[:2] == ('image', 'rm') for call in calls))
        self.assertEqual(retention.load_history(self.path), self.history)

    def test_pre_smoke_cleanup_keeps_unverified_current_and_does_not_advance_history(self):
        retention.save_history(self.path, self.history)
        current = {**self.current, 'data-api': image_id(20)}
        docker, calls = self.mock_docker()
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), patch.object(retention, 'docker', docker), \
                patch.object(retention, 'current_images', return_value=current), \
                patch.object(retention, 'referenced_images', return_value=set()):
            retention.run(self.path, apply=True)
        self.assertFalse(any(call[:2] == ('image', 'rm') for call in calls))
        self.assertEqual(retention.load_history(self.path), self.history)

    def test_record_success_advances_history_without_deleting_images(self):
        retention.save_history(self.path, self.history)
        current = {**self.current, 'data-api': image_id(20)}
        with patch.dict(os.environ, {'DEPLOY_ENV': 'dev'}), \
                patch.object(retention, 'current_images', return_value=current), \
                patch.object(retention, 'docker') as docker:
            retention.run(self.path, record_success=True)
            docker.assert_not_called()
        self.assertEqual(retention.load_history(self.path)['data-api'], [image_id(20), image_id(1)])


class WorkflowTests(unittest.TestCase):
    def test_cleanup_precedes_wait_and_smoke_and_only_success_records_history(self):
        workflow = yaml.load((ROOT / '.github/workflows/ops-smoke.dev.yml').read_text(), Loader=yaml.BaseLoader)
        job = workflow['jobs']['execute']
        self.assertEqual(job['runs-on'], ['self-hosted', 'dev'])
        self.assertEqual(job['concurrency']['group'], 'dev-vm-deploy')
        self.assertGreaterEqual(int(job['timeout-minutes']), 15)
        steps = job['steps']
        wait = next(i for i, step in enumerate(steps) if 'sleep 300' in step.get('run', ''))
        smoke = next(i for i, step in enumerate(steps) if step.get('id') == 'smoke')
        cleanup = next(i for i, step in enumerate(steps) if 'dev-image-retention.py --apply' in step.get('run', ''))
        record = next(i for i, step in enumerate(steps) if '--record-success' in step.get('run', ''))
        self.assertLess(cleanup, wait)
        self.assertLess(wait, smoke)
        self.assertLess(smoke, record)
        self.assertIn("steps.smoke.outcome == 'success'", steps[record]['if'])
        self.assertIn('success()', steps[record]['if'])
        self.assertEqual(steps[cleanup]['env']['DEPLOY_ENV'], 'dev')

    def test_readiness_gate_sleeps_only_after_all_services_are_healthy(self):
        workflow = yaml.load((ROOT / '.github/workflows/ops-smoke.dev.yml').read_text(), Loader=yaml.BaseLoader)
        script = next(step['run'] for step in workflow['jobs']['execute']['steps'] if 'sleep 300' in step.get('run', ''))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, text in {
                'docker': '#!/bin/sh\nprintf "%s\\n" "$TEST_STATE"\n',
                'sleep': '#!/bin/sh\nprintf "%s" "$1" > "$TEST_SLEEP"\n',
            }.items():
                path = root / name
                path.write_text(text)
                path.chmod(0o700)
            marker = root / 'slept'
            env = {**os.environ, 'PATH': temp + os.pathsep + os.environ['PATH'], 'TEST_SLEEP': str(marker)}
            for state in ['true healthy', 'true starting', 'true unhealthy', 'false healthy', 'true none']:
                marker.unlink(missing_ok=True)
                result = subprocess.run(['bash', '-c', script], env={**env, 'TEST_STATE': state}, capture_output=True)
                self.assertEqual(result.returncode == 0, state == 'true healthy')
                self.assertEqual(marker.exists(), state == 'true healthy')
                if marker.exists():
                    self.assertEqual(marker.read_text(), '300')


if __name__ == '__main__':
    unittest.main()
