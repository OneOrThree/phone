"""교차 workflow 호출의 검사·권한·큐·배포 입력 계약을 확인한다."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).parents[1] / 'workflows'


def workflow(name):
    return yaml.load((ROOT / (name + '.yml')).read_text(), Loader=yaml.BaseLoader)


class WorkflowRefactorTests(unittest.TestCase):
    def test_release_image_has_one_jar_producer_and_verifies_it(self):
        prod = workflow('prod-ci')
        self.assertIn('checks', prod['jobs']['images']['needs'])
        self.assertEqual(prod['jobs']['checks']['uses'], './.github/workflows/be-gradle.yml')
        self.assertEqual(prod['jobs']['checks']['with']['publish-jar'], 'true')
        jars = [step['with']['operation'] for step in prod['jobs']['images']['steps']
                if step.get('uses') == './.github/actions/ci-jar']
        self.assertEqual(jars, ['verify'])
        self.assertEqual(workflow('satellite-ci.prod')['jobs']['checks']['with']['build-services'], 'false')
        self.assertNotIn('images', workflow('satellite-ci.prod')['jobs'])

    def test_progressing_deploy_is_retained_and_shared_vm_waits_are_not_dropped(self):
        for name in ('data-api-ci.dev', 'satellite-ci.dev', 'app-ios-testflight-dev', 'ops-smoke.dev'):
            w = workflow(name)
            self.assertNotEqual(w['concurrency']['cancel-in-progress'], 'true')
            self.assertNotIn('queue', w['concurrency'])
        for name in ('data-api-cd.dev', 'satellite-cd.dev'):
            self.assertEqual(workflow(name)['concurrency']['queue'], 'max')

    def test_ios_has_no_pr_event_and_auto_upload_requires_quality(self):
        ios = workflow('app-ios-testflight-dev')
        self.assertNotIn('pull_request', ios['on'])
        self.assertIn('quality-gate', ios['jobs']['testflight-dev']['needs'])
        self.assertIn("needs.quality-gate.result == 'success'", ios['jobs']['testflight-dev']['if'])
        android = workflow('app-android-ci')
        self.assertIn('quality-gate', android['jobs']['settings']['needs'])
        self.assertIn("needs.settings.result == 'success'", android['jobs']['build']['if'])
        self.assertEqual(android['jobs']['quality-gate']['steps'][-1]['env']['APP_PLATFORM'], 'android')
        self.assertEqual(ios['jobs']['quality-gate']['steps'][-1]['env']['APP_PLATFORM'], 'ios')

    def test_android_cd_is_independent_and_ci_does_not_sign_or_publish(self):
        ci, cd = workflow('app-android-ci'), workflow('app-android-cd')
        self.assertNotIn('sign', ci['jobs'])
        self.assertNotIn('deploy', ci['jobs'])
        self.assertNotIn('workflow_call', cd['on'])
        self.assertEqual(cd['on']['workflow_run']['workflows'], ['Android CI'])
        self.assertEqual(cd['on']['workflow_run']['branches'], ['main'])
        self.assertEqual(cd['jobs']['source']['steps'][0]['with']['ref'], 'main')
        self.assertEqual(cd['jobs']['play-internal']['needs'], ['source', 'sign'])
        self.assertNotIn('id-token', cd['jobs']['source'].get('permissions', {}))
        sign = cd['jobs']['sign']['steps']
        verify_index = next(i for i, step in enumerate(sign) if step.get('name') == '서명 전 원본 AAB·SHA·실행 검증')
        auth_index = next(i for i, step in enumerate(sign) if step.get('name') == 'AWS 인증')
        self.assertLess(verify_index, auth_index)

    def test_gate_changes_always_schedule_required_lint(self):
        lint = workflow('app-lint')['on']['push']['paths']
        for name in ('app-ios-testflight-dev.yml', 'app-android-ci.yml', 'app-android-build.yml'):
            self.assertIn('.github/workflows/' + name, lint)
        self.assertIn('.github/scripts/wait-app-checks.py', lint)
