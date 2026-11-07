"""교차 workflow 호출의 검사·권한·큐·배포 입력 계약을 확인한다."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).parents[1] / 'workflows'


def workflow(name):
    return yaml.load((ROOT / (name + '.yml')).read_text(), Loader=yaml.BaseLoader)


class WorkflowRefactorTests(unittest.TestCase):
    def test_local_reusable_workflows_exist_and_no_retired_dev_runner_is_used(self):
        for path in ROOT.glob('*.yml'):
            definition = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
            for job in definition.get('jobs', {}).values():
                target = job.get('uses', '')
                if target.startswith('./.github/workflows/'):
                    self.assertTrue((ROOT / target.rsplit('/', 1)[-1]).is_file(), target)
                runner = job.get('runs-on')
                if isinstance(runner, list):
                    self.assertFalse('self-hosted' in runner and 'dev' in runner, path.name)
        self.assertIn('deployment-badges.py', (ROOT / 'cd-auto.dev-v2.yml').read_text())


    def test_app_queues_keep_latest_pending_with_publication_based_classification(self):
        ios, android, cd = workflow('app-ios-testflight-dev'), workflow('app-android-ci'), workflow('app-android-cd')
        self.assertIn('ios-testflight-dev', ios['concurrency']['group'])
        self.assertIn('ios-testflight-validation-', ios['concurrency']['group'])
        self.assertIn('vars.IOS_DEV_RUNNERS', ios['concurrency']['group'])
        self.assertIn('android-ci-main', android['concurrency']['group'])
        self.assertIn('android-ci-main-validation', android['concurrency']['group'])
        self.assertIn("github.event_name == 'push'", android['concurrency']['group'])
        self.assertIn('android-play-validation-', cd['concurrency']['group'])
        for definition in (ios, android):
            planner = definition['jobs']['change-plan']
            self.assertEqual(planner['permissions']['actions'], 'read')
            self.assertEqual(planner['steps'][0]['with']['fetch-depth'], '0')
        for definition, job in ((ios, 'testflight-dev'), (cd, 'play-internal')):
            steps = definition['jobs'][job]['steps']
            self.assertTrue(any('--record' in step.get('run', '') for step in steps))
            self.assertTrue(any(step.get('with', {}).get('name') == 'app-publication' for step in steps))

    def test_failed_ci_completion_cannot_replace_pending_play_publication(self):
        group = workflow('app-android-cd')['concurrency']['group']
        self.assertIn("github.event.workflow_run.conclusion == 'success'", group)
        self.assertIn('github.event.workflow_run.head_repository.id == github.event.repository.id', group)
        self.assertIn("github.ref == 'refs/heads/main'", group)
        self.assertIn('android-play-validation-', group)

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

    def test_android_main_build_passes_server_gate_before_key_and_build_jobs(self):
        android = workflow('app-android-ci')
        gate = android['jobs']['server-gate']
        self.assertEqual(gate['steps'][0]['with']['fetch-depth'], '0')
        self.assertEqual(gate['steps'][-1]['run'], 'python3 .github/scripts/app-server-gate.py')
        self.assertIn('GH_TOKEN', gate['steps'][-1]['env'])
        self.assertIn('server-gate', android['jobs']['settings']['needs'])
        self.assertIn("needs.server-gate.result == 'success'", android['jobs']['settings']['if'])
        self.assertNotIn('GH_TOKEN', android['jobs']['build']['env'])
        # 건너뛰기 값이 게이트 잡까지 번지면 판정 없이 통과한다.
        self.assertNotIn('ALLOW_SERVER_GAP', android.get('env', {}))
        self.assertNotIn('ALLOW_SERVER_GAP', gate['steps'][-1]['env'])
        self.assertNotIn('ALLOW_SERVER_GAP', android['jobs']['build']['env'])
        self.assertEqual(android['jobs']['build']['env']['GROMO_ANDROID_CI_ARTIFACT'], '1')
        self.assertNotIn('GROMO_ANDROID_CI_ARTIFACT', android.get('env', {}))
        self.assertNotIn('GROMO_ANDROID_CI_ARTIFACT', gate['steps'][-1]['env'])

    def test_android_pr_runs_contract_tests_without_building_aab(self):
        android = workflow('app-android-ci')
        self.assertNotIn('pull_request', android['jobs']['build']['if'])
        self.assertIn('pull_request', android['on'])
        names = [step.get('name') for step in android['jobs']['change-plan']['steps']]
        # 계약 검사가 판정보다 앞이어야 실패할 때 판정값이 비어 AAB·CD 까지 가지 않는다.
        self.assertLess(names.index('SDK 설정·CI/CD 산출물 계약 검사'), names.index('실제 변경 입력 판정'))

    def test_gate_changes_always_schedule_required_lint(self):
        lint = workflow('app-lint')['on']['push']['paths']
        for name in ('app-ios-testflight-dev.yml', 'app-android-ci.yml', 'app-android-build.yml'):
            self.assertIn('.github/workflows/' + name, lint)
        self.assertIn('.github/scripts/wait-app-checks.py', lint)
