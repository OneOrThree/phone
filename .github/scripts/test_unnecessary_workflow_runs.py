"""실제 PR 변경 목록을 재생해 검사와 배포 경계의 재발을 확인한다."""
import importlib.util
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).parents[2]


def load(relative, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


app = load('.github/ci/app-change-plan.py', 'publication_plan')
paths = load('.github/scripts/wait-smoke-deploy.py', 'workflow_paths')
satellite = load('.github/scripts/satellite-ci-plan.py', 'satellite_plan')


def workflow(name):
    return yaml.load((ROOT / '.github/workflows' / (name + '.yml')).read_text(), Loader=yaml.BaseLoader)


class UnnecessaryRunRegressionTests(unittest.TestCase):
    def test_1102_tests_still_run_but_neither_app_is_published(self):
        changed = ['app/app-dev/src/screens/island/WorldMap.tileIsland.test.tsx']
        self.assertTrue(paths.matches_paths(changed, workflow('app-lint')['on']['push']['paths']))
        for platform in ('android', 'ios'):
            self.assertEqual(app.plan(changed, platform), {'build': False, 'publish': False})

    def test_733_and_976_markdown_does_not_schedule_full_app_checks(self):
        for event in ('push', 'pull_request'):
            patterns = workflow('app-lint')['on'][event]['paths']
            self.assertFalse(paths.matches_paths(['app/app-dev/README.md', 'docs/prd/fishcat/policy.md'], patterns))
            self.assertTrue(paths.matches_paths(['app/app-dev/src/App.tsx'], patterns))
            self.assertTrue(paths.matches_paths(['docs/prd/fishcat/island-movement/fixtures/paths.json'], patterns))

    def test_1225_android_settings_never_publish_ios(self):
        changed = ['app/app-dev/android/app/build.gradle', 'app/app-dev/android/gradle.properties']
        self.assertTrue(app.plan(changed, 'android')['publish'])
        self.assertFalse(app.plan(changed, 'ios')['publish'])

    def test_1237_workflow_validation_does_not_publish_either_platform(self):
        changed = ['.github/ci/posthog-sdk-config.py', '.github/workflows/app-android-ci.yml', 'app/app-dev/README.md']
        self.assertTrue(app.plan(changed, 'android')['build'])
        self.assertFalse(app.plan(changed, 'android')['publish'])
        self.assertFalse(app.plan(changed, 'ios')['publish'])

    def test_764_1281_documents_and_1238_smoke_helpers_make_no_satellite_image(self):
        for changed in (['server/data-api/README.md', 'server/realtime/README.md', 'server/notification/README.md'],
                        ['docs/architecture/system-architecture.md', 'server/realtime/CLAUDE.md'],
                        ['.github/scripts/dev-image-retention.py', '.github/workflows/ops-smoke.dev.yml']):
            self.assertFalse(any(satellite.plan(changed).values()))
        for name, service in [('data-api-ci.dev', 'data-api'), ('realtime-ci.dev', 'realtime')]:
            self.assertFalse(paths.matches_paths([f'server/{service}/README.md'], workflow(name)['on'].get('push', workflow(name)['on']['pull_request'])['paths']))

    def test_verified_publication_decision_is_required_before_credentials(self):
        cd = workflow('app-android-cd')['jobs']
        self.assertIn("needs.source.outputs.publish == 'true'", cd['sign']['if'])
        self.assertIn("needs.source.outputs.has-artifact == 'true'", cd['sign']['if'])
        ci = workflow('app-android-ci')['jobs']
        self.assertIn('change-plan', ci['build']['needs'])
        self.assertIn("needs.change-plan.outputs.build == 'true'", ci['build']['if'])
        self.assertIn("needs.change-plan.outputs.publish == 'true'", workflow('app-ios-testflight-dev')['jobs']['testflight-dev']['if'])


if __name__ == '__main__':
    unittest.main()
