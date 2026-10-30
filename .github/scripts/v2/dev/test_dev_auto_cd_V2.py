import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('auto_cd', Path(__file__).with_name('dev-auto-cd-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def run(number, status='completed', conclusion='success', attempt=1):
    return {'id': number * 10, 'run_number': number, 'run_attempt': attempt, 'status': status, 'conclusion': conclusion}


class AutoCdTest(unittest.TestCase):
    def test_ci_status(self):
        self.assertEqual(m.ci_status([]), ('missing', None))
        self.assertEqual(m.ci_status([run(1), run(2, 'in_progress', None)]), ('running', None))
        self.assertEqual(m.ci_status([run(1, conclusion='failure'), run(2)]), ('success', 20))
        self.assertEqual(m.ci_status([run(1), run(2, conclusion='failure')]), ('failed', None))
        self.assertEqual(m.ci_status([run(1, conclusion='cancelled')]), ('missing', None))

    def test_manifests_are_newest_first_and_ignore_other_paths(self):
        base = m.BUCKET + '/releases/kafka/'
        pattern = m.re.escape(base) + r'[0-9a-f]{40}-[0-9]+-[0-9]+/manifest\.json'
        old, new = base + 'a'*40 + '-1-1/manifest.json', base + 'b'*40 + '-2-1/manifest.json'
        lines = f'10 2026-10-30T01:00:00Z {old}\n10 2026-10-30T02:00:00Z {new}\n1 2026-10-30T03:00:00Z {base}x\nTOTAL: 3\n'
        self.assertEqual(m.manifests(lines, pattern), [new, old])
        self.assertEqual(m.manifests('', pattern), [])

    def test_manifest_skips_newest_when_not_ancestor(self):
        old, new = 'a'*40, 'b'*40
        base = m.BUCKET + '/releases/kafka/'
        lines = f'1 2026-10-30T01:00:00Z {base}{old}-1-1/manifest.json\n1 2026-10-30T02:00:00Z {base}{new}-2-1/manifest.json\n'
        with mock.patch.object(m, 'listing', return_value=lines), \
             mock.patch.object(m, 'is_ancestor', side_effect=lambda before, after: before == old), \
             mock.patch.object(m, 'same_runtime', return_value=True):
            self.assertIn(old, m.runtime_manifest('kafka', 'c'*40))

    def test_listing_separates_empty_from_failure(self):
        result = mock.Mock(returncode=1, stdout='', stderr='One or more URLs matched no objects.')
        with mock.patch.object(m.subprocess, 'run', return_value=result):
            self.assertEqual(m.listing('gs://x'), '')
        result.stderr = 'permission denied'
        with mock.patch.object(m.subprocess, 'run', return_value=result):
            with self.assertRaises(RuntimeError): m.listing('gs://x')

    def runtimes(self, status, uri=None):
        state = mock.Mock()
        state.read.return_value = (None, '0')
        with mock.patch.object(m, 'runtime_manifest', return_value=uri), \
             mock.patch.object(m, 'ci_for', return_value=(status, None)), \
             mock.patch.object(m, 'dispatch') as dispatch, mock.patch.object(m, 'deploy') as deploy:
            return m.deploy_runtimes(state, 'c'*40), dispatch, deploy

    def test_missing_ci_dispatches_and_running_waits(self):
        ready, dispatch, _ = self.runtimes('missing')
        self.assertFalse(ready)
        self.assertEqual(dispatch.call_count, 3)
        ready, dispatch, _ = self.runtimes('running')
        self.assertFalse(ready)
        dispatch.assert_not_called()

    def test_success_without_manifest_fails_instead_of_looping(self):
        with self.assertRaises(RuntimeError): self.runtimes('success')

    def test_runtimes_deploy_in_order(self):
        ready, _, deploy = self.runtimes('success', 'gs://uri')
        self.assertTrue(ready)
        self.assertEqual([call.args[0][2] for call in deploy.call_args_list], list(m.RUNTIMES))


if __name__ == '__main__': unittest.main()
