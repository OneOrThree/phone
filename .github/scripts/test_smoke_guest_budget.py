#!/usr/bin/env python3
"""연속 스모크가 같은 제한 창을 소비하지 않으며 실패 요청도 대기에 포함한다."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import os
import subprocess
import time

spec = importlib.util.spec_from_file_location('budget', Path(__file__).parents[2] / 'smoke/server/guest-budget.py')
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'requests/last'
        self.path.parent.mkdir()

    def test_first_execution_and_expired_window_do_not_wait(self):
        self.assertEqual(budget.remaining(self.path, 10000), 0)
        self.path.write_text('100')
        self.assertEqual(budget.remaining(self.path, 10000), 0)

    def test_three_runs_are_separated_from_every_previous_last_request(self):
        now = [10000.0]
        for _ in range(3):
            last = now[0]
            self.path.write_text(str(int(last)))
            result = budget.wait_for_budget(self.path, lambda: now[0], lambda n: now.__setitem__(0, now[0] + n))
            self.assertEqual(result, 0)
            self.assertGreater(now[0] - last, 3600)

    def test_malformed_marker_fails_closed(self):
        self.path.write_text('invalid')
        with self.assertRaises(RuntimeError):
            budget.remaining(self.path, 10000)

    def test_future_marker_cannot_wait_forever(self):
        self.path.write_text('999999')
        now = [10000.0]
        with self.assertRaisesRegex(RuntimeError, '시간 초과'):
            budget.wait_for_budget(self.path, lambda: now[0], lambda n: now.__setitem__(0, now[0] + n))

    def test_rejected_guest_request_records_timestamp_but_reads_do_not(self):
        bindir = Path(self.temp.name) / 'bin'
        bindir.mkdir()
        curl = bindir / 'curl'
        curl.write_text("#!/bin/sh\nprintf '429 0.01'\n")
        curl.chmod(0o700)
        env = {**os.environ, 'PATH': str(bindir) + os.pathsep + os.environ['PATH'],
               'BASE_URL': 'http://mock.test', 'SMOKE_GUEST_LAST_REQUEST_FILE': str(self.path),
               'RESULTS_FILE': self.temp.name + '/results.tsv',
               'LIB_PATH': str(Path(__file__).parents[2] / 'smoke/server/lib.sh')}
        script = '''source "$LIB_PATH"
smoke_init
trap 'rm -rf "$SMOKE_TMP_DIR"' EXIT
smoke_request POST /auth/sessions/guest '' '' test-device
test "$SMOKE_HTTP_CODE" = 429
'''
        before = int(time.time())
        subprocess.run(['bash', '-eu', '-c', script], env=env, check=True, capture_output=True)
        self.assertGreaterEqual(int(self.path.read_text()), before)
        self.path.write_text('100')
        subprocess.run(['bash', '-eu', '-c', script.replace('POST /auth/sessions/guest', 'GET /health')],
                       env=env, check=True, capture_output=True)
        self.assertEqual(self.path.read_text(), '100')


if __name__ == '__main__':
    unittest.main()
