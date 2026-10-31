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
    def test_main_push_without_schedule_or_cd_duplicate_calls(self):
        text = (ROOT / '.github/workflows/ops-smoke.dev.yml').read_text()
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        self.assertEqual(workflow['on']['push']['branches'], ['main'])
        self.assertNotIn('schedule', workflow['on'])
        self.assertNotIn('workflow_call', workflow['on'])
        for filename in ('data-api-cd.dev.yml', 'satellite-cd.dev.yml'):
            self.assertNotIn('uses: ./.github/workflows/ops-smoke.dev.yml', (ROOT / '.github/workflows' / filename).read_text())
        self.assertNotEqual(workflow['concurrency']['group'], 'dev-vm-deploy')
        self.assertEqual(workflow['jobs']['execute']['concurrency']['group'], 'dev-vm-deploy')
        self.assertEqual(workflow['jobs']['execute']['needs'], ['wait-deploy', 'guest-budget'])
        self.assertNotIn('concurrency', workflow['jobs']['guest-budget'])
        self.assertTrue(all(step.get('with', {}).get('ref', '${{ github.sha }}') == '${{ github.sha }}'
            for job in workflow['jobs'].values() for step in job['steps'] if step.get('uses') == 'actions/checkout@v4'))

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
        workflow = yaml.load((ROOT / '.github/workflows/ops-smoke.dev.yml').read_text(), Loader=yaml.BaseLoader)
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

    def test_no_service_deploy_plan_is_success_and_invalid_types_fail(self):
        workflow = yaml.load((ROOT / '.github/workflows/satellite-cd.dev.yml').read_text(), Loader=yaml.BaseLoader)
        script = next(step['run'] for step in workflow['jobs']['plan']['steps'] if step.get('id') == 'plan')
        script = script.replace('${{ github.event.workflow_run.head_sha }}', '1' * 40)
        for values, expected in [({'business-api': False, 'notification': False}, 0),
                                 ({'business-api': False, 'notification': True}, 0),
                                 ({'business-api': True, 'notification': False}, 0),
                                 ({'business-api': 'false', 'notification': False}, 1)]:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'image-inputs/plan'; path.mkdir(parents=True)
                (path / 'satellite-deploy-plan.json').write_text(json.dumps(values))
                env = {**os.environ, 'GITHUB_OUTPUT': tmp + '/output', 'GITHUB_STEP_SUMMARY': tmp + '/summary'}
                result = subprocess.run(['bash', '-c', script], cwd=tmp, env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected, result.stderr)
                if expected == 0:
                    output = (Path(tmp) / 'output').read_text()
                    self.assertIn('any=' + str(any(values.values())).lower(), output)

    def test_satellite_deploy_status_identifies_original_ci_attempt(self):
        text = (ROOT / '.github/workflows/satellite-cd.dev.yml').read_text()
        self.assertIn('sha: source.head_sha', text)
        self.assertIn('source.id}/${source.run_attempt', text)
        self.assertIn("context: 'dev-deploy/satellites'", text)
        self.assertIn('statuses: write', text)


if __name__ == '__main__':
    unittest.main()
