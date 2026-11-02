import importlib.util
import io
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('app_server_gate', Path(__file__).with_name('app-server-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SHA = 'a' * 40


def api(sha=SHA):
    return lambda url: {'workflow_runs': [{'head_sha': sha}]}


def failing_api(url):
    raise gate.GateError('조회 실패')


def git_with(files):
    calls = []

    def git(*args):
        calls.append(args)
        return '\n'.join(files) if args[0] == 'diff' else ''
    git.calls = calls
    return git


def failing_git(*args):
    raise gate.GateError('git 실패')


def run(env=None, fetch=None, git=None):
    out, err = io.StringIO(), io.StringIO()
    code = gate.main(env if env is not None else {}, fetch or api(), git or git_with([]), out, err)
    return code, out.getvalue(), err.getvalue()


class GateTest(unittest.TestCase):
    def test_server_runtime_change_blocks(self):
        code, _, err = run(git=git_with(['docs/a.md', 'server/data-api/src/main/java/A.java']))
        self.assertEqual(code, 1)
        self.assertIn('server/data-api/src/main/java/A.java', err)
        self.assertIn('ALLOW_SERVER_GAP', err)

    def test_blocked_list_is_capped_at_20(self):
        _, _, err = run(git=git_with([f'server/realtime/src/main/A{i}.java' for i in range(25)]))
        self.assertEqual(err.count('server/realtime/src/main/'), 20)
        self.assertIn('외 5개', err)

    def test_tests_docs_and_observability_pass(self):
        code, out, _ = run(git=git_with(['server/data-api/src/test/java/ATest.java', 'server/observability/a.yml',
                                         'docs/a.md', 'app/app-dev/App.tsx']))
        self.assertEqual(code, 0)
        self.assertIn('aaaaaaa', out)

    def test_three_dot_diff_against_release_fetch(self):
        git = git_with([])
        run(git=git)
        self.assertEqual(git.calls[0], ('fetch', '--quiet', 'origin', 'release'))
        self.assertEqual(git.calls[1], ('diff', '--name-only', f'{SHA}...HEAD'))

    def test_api_failure_blocks(self):
        code, _, err = run(fetch=failing_api)
        self.assertEqual(code, 1)
        self.assertIn('ALLOW_SERVER_GAP', err)
        for bad in ({}, {'workflow_runs': []}, {'workflow_runs': [{'head_sha': '--upload-pack=x'}]}):
            self.assertEqual(run(fetch=lambda url, bad=bad: bad)[0], 1)

    def test_git_failure_blocks(self):
        self.assertEqual(run(git=failing_git)[0], 1)

    def test_allow_server_gap_passes_with_reason_and_skips_lookup(self):
        code, out, _ = run(env={'ALLOW_SERVER_GAP': '서버 변경 없음 확인'}, fetch=failing_api, git=failing_git)
        self.assertEqual(code, 0)
        self.assertIn('서버 변경 없음 확인', out)

    def test_blank_allow_value_is_ignored(self):
        for blank in ('', '  ', '\t'):
            self.assertEqual(run(env={'ALLOW_SERVER_GAP': blank}, fetch=failing_api)[0], 1)


if __name__ == '__main__':
    unittest.main()
