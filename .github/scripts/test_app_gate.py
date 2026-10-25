import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('app_gate', Path(__file__).with_name('wait-app-checks.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40


class GateTests(unittest.TestCase):
    def test_js_only_does_not_wait_for_absent_native_run(self):
        self.assertEqual(gate.required_workflows('android', ['app/app-dev/src/A.ts'], ['app/app-dev/android/**']), {'app-lint.yml'})
        self.assertEqual(gate.required_workflows('android', ['app/app-dev/android/A.kt'], ['app/app-dev/android/**']), {'app-lint.yml', 'app-android-build.yml'})

    def test_old_sha_pr_and_skipped_check_cannot_authorize_upload(self):
        run = {'path': '.github/workflows/app-lint.yml', 'id': 1, 'head_sha': SHA,
               'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}
        self.assertEqual(gate.checks_verdict({'app-lint.yml'}, [run], SHA)[0], 'success')
        for changes in ({'head_sha': 'b' * 40}, {'event': 'pull_request'}, {'head_branch': 'other'}):
            self.assertEqual(gate.checks_verdict({'app-lint.yml'}, [{**run, **changes}], SHA)[0], 'waiting')
        for result in ('skipped', 'failure', 'cancelled'):
            self.assertEqual(gate.checks_verdict({'app-lint.yml'}, [{**run, 'conclusion': result}], SHA)[0], 'failure')

    def test_pending_new_attempt_overrides_previous_success(self):
        base = {'path': '.github/workflows/app-lint.yml', 'id': 1, 'head_sha': SHA,
                'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}
        self.assertEqual(gate.checks_verdict({'app-lint.yml'}, [base, {**base, 'run_attempt': 2, 'status': 'in_progress'}], SHA)[0], 'waiting')

    def test_android_ci_helper_changes_schedule_required_lint(self):
        import yaml
        root = Path(__file__).parents[1] / 'workflows'
        android = yaml.load((root / 'app-android-ci.yml').read_text(), Loader=yaml.BaseLoader)
        lint = yaml.load((root / 'app-lint.yml').read_text(), Loader=yaml.BaseLoader)
        for event in ('push', 'pull_request'):
            for path in ('.github/ci/android-artifact.py', '.github/ci/posthog-sdk-config.py',
                         '.github/ci/android-version-code.gradle'):
                with self.subTest(event=event, path=path):
                    self.assertTrue(gate.github.matches_paths([path], android['on'][event]['paths']))
                    self.assertEqual(gate.required_workflows('android', [path], []), {'app-lint.yml'})
                    self.assertTrue(gate.github.matches_paths([path], lint['on'][event]['paths']))
            self.assertFalse(gate.github.matches_paths(['server/data-api/build.gradle'], lint['on'][event]['paths']))
