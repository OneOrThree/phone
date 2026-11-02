#!/usr/bin/env python3
"""main당 한 실행·완료 배지·배포 잠금 경계를 검증한다."""
from pathlib import Path
import unittest
import json
import os
import subprocess
import tempfile
import yaml

ROOT = Path(__file__).parents[2]


class SmokeWorkflowTests(unittest.TestCase):
    def test_v2_smoke_is_dispatched_and_shares_deployment_lock(self):
        workflow = yaml.load((ROOT / '.github/workflows/ops-smoke.dev-v2.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(set(workflow['on']), {'workflow_dispatch'})
        job = workflow['jobs']['execute']
        self.assertEqual(job['runs-on'], 'ubuntu-latest')
        self.assertEqual(job['concurrency']['group'], 'catus-dev-v2-deploy')
        self.assertEqual(job['concurrency']['queue'], 'max')
        self.assertIn('dev-smoke-docker-V2.py', job['env']['SMOKE_DOCKER'])


    def test_dev_v2_smoke_runs_after_app_or_runtime_deploy(self):
        workflow = yaml.load((ROOT / '.github/workflows/cd-auto.dev-v2.yml').read_text(), Loader=yaml.BaseLoader)
        step = next(s for s in workflow['jobs']['record']['steps'] if s.get('name') == '스모크 실행 요청')
        self.assertIn("needs.app.result == 'success'", step['if'])
        self.assertIn("needs.runtime.result == 'success'", step['if'])
        self.assertEqual(step['continue-on-error'], 'true')

    def test_badge_tracks_dev_v2_main_runs(self):
        for name in ('README.md', 'smoke/README.md'):
            text = (ROOT / name).read_text()
            self.assertIn('ops-smoke.dev-v2.yml/badge.svg?branch=main', text)

    def test_login_diagnostics_are_uploaded_and_regressions_run_on_report_changes(self):
        workflow = yaml.load((ROOT / '.github/workflows/ops-smoke.dev-v2.yml').read_text(), Loader=yaml.BaseLoader)
        smoke = next(step for step in workflow['jobs']['execute']['steps'] if step.get('id') == 'smoke')
        self.assertEqual(smoke['env']['SMOKE_AUTH_DIAGNOSTICS_FILE'],
                         '${{ runner.temp }}/smoke-results/api/auth-attempts.jsonl')
        checks = yaml.load((ROOT / '.github/workflows/smoke-check.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertIn('.github/scripts/report-smoke.py', checks['on']['pull_request']['paths'])
        self.assertIn('.github/scripts/test_smoke_report.py', checks['on']['pull_request']['paths'])
        commands = '\n'.join(step.get('run', '') for step in checks['jobs']['checks']['steps'])
        self.assertIn("discover -s smoke/server/tests -p 'test_*.py'", commands)
        self.assertIn("-p 'test_smoke_report.py'", commands)
        self.assertIn("-p 'test_smoke_guest_budget.py'", commands)
        self.assertIn("-p 'test_smoke_workflow.py'", commands)


if __name__ == '__main__':
    unittest.main()
