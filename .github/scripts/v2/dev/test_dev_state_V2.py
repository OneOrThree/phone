import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('dev_state', Path(__file__).with_name('dev-state-V2.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class StateTest(unittest.TestCase):
    def test_missing_object_is_initial_state(self):
        with mock.patch.object(m, 'run', side_effect=[SimpleNamespace(returncode=0), SimpleNamespace(returncode=1, stderr='not found: 404.')]):
            self.assertEqual(m.read(), (None, '0'))

    def test_permissions_failure_is_not_initial_state(self):
        with mock.patch.object(m, 'run', side_effect=[SimpleNamespace(returncode=0), SimpleNamespace(returncode=1, stderr='403 permission denied')]):
            with self.assertRaises(RuntimeError): m.read()

    def test_stale_generation_fails(self):
        state={'environment':'dev-v2','project':'oneorthree2'}
        with mock.patch.object(m, 'run', return_value=SimpleNamespace(returncode=1)) as call:
            with self.assertRaises(RuntimeError): m.write(state, '123')
            self.assertIn('--if-generation-match=123', call.call_args.args[0])

    def test_prod_state_is_rejected(self):
        with self.assertRaises(ValueError): m.write({'environment':'prod','project':'oneorthree2'}, '0')
