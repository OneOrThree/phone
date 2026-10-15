#!/usr/bin/env python3
"""Redis 장애·인증 노출·정리 실패가 성공으로 기록되지 않음을 검증한다."""
import importlib.util
import os
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('internal', os.path.join(os.path.dirname(__file__), '..', 'internal.py'))
internal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(internal)


class InternalTests(unittest.TestCase):
    def test_health_requires_every_service_to_be_running_and_healthy(self):
        with patch.object(internal, 'inspect', return_value={'State': {'Running': True, 'Health': {'Status': 'healthy'}}}):
            self.assertIn('5개', internal.check_health())
        for state in ({'Running': False, 'Health': {'Status': 'healthy'}},
                      {'Running': True, 'Restarting': True, 'Health': {'Status': 'healthy'}},
                      {'Running': True, 'Health': {'Status': 'unhealthy'}}):
            with patch.object(internal, 'inspect', return_value={'State': state}):
                with self.assertRaises(RuntimeError):
                    internal.check_health()

    def redis(self, responses, commands):
        def run(argv, **kwargs):
            commands.append((argv, kwargs))
            out = responses.pop(0)
            if out is None:
                raise subprocess.TimeoutExpired(argv, 15)
            if out == 'VALUE':
                out = commands[0][1]['input'].split()[2]
            return subprocess.CompletedProcess(argv, 0, out, '')
        return run

    def test_credentials_not_in_argv_and_key_always_cleaned(self):
        calls = []
        with patch.object(internal, 'inspect', return_value={'Config': {'Env': ['BUSINESS_REDIS_USERNAME=business', 'BUSINESS_REDIS_PASSWORD=test-private-password']}}), patch.object(internal.subprocess, 'run', side_effect=self.redis(['OK', 'VALUE', '1', '', 'OK', 'VALUE', '1', '', '0'], calls)), patch.object(internal.time, 'sleep') as sleep:
            internal.redis_probe(True)
        self.assertNotIn('test-private-password', ' '.join(calls[0][0]))
        self.assertEqual(calls[0][1]['env']['REDISCLI_AUTH'], 'test-private-password')
        self.assertIn('cache:business:smoke:', calls[0][1]['input'])
        self.assertTrue(calls[-1][1]['input'].startswith('DEL '))
        self.assertTrue(any(call[1]['input'].startswith('EXPIRE ') for call in calls))
        self.assertFalse(any(call[1]['input'].startswith(('TTL ', 'PTTL ')) for call in calls))
        sleep.assert_called_once_with(1.2)

    def test_business_key_that_does_not_expire_fails_and_is_cleaned(self):
        calls = []
        with patch.object(internal, 'inspect', return_value={}), patch.object(internal.subprocess, 'run', side_effect=self.redis(['OK', 'VALUE', '1', 'VALUE', '1'], calls)), patch.object(internal.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '만료 실패'):
                internal.redis_probe(True)
        self.assertTrue(calls[-1][1]['input'].startswith('DEL '))

    def test_acl_error_and_timeout_fail_without_exposing_raw_error(self):
        for output in ['NOPERM private diagnostic', None]:
            calls = []
            with patch.object(internal, 'inspect', return_value={}), patch.object(internal.subprocess, 'run', side_effect=self.redis([output, '0'], calls)):
                with self.assertRaises(RuntimeError) as error:
                    internal.redis_probe()
            self.assertNotIn('private', str(error.exception))
            self.assertTrue(calls[-1][1]['input'].startswith('DEL '))

    def test_previous_run_rows_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'nested' / 'results.tsv'
            path.parent.mkdir()
            path.write_text('id\tstatus\thttp_code\tms\treason\nSMOKE-SERVER-008\tPASS\t-\t0\tstale\n')
            with patch.dict(os.environ, {'RESULTS_FILE': str(path), 'SMOKE_APPEND_RESULTS': '0'}), patch.object(internal, 'check_health', return_value='health'), patch.object(internal, 'redis_probe', return_value='redis'), patch('builtins.print'):
                self.assertEqual(internal.main(), 0)
            result = path.read_text()
            self.assertNotIn('stale', result)
            self.assertEqual(result.count('SMOKE-SERVER-008'), 1)

    def test_cleanup_failure_is_a_failure_even_after_success(self):
        calls = []
        with patch.object(internal, 'inspect', return_value={}), patch.object(internal.subprocess, 'run', side_effect=self.redis(['OK', 'VALUE', '60', '1', '', 'NOPERM hidden'], calls)):
            with self.assertRaisesRegex(RuntimeError, '정리 실패'):
                internal.redis_probe()


if __name__ == '__main__':
    unittest.main()
