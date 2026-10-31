import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('manifest', Path(__file__).with_name('dev-app-manifest-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.rev = 'a' * 40
        self.infra = 'b' * 40
        self.source = {service: 'c' * 64 for service in m.planner.SERVICES}
        self.artifacts = {service: {'service': service, 'revision': self.rev,
            'image': f'asia-northeast3-docker.pkg.dev/oneorthree2/{service}/{service}@sha256:' + 'd' * 64}
            for service in m.planner.SERVICES}

    def make(self, source=None, previous=None, artifacts=None):
        return m.candidate(source or self.source, previous, self.rev, self.infra,
                           self.artifacts if artifacts is None else artifacts, self.rev + '-10-1')

    def test_initial_requires_all_images_and_correct_revision(self):
        release = self.make()
        self.assertEqual(set(release['images']), m.planner.SERVICES)
        bad = dict(self.artifacts)
        bad['realtime'] = {**bad['realtime'], 'revision': 'e' * 40}
        with self.assertRaises(ValueError): self.make(artifacts=bad)
        with self.assertRaises(ValueError): self.make(artifacts={})

    def test_only_changed_satellite_is_replaced(self):
        previous = self.make()
        source = dict(self.source, notification='f' * 64)
        result = self.make(source, previous, {'notification': self.artifacts['notification']})
        self.assertEqual(result['build_services'], ['notification'])
        self.assertEqual(result['images']['realtime'], previous['images']['realtime'])

    def test_core_changes_require_both_images(self):
        previous = self.make()
        source = dict(self.source, realtime='f' * 64)
        with self.assertRaises(ValueError):
            self.make(source, previous, {'realtime': self.artifacts['realtime']})


if __name__ == '__main__': unittest.main()
