#!/usr/bin/env python3
"""누락·실패·선행 실패를 passing 배지로 보고하지 않는지 검증한다."""
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
        env = patch.dict(os.environ, {'SMOKE_RUN_RESULT': 'success', 'DEPLOY_WAIT_RESULT': 'success',
            'RUN_URL': 'https://example.test/run', 'GITHUB_STEP_SUMMARY': os.devnull})
        env.start(); self.addCleanup(env.stop)
        self.results('PASS')

    def results(self, status):
        self.path.write_text('id\tstatus\thttp_code\tms\treason\n' + '\n'.join(
            f'{tc}\t{status}\t200\t9\tprobe' for tc in sorted(report.EXPECTED)) + '\n')

    def test_all_15_pass(self):
        self.assertEqual(report.report(self.temp.name), 0)

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
        os.environ['DEPLOY_WAIT_RESULT'] = 'skipped'
        self.assertEqual(report.report(self.temp.name), 0)


if __name__ == '__main__':
    unittest.main()
