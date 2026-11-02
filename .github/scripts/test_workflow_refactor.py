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

    def test_main_pr_builds_each_service_once_and_release_keeps_prod_checks(self):
        prod = workflow('prod-ci')
        for name in ('checks', 'images'):
            self.assertIn("github.base_ref == 'release'", prod['jobs'][name]['if'])
            self.assertIn("github.event_name != 'pull_request'", prod['jobs'][name]['if'])
        for filename, job, producer in [('data-api-ci.dev', 'build', 'test'),
                                          ('realtime-ci.dev', 'docker-build', 'build'),
                                          ('satellite-ci.dev', 'images', 'checks')]:
            definition = workflow(filename)
            self.assertIn('.github/workflows/prod-ci.yml', definition['on']['pull_request']['paths'])
            self.assertIn('.github/actions/check-arm-image/**', definition['on']['pull_request']['paths'])
            image = definition['jobs'][job]
            self.assertIn(producer, image['needs'])
            steps = image['steps']
            verify = next(i for i, step in enumerate(steps) if step.get('uses') == './.github/actions/ci-jar')
            arm = next(i for i, step in enumerate(steps) if step.get('uses') == './.github/actions/check-arm-image')
            self.assertLess(verify, arm)
            self.assertIn("github.event_name == 'pull_request'", steps[arm]['if'])
            self.assertNotIn('gradlew', steps[arm].get('run', ''))
        arm = yaml.load((ROOT.parent / 'actions/check-arm-image/action.yml').read_text(), Loader=yaml.BaseLoader)
        inputs = arm['runs']['steps'][0]['with']
        self.assertEqual(inputs['platforms'], 'linux/arm64')
        self.assertEqual(inputs['build-args'], 'JAR_SOURCE=prebuilt')
        self.assertEqual(inputs['push'], 'false')

    def test_progressing_deploy_is_retained_and_shared_vm_waits_are_not_dropped(self):
        for name in ('data-api-ci.dev', 'satellite-ci.dev', 'ops-smoke.dev'):
            w = workflow(name)
            self.assertNotEqual(w['concurrency']['cancel-in-progress'], 'true')
            self.assertNotIn('queue', w['concurrency'])
        for name in ('data-api-cd.dev', 'satellite-cd.dev'):
            self.assertEqual(workflow(name)['concurrency']['queue'], 'max')

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
