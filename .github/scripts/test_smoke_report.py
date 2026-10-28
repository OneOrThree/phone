#!/usr/bin/env python3
"""누락·실패·선행 실패를 passing 배지로 보고하지 않는지 검증한다."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('report-smoke.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class SmokeReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'results.tsv'
        env = patch.dict(os.environ, {'SMOKE_RUN_RESULT': 'success', 'DEPLOY_WAIT_RESULT': 'success',
            'SMOKE_EVENT_NAME': 'push', 'RUN_URL': 'https://example.test/run', 'GITHUB_STEP_SUMMARY': os.devnull})
        env.start(); self.addCleanup(env.stop)
        self.results('PASS')

    def results(self, status):
        self.path.write_text('id\tstatus\thttp_code\tms\treason\n' + '\n'.join(
            f'{tc}\t{status}\t200\t9\tprobe' for tc in sorted(report.EXPECTED)) + '\n')

    def test_all_15_pass(self):
        self.assertEqual(report.report(self.temp.name), 0)

    def test_no_deploy_has_explicit_unexecuted_summary(self):
        os.environ['SMOKE_NEEDED'] = 'false'
        os.environ['SMOKE_RUN_RESULT'] = 'skipped'
        self.path.unlink()
        self.assertEqual(report.report(self.temp.name), 0)

    def test_superseded_target_does_not_invent_15_failures(self):
        os.environ['SMOKE_TARGET_STATE'] = 'superseded'
        self.path.unlink()
        self.assertEqual(report.report(self.temp.name), 0)
        os.environ['SMOKE_RUN_RESULT'] = 'failure'
        self.assertEqual(report.report(self.temp.name), 1)

    def test_partial_results_cannot_pass(self):
        self.path.write_text('id\tstatus\thttp_code\tms\treason\nSMOKE-SERVER-001\tPASS\t200\t9\tprobe\n')
        self.assertEqual(report.report(self.temp.name), 1)

    def test_dependency_skip_cannot_pass(self):
        self.results('SKIP')
        self.assertEqual(report.report(self.temp.name), 1)

    def test_deploy_failure_cannot_pass(self):
        os.environ['DEPLOY_WAIT_RESULT'] = 'failure'
        self.assertEqual(report.report(self.temp.name), 1)

    def test_execution_cleanup_failure_cannot_pass(self):
        os.environ['SMOKE_RUN_RESULT'] = 'failure'
        self.assertEqual(report.report(self.temp.name), 1)

    def test_manual_execution_without_deploy_wait(self):
        os.environ['SMOKE_EVENT_NAME'] = 'workflow_dispatch'
        os.environ['DEPLOY_WAIT_RESULT'] = 'skipped'
        self.assertEqual(report.report(self.temp.name), 0)

    def test_automatic_execution_requires_successful_deploy_wait(self):
        os.environ['DEPLOY_WAIT_RESULT'] = 'skipped'
        self.assertEqual(report.report(self.temp.name), 1)

    def test_recovered_login_is_visible_without_turning_final_pass_into_failure(self):
        row = {'kind': 'result', 'role': 'main', 'result': 'success', 'attempts': 2,
               'retries': 1, 'elapsed_ms': 9000, 'first_error': 'UPSTREAM_TIMEOUT'}
        path = Path(self.temp.name) / 'auth-attempts.jsonl'
        path.write_text(json.dumps({'kind': 'attempt', 'http_code': '504'}) + '\n' + json.dumps(row) + '\n')
        summary = Path(self.temp.name) / 'summary.md'
        os.environ['GITHUB_STEP_SUMMARY'] = str(summary)
        self.assertEqual(report.report(self.temp.name), 0)
        self.assertIn('재시도 후 통과 | 2 | 1 | 9000 | UPSTREAM_TIMEOUT', summary.read_text())

    def test_missing_tc_or_final_failure_still_fails_after_a_recovered_login(self):
        path = Path(self.temp.name) / 'auth-attempts.jsonl'
        path.write_text(json.dumps({'kind': 'result', 'role': 'main', 'result': 'success',
                                   'attempts': 2, 'retries': 1, 'elapsed_ms': 9000,
                                   'first_error': 'UPSTREAM_TIMEOUT'}) + '\n')
        self.results('SKIP')
        self.assertEqual(report.report(self.temp.name), 1)

    def test_invalid_diagnostic_does_not_leak_arbitrary_values_to_summary(self):
        path = Path(self.temp.name) / 'auth-attempts.jsonl'
        path.write_text(json.dumps({'kind': 'result', 'role': 'secret-token'}) + '\n')
        summary = Path(self.temp.name) / 'summary.md'
        os.environ['GITHUB_STEP_SUMMARY'] = str(summary)
        self.assertEqual(report.report(self.temp.name), 1)
        self.assertNotIn('secret-token', summary.read_text())


if __name__ == '__main__':
    unittest.main()
