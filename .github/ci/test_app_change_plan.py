"""조사에서 확인한 교차 플랫폼 게시·테스트 전용 게시 재발을 막는다."""
import importlib.util
from pathlib import Path
import unittest
import json
import os
import tempfile
from unittest.mock import patch

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

    def test_latest_test_push_keeps_unpublished_runtime_change(self):
        event = {'before': 'b' * 40, 'after': 'c' * 40}
        changed = b'app/app-dev/src/App.tsx\0app/app-dev/src/App.test.tsx\0'
        with patch.object(app, 'published_revision', return_value='a' * 40), \
             patch.object(app.subprocess, 'check_output', return_value=changed) as git:
            self.assertTrue(app.plan(app.changed_paths(event, 'push', 'android'), 'android')['publish'])
        self.assertIn('a' * 40 + '..' + 'c' * 40, git.call_args.args[0])

    def test_old_workflow_changes_do_not_rebuild_aab_for_a_new_test_only_push(self):
        with patch.object(app, 'changed_paths', side_effect=[['app/app-dev/src/A.test.ts'],
                ['.github/workflows/app-android-ci.yml', 'app/app-dev/src/A.test.ts']]):
            self.assertEqual(app.push_plan({}, 'android'), {'build': False, 'publish': False})
        with patch.object(app, 'changed_paths', side_effect=[['app/app-dev/src/A.test.ts'],
                ['app/app-dev/src/App.tsx', 'app/app-dev/src/A.test.ts']]):
            self.assertEqual(app.push_plan({}, 'android'), {'build': True, 'publish': True})

    def test_aab_only_success_does_not_advance_publication_baseline(self):
        run = {'id': 1, 'head_branch': 'main', 'event': 'push', 'head_repository': {'id': 7},
               'conclusion': 'success', 'head_sha': 'a' * 40}
        with patch.dict(os.environ, {'GITHUB_REPOSITORY_ID': '7'}), \
             patch.object(app, 'api', side_effect=lambda path: {'artifacts': []} if path.startswith('/actions/artifacts?') else {'workflow_runs': [run]}), \
             patch.object(app, 'publication_record', return_value=None), \
             patch.object(app, 'job_steps', return_value=[{'name': 'AAB 빌드', 'conclusion': 'success'}]), \
             self.assertRaisesRegex(ValueError, '게시 기준'):
            app.published_revision('android', 'c' * 40)

    def test_real_legacy_upload_can_initialize_baseline(self):
        run = {'id': 1, 'head_branch': 'main', 'event': 'push', 'head_repository': {'id': 7},
               'conclusion': 'success', 'head_sha': 'a' * 40}
        for platform, step in [('android', '업로드 확인 (internal 트랙 재조회)'), ('ios', 'dev TestFlight 빌드·업로드')]:
            with patch.dict(os.environ, {'GITHUB_REPOSITORY_ID': '7'}), \
                 patch.object(app, 'api', side_effect=lambda path: {'artifacts': []} if path.startswith('/actions/artifacts?') else {'workflow_runs': [run]}), \
                 patch.object(app, 'publication_record', return_value=None), \
                 patch.object(app, 'job_steps', return_value=[{'name': step, 'conclusion': 'success'}]), \
                 patch.object(app.subprocess, 'run') as git:
                git.return_value.returncode = 0
                self.assertEqual(app.published_revision(platform, 'c' * 40), 'a' * 40)

    def test_android_cd_uses_recorded_source_not_workflow_run_head(self):
        run = {'id': 1, 'head_branch': 'main', 'event': 'workflow_run', 'head_repository': {'id': 7},
               'conclusion': 'success', 'head_sha': 'b' * 40}
        with patch.dict(os.environ, {'GITHUB_REPOSITORY_ID': '7'}), \
             patch.object(app, 'api', side_effect=lambda path: {'artifacts': [{'id': 2, 'name': 'app-publication', 'expired': False, 'workflow_run': {'id': 1}}]} if path.startswith('/actions/artifacts?') else {**run, 'path': '.github/workflows/app-android-cd.yml'}), \
             patch.object(app, 'publication_record', return_value='a' * 40), \
             patch.object(app.subprocess, 'run') as git:
            git.return_value.returncode = 0
            self.assertEqual(app.published_revision('android', 'c' * 40), 'a' * 40)

    def test_publication_record_binds_platform_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / 'app-publication.json'
            with patch.dict(os.environ, {'GITHUB_SHA': 'b' * 40, 'PUBLISHED_REVISION': 'a' * 40}), \
                 patch.object(app, 'Path', return_value=record), \
                 patch('sys.argv', ['app-change-plan.py', '--platform', 'android', '--record']):
                app.main()
            self.assertEqual(json.loads(record.read_text()), {'revision': 'a' * 40, 'platform': 'android'})

    def test_deletions_and_mixed_inputs_keep_runtime_publication(self):
        self.assertTrue(app.plan(['app/app-dev/src/App.tsx', 'app/app-dev/README.md'], 'android')['publish'])
        self.assertEqual(app.plan([], 'android'), {'build': False, 'publish': False})


if __name__ == '__main__':
    unittest.main()
