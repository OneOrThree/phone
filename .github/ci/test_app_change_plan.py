"""조사에서 확인한 교차 플랫폼 게시·테스트 전용 게시 재발을 막는다."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('app_plan', Path(__file__).with_name('app-change-plan.py'))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class AppChangePlanTests(unittest.TestCase):
    def test_test_and_document_only_changes_never_build_or_publish(self):
        for path in ('app/app-dev/README.md', 'app/app-dev/src/WorldMap.tileIsland.test.tsx',
                     'app/app-dev/src/__mocks__/api.ts', 'app/app-dev/jest.setup.js',
                     'app/app-dev/android/app/src/androidTest/java/Example.java'):
            for platform in ('android', 'ios'):
                with self.subTest(path=path, platform=platform):
                    self.assertEqual(app.plan([path], platform), {'build': False, 'publish': False})

    def test_native_changes_only_publish_the_affected_platform(self):
        for platform, other in [('android', 'ios'), ('ios', 'android')]:
            for path in (f'app/app-dev/{platform}/project.config', f'app/app-dev/modules/audio/{platform}/Source',
                         f'app/app-dev/src/Thing.{platform}.tsx'):
                with self.subTest(path=path):
                    self.assertTrue(app.plan([path], platform)['publish'])
                    self.assertFalse(app.plan([path], other)['publish'])

    def test_shared_sources_assets_dependencies_and_public_config_publish_both(self):
        for path in ('src/App.tsx', 'src/assets/icon.png', 'package-lock.json', 'app.config.js', 'ios/release-config.sh'):
            for platform in ('android', 'ios'):
                self.assertTrue(app.plan(['app/app-dev/' + path], platform)['publish'])

    def test_workflow_changes_validate_android_without_automatic_publication(self):
        for path in ('.github/workflows/app-android-ci.yml', '.github/ci/posthog-sdk-config.py'):
            self.assertEqual(app.plan([path], 'android'), {'build': True, 'publish': False})
            self.assertFalse(app.plan([path], 'ios')['publish'])

    def test_deletions_and_mixed_inputs_keep_runtime_publication(self):
        self.assertTrue(app.plan(['app/app-dev/src/App.tsx', 'app/app-dev/README.md'], 'android')['publish'])
        self.assertEqual(app.plan([], 'android'), {'build': False, 'publish': False})


if __name__ == '__main__':
    unittest.main()
