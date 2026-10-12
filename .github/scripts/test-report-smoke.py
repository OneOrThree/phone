#!/usr/bin/env python3
"""네트워크 요청 없이 스모크 판정과 GitHub 피드백 경로를 검증한다."""
import importlib.util
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
        self.env = patch.dict(os.environ, {
            'EXTERNAL_RESULT': 'success', 'INTERNAL_RESULT': 'success',
            'CORE_REQUESTED': 'false', 'CORE_RESULT': 'skipped',
            'RUN_URL': 'https://example.test/run', 'SMOKE_EVENT': 'workflow_dispatch',
            'DEPLOY_REVISION': '', 'GITHUB_STEP_SUMMARY': os.devnull})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.results('PASS')

    def results(self, status):
        rows = [f'SMOKE-SERVER-{number:03}\t{status}\t200\t9\tprobe' for number in [*range(1, 11), 17, 18]]
        self.path.write_text('id\tstatus\thttp_code\tms\treason\n' + '\n'.join(rows) + '\n')

    def test_success_and_infrastructure_failure(self):
        self.assertEqual(report.report(self.temp.name), 0)
        os.environ['INTERNAL_RESULT'] = 'failure'
        self.assertEqual(report.report(self.temp.name), 1)

    def test_missing_basic_suite_cannot_pass(self):
        self.path.write_text('id\tstatus\thttp_code\tms\treason\nSMOKE-SERVER-001\tPASS\t200\t9\tprobe\n')
        self.assertEqual(report.report(self.temp.name), 1)

    def test_missing_full_suite_cannot_pass(self):
        os.environ.update(CORE_REQUESTED='true', CORE_RESULT='success')
        self.assertEqual(report.report(self.temp.name), 1)

    def test_dependency_skip_cannot_pass(self):
        self.results('SKIP')
        self.assertEqual(report.report(self.temp.name), 1)

    def test_deploy_failure_labels_and_comments(self):
        self.results('FAIL')
        os.environ['DEPLOY_REVISION'] = 'abc'
        def api(method, path, payload=None):
            if path.startswith('/commits/'):
                return [{'number': 2, 'merged_at': 'today'}]
            return {}
        with patch.object(report, 'api', side_effect=api) as request:
            self.assertEqual(report.report(self.temp.name), 1)
            paths = [call.args[1] for call in request.call_args_list]
            self.assertIn('/issues/2/labels', paths)
            self.assertIn('/issues/2/comments', paths)

    def test_schedule_failure_then_recovery(self):
        os.environ['SMOKE_EVENT'] = 'schedule'
        def api(method, path, payload=None):
            if path.startswith('/issues?'):
                return [{'number': 3, 'body': '<!-- gromo-dev-smoke -->'}]
            return {}
        with patch.object(report, 'api', side_effect=api) as request:
            self.results('FAIL')
            self.assertEqual(report.report(self.temp.name), 1)
            self.assertIn('/issues/3/comments', [call.args[1] for call in request.call_args_list])
            request.reset_mock()
            self.results('PASS')
            self.assertEqual(report.report(self.temp.name), 0)
            request.assert_any_call('PATCH', '/issues/3', {'state': 'closed'})


if __name__ == '__main__':
    unittest.main()
