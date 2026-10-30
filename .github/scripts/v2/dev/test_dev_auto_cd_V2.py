import importlib.util
from pathlib import Path
import unittest

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

    def test_newest_manifest_ignores_other_paths(self):
        base = m.BUCKET + '/releases/kafka/'
        pattern = m.re.escape(base) + r'[0-9a-f]{40}-[0-9]+-[0-9]+/manifest\.json'
        old, new = base + 'a'*40 + '-1-1/manifest.json', base + 'b'*40 + '-2-1/manifest.json'
        lines = f'10 2026-10-30T01:00:00Z {old}\n10 2026-10-30T02:00:00Z {new}\n1 2026-10-30T03:00:00Z {base}x\nTOTAL: 3\n'
        self.assertEqual(m.newest_manifest(lines, pattern), new)
        self.assertIsNone(m.newest_manifest('', pattern))


if __name__ == '__main__': unittest.main()
