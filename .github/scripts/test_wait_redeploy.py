import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('redeploy', Path(__file__).with_name('wait-redeploy.py'))
redeploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(redeploy)


class RedeployTests(unittest.TestCase):
    def test_wrong_job_or_pending_or_skipped_cannot_report_success(self):
        self.assertEqual(redeploy.outcome([{'name': 'other', 'status': 'completed', 'conclusion': 'success'}], 'deploy'), 'waiting')
        self.assertEqual(redeploy.outcome([{'name': 'deploy', 'status': 'in_progress'}], 'deploy'), 'waiting')
        for result in ('skipped', 'failure', 'cancelled'):
            self.assertEqual(redeploy.outcome([{'name': 'deploy', 'status': 'completed', 'conclusion': result}], 'deploy'), 'failure')

    def test_waits_for_new_attempt_and_exact_job(self):
        clock = [0]
        def read(path):
            if path.endswith('/actions/runs/42'):
                return {'run_attempt': 1 if clock[0] == 0 else 2}
            self.assertIn('/attempts/2/jobs?', path)
            return {'jobs': [{'name': 'deploy', 'status': 'completed', 'conclusion': 'success'}]}
        with patch.object(redeploy.time, 'monotonic', lambda: clock[0]), \
             patch.object(redeploy.time, 'sleep', lambda n: clock.__setitem__(0, clock[0] + n)):
            self.assertEqual(redeploy.wait('42', 1, 'deploy', read), ('success', 2))
            self.assertGreater(clock[0], 0)
