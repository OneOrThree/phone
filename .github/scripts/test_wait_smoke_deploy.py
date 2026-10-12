#!/usr/bin/env python3
"""실제 push 경로 필터와 CI/별도 CD 완료의 실패·대기·재시도 경계를 검증한다."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('wait', Path(__file__).with_name('wait-smoke-deploy.py'))
wait = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wait)
ROOT = Path(__file__).parents[2]
SHA = '1' * 40


def run(name, **changes):
    return {'path': '.github/workflows/' + name, 'id': 5, 'run_attempt': 2, 'event': 'push',
            'head_branch': 'main', 'head_sha': SHA, 'status': 'completed', 'conclusion': 'success', **changes}


class WaitTests(unittest.TestCase):
    def test_documentation_does_not_wait_for_untouched_services(self):
        self.assertEqual(wait.expected_workflows(ROOT, ['README.md', 'server/data-api/README.md', 'server/data-api/docs/db/schema.dbml']), set())

    def test_code_uses_current_ci_push_filters(self):
        self.assertEqual(wait.expected_workflows(ROOT, ['server/data-api/src/main/java/Auth.java']), {'data-api-ci.dev.yml', 'satellite-ci.dev.yml'})
        self.assertEqual(wait.expected_workflows(ROOT, ['server/realtime/src/main/java/Chat.java']), {'realtime-ci.dev.yml'})

    def test_globstar_includes_zero_directory_levels_and_exclusions(self):
        self.assertTrue(wait.glob_match('server/data-api/README.md', 'server/data-api/**/*.md'))
        self.assertFalse(wait.selected('server/data-api/docs/x.md', ['server/data-api/**', '!server/data-api/docs/**']))

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


if __name__ == '__main__':
    unittest.main()
