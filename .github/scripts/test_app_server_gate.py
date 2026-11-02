import importlib.util
import io
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('app_server_gate', Path(__file__).with_name('app-server-gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SHA = 'a' * 40


TAG = 'catus-v2.0.4-V2'


def api(tag=TAG):
    calls = []

    def fetch(url, accept=None):
        calls.append((url, accept))
        return {'schemaVersion': 1, 'label': 'app', 'message': tag}
    fetch.calls = calls
    return fetch


def failing_api(url, accept=None):
    raise gate.GateError('조회 실패')


def git_with(files):
    calls = []

    def git(*args):
        calls.append(args)
        if args[0] == 'rev-parse':
            return SHA + '\n'
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

    def test_resolves_recorded_tag_to_commit_then_three_dot_diff(self):
        git, fetch = git_with([]), api()
        code, out, _ = run(fetch=fetch, git=git)
        self.assertEqual(code, 0)
        self.assertEqual(fetch.calls, [(gate.RECORD_URL, gate.RAW)])
        self.assertIn('ref=deployment-status', gate.RECORD_URL)
        self.assertEqual(git.calls[0], ('fetch', '--quiet', 'origin', f'refs/tags/{TAG}:refs/tags/{TAG}'))
        self.assertEqual(git.calls[1], ('rev-parse', '--verify', f'{TAG}^{{commit}}'))
        self.assertEqual(git.calls[2], ('diff', '--name-only', '--no-renames', f'{SHA}...HEAD'))
        self.assertNotIn(('fetch', '--quiet', 'origin', 'release'), git.calls)
        self.assertIn(TAG, out)

    def test_older_tag_deployed_still_blocks_newer_server_changes(self):
        # 기록 태그(이전 배포)가 release 끝보다 뒤라, 그 뒤의 서버 변경이 그대로 잡힌다.
        git = git_with(['server/data-api/src/main/java/New.java'])
        code, _, err = run(fetch=api('catus-v2.0.2-V2'), git=git)
        self.assertEqual(code, 1)
        self.assertIn('catus-v2.0.2-V2', err)
        self.assertEqual(git.calls[1], ('rev-parse', '--verify', 'catus-v2.0.2-V2^{commit}'))

    def test_malformed_tag_blocks_without_git(self):
        for bad in ('main', 'catus-v2.0.4', 'catus-v2.0.4-V2\n--evil', '', None, 5):
            git = git_with([])
            code, _, err = run(fetch=api(bad), git=git)
            self.assertEqual(code, 1, bad)
            self.assertEqual(git.calls, [])
            self.assertIn('ALLOW_SERVER_GAP', err)

    def test_tag_resolution_failure_blocks_and_names_tag(self):
        def git(*args):
            if args[0] == 'rev-parse':
                raise gate.GateError('unknown revision')
            return ''
        code, _, err = run(git=git)
        self.assertEqual(code, 1)
        self.assertIn(TAG, err)
        code, _, err = run(git=lambda *a: 'garbage' if a[0] == 'rev-parse' else '')
        self.assertEqual(code, 1)

    def test_api_failure_blocks(self):
        code, _, err = run(fetch=failing_api)
        self.assertEqual(code, 1)
        self.assertIn('ALLOW_SERVER_GAP', err)
        for bad in ({}, None, {'message': '--upload-pack=x'}):
            self.assertEqual(run(fetch=lambda url, accept=None, bad=bad: bad)[0], 1)

    def test_file_renamed_out_of_server_is_blocked(self):
        # --no-renames 이면 git 은 이름 변경을 옛 경로 삭제 + 새 경로 추가로 낸다.
        code, _, err = run(git=git_with(['server/data-api/src/main/java/Old.java', 'docs/Old.java']))
        self.assertEqual(code, 1)
        self.assertIn('server/data-api/src/main/java/Old.java', err)

    def test_git_timeout_blocks(self):
        from unittest import mock
        import subprocess
        with mock.patch.object(gate.subprocess, 'run', side_effect=subprocess.TimeoutExpired('git', 60)) as run_mock:
            with self.assertRaises(gate.GateError):
                gate.run_git('fetch')
            self.assertEqual(run_mock.call_args.kwargs['timeout'], 60)

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
