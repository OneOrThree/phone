#!/usr/bin/env python3
"""실제 push 경로 필터와 CI/별도 CD 완료의 실패·대기·재시도 경계를 검증한다."""
import importlib.util
from pathlib import Path
import unittest
import os
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('wait', Path(__file__).with_name('wait-smoke-deploy.py'))
wait = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wait)
ROOT = Path(__file__).parents[2]
SHA = '1' * 40


def run(name, **changes):
    return {'path': '.github/workflows/' + name, 'id': 5, 'run_attempt': 2, 'event': 'push',
            'head_branch': 'main', 'head_sha': SHA, 'status': 'completed', 'conclusion': 'success', **changes}


class WaitTests(unittest.TestCase):
    def test_discovery_uses_actual_runs_even_for_document_only_large_push(self):
        runs = [run('data-api-ci.dev.yml'), run('satellite-ci.dev.yml')]
        self.assertEqual(wait.observed_workflows(runs, SHA), {'data-api-ci.dev.yml', 'satellite-ci.dev.yml'})

    def test_filtered_out_service_is_not_invented_from_local_diff(self):
        self.assertEqual(wait.observed_workflows([run('realtime-ci.dev.yml')], SHA), {'realtime-ci.dev.yml'})
        self.assertEqual(wait.observed_workflows([], SHA), set())

    def test_discovery_ignores_pr_other_sha_and_other_workflows(self):
        runs = [run('data-api-ci.dev.yml', event='pull_request'),
                run('data-api-ci.dev.yml', head_sha='2' * 40), run('other.yml')]
        self.assertEqual(wait.observed_workflows(runs, SHA), set())

    def test_missing_or_pending_ci_waits(self):
        expected = {'data-api-ci.dev.yml'}
        self.assertEqual(wait.verdict(expected, [], [], SHA)[0], 'waiting')
        self.assertEqual(wait.verdict(expected, [run('data-api-ci.dev.yml', status='queued')], [], SHA)[0], 'waiting')

    def test_pr_or_another_commit_cannot_satisfy_main_deploy(self):
        expected = {'data-api-ci.dev.yml'}
        for changes in ({'event': 'pull_request'}, {'head_sha': '2' * 40}, {'head_branch': 'feature'}):
            self.assertEqual(wait.verdict(expected, [run('data-api-ci.dev.yml', **changes)], [], SHA)[0], 'waiting')

    def test_failed_ci_blocks_smoke(self):
        self.assertEqual(wait.verdict({'data-api-ci.dev.yml'}, [run('data-api-ci.dev.yml', conclusion='failure')], [], SHA)[0], 'failure')

    def test_newer_attempt_is_authoritative(self):
        runs = [run('data-api-ci.dev.yml', run_attempt=1), run('data-api-ci.dev.yml', status='in_progress')]
        self.assertEqual(wait.verdict({'data-api-ci.dev.yml'}, runs, [], SHA)[0], 'waiting')

    def test_satellite_requires_current_ci_attempt_deploy(self):
        runs = [run('satellite-ci.dev.yml')]
        old = {'context': wait.SATELLITE_CONTEXT, 'state': 'success', 'description': 'Satellite CI 5/1: success'}
        self.assertEqual(wait.verdict({'satellite-ci.dev.yml'}, runs, [old], SHA)[0], 'waiting')
        current = {**old, 'description': 'Satellite CI 5/2: success'}
        self.assertEqual(wait.verdict({'satellite-ci.dev.yml'}, runs, [current], SHA)[0], 'success')
        self.assertEqual(wait.verdict({'satellite-ci.dev.yml'}, runs, [{**current, 'state': 'failure'}], SHA)[0], 'failure')

    def test_no_service_change_needs_no_deploy(self):
        self.assertEqual(wait.verdict(set(), [], [], SHA)[0], 'success')

    def test_main_waits_for_delayed_run_registration(self):
        now = [0]
        def pages(path, key=None):
            if now[0] < 90:
                return []
            return [run('data-api-ci.dev.yml', status='queued')] if now[0] < 240 else [run('data-api-ci.dev.yml')]
        with patch.dict(os.environ, {'GITHUB_SHA': SHA, 'SMOKE_DEPLOY_DISCOVERY_SECONDS': '120', 'SMOKE_DEPLOY_WAIT_SECONDS': '10800'}), \
             patch.object(wait, 'pages', pages), patch.object(wait.time, 'monotonic', lambda: now[0]), \
             patch.object(wait.time, 'sleep', lambda n: now.__setitem__(0, now[0] + n)):
            self.assertEqual(wait.main(), 0)
        self.assertGreaterEqual(now[0], 240)

    def test_valid_pipeline_longer_than_one_hour_can_finish(self):
        now = [0]
        def pages(path, key=None):
            return [run('data-api-ci.dev.yml', status='in_progress' if now[0] < 6000 else 'completed')]
        with patch.dict(os.environ, {'GITHUB_SHA': SHA, 'SMOKE_DEPLOY_DISCOVERY_SECONDS': '120', 'SMOKE_DEPLOY_WAIT_SECONDS': '10800'}), \
             patch.object(wait, 'pages', pages), patch.object(wait.time, 'monotonic', lambda: now[0]), \
             patch.object(wait.time, 'sleep', lambda n: now.__setitem__(0, now[0] + n)):
            self.assertEqual(wait.main(), 0)
        self.assertGreaterEqual(now[0], 6000)

    def test_no_ci_still_observes_registration_window(self):
        now = [0]
        with patch.dict(os.environ, {'GITHUB_SHA': SHA, 'SMOKE_DEPLOY_DISCOVERY_SECONDS': '120'}), \
             patch.object(wait, 'pages', return_value=[]), patch.object(wait.time, 'monotonic', lambda: now[0]), \
             patch.object(wait.time, 'sleep', lambda n: now.__setitem__(0, now[0] + n)):
            self.assertEqual(wait.main(), 0)
        self.assertGreaterEqual(now[0], 120)


class SatelliteGateTests(unittest.TestCase):
    def test_path_filters_honor_exclusion_and_nested_files(self):
        patterns = ['server/data-api/**', '!server/data-api/docs/**', '!server/data-api/**/*.md', '.github/scripts/**']
        self.assertTrue(wait.matches_paths(['server/data-api/src/main/Foo.java'], patterns))
        self.assertFalse(wait.matches_paths(['server/data-api/README.md', 'server/data-api/docs/db/tool.py'], patterns))
        self.assertTrue(wait.matches_paths(['.github/scripts/dev-env.sh'], patterns))
        self.assertFalse(wait.path_matches('server/a/b/c.yml', 'server/*.yml'))

    def test_expected_but_delayed_workflow_never_skips(self):
        now = [0]
        with patch.dict(os.environ, {'GITHUB_SHA': SHA, 'DEPLOY_WAIT_SATELLITES_ONLY': 'true',
             'SMOKE_DEPLOY_WAIT_SECONDS': '180', 'SMOKE_DEPLOY_DISCOVERY_SECONDS': '30'}), \
             patch.object(wait, 'satellite_expected', return_value=True), patch.object(wait, 'api', return_value={'id': 77}), \
             patch.object(wait, 'pages', return_value=[]), patch.object(wait.time, 'monotonic', lambda: now[0]), \
             patch.object(wait.time, 'sleep', lambda n: now.__setitem__(0, now[0] + n)):
            self.assertEqual(wait.main(), 1)
            self.assertGreaterEqual(now[0], 180)

    def test_unrelated_change_skips_without_querying_workflows(self):
        with patch.dict(os.environ, {'GITHUB_SHA': SHA, 'DEPLOY_WAIT_SATELLITES_ONLY': 'true'}), \
             patch.object(wait, 'satellite_expected', return_value=False), patch.object(wait, 'api') as api:
            self.assertEqual(wait.main(), 0)
            api.assert_not_called()

    def test_gate_waits_only_verified_satellite_workflow_and_matching_attempt(self):
        now = [0]
        def pages(path, key=None):
            if '/statuses' in path:
                return [{'context': wait.SATELLITE_CONTEXT, 'state': 'success', 'description': 'Satellite CI 5/2: success'}]
            return [run('data-api-ci.dev.yml', status='in_progress'),
                    run('satellite-ci.dev.yml', workflow_id=88 if now[0] < 60 else 77)]
        with patch.dict(os.environ, {'GITHUB_SHA': SHA, 'DEPLOY_WAIT_SATELLITES_ONLY': 'true', 'SMOKE_DEPLOY_DISCOVERY_SECONDS': '0'}), \
             patch.object(wait, 'satellite_expected', return_value=True), patch.object(wait, 'api', return_value={'id': 77}), \
             patch.object(wait, 'pages', pages), patch.object(wait.time, 'monotonic', lambda: now[0]), \
             patch.object(wait.time, 'sleep', lambda n: now.__setitem__(0, now[0] + n)):
            self.assertEqual(wait.main(), 0)
            self.assertGreaterEqual(now[0], 60)


if __name__ == '__main__':
    unittest.main()
