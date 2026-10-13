#!/usr/bin/env python3
"""컨테이너 생성 응답 실패 시에도 소유한 자원만 정리하는지 검증한다."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('isolated', Path(__file__).with_name('isolated-core.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IsolatedTests(unittest.TestCase):
    def test_requires_explicit_mode_before_accessing_docker(self):
        with patch.dict(module.os.environ, {}, clear=True), patch.object(module, 'info') as inspect:
            with self.assertRaisesRegex(RuntimeError, '명시'):
                module.main()
            inspect.assert_not_called()

    def failed_start(self, owned):
        calls = []
        prefix = 'gromo-smoke-2285-1234567890'
        source = {'Config': {'Image': 'test-image', 'Env': []}, 'NetworkSettings': {'Networks': {'test-network': {}}}}
        def info(name):
            if name.startswith('phone-'):
                return source
            return {'Config': {'Labels': {'gromo.smoke.owner': prefix if owned else 'other-owner'}}}
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('docker', 'run'):
                raise RuntimeError('CLI response failed after creation')
            if args[:3] == ('docker', 'ps', '-aq'):
                return 'created-container'
            return ''
        with patch.dict(module.os.environ, {'SMOKE_ALLOW_ISOLATED_TEST': '1', 'RESULTS_FILE': '/tmp/test.tsv'}), patch.object(module, 'info', side_effect=info), patch.object(module, 'cmd', side_effect=command), patch.object(module.uuid, 'uuid4', return_value=Mock(hex='1234567890xxxx')), patch.object(module.signal, 'signal'):
            with self.assertRaises(RuntimeError):
                module.main()
        return calls

    def test_created_container_is_cleaned_when_start_response_fails(self):
        calls = self.failed_start(True)
        self.assertTrue(any(c[:3] == ('docker', 'rm', '-f') for c in calls))

    def test_cleanup_never_removes_another_owner(self):
        calls = self.failed_start(False)
        self.assertFalse(any(c[:2] == ('docker', 'rm') for c in calls))


if __name__ == '__main__':
    unittest.main()
