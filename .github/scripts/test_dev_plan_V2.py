import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('dev_plan_v2', Path(__file__).with_name('dev-plan-V2.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PlannerTest(unittest.TestCase):
    def setUp(self):
        self.source = {name: 'a' * 64 for name in module.SERVICES}
        self.prior = {'environment': 'dev-v2', 'release_id': 'baseline', 'infra_revision': 'b' * 40,
                      'source_fingerprints': self.source.copy(),
                      'images': {name: f'asia-northeast3-docker.pkg.dev/oneorthree2/{name}/{name}@sha256:' + 'c' * 64
                                 for name in module.SERVICES}}

    def run_plan(self):
        return module.plan(self.source, self.prior, 'd' * 40, 'b' * 40)

    def test_business_change_only(self):
        self.source['business-api'] = 'e' * 64
        self.assertEqual(self.run_plan()['deploy_services'], ['business-api'])

    def test_data_and_realtime_deploy_together(self):
        self.source['data-api'] = 'e' * 64
        self.assertEqual(self.run_plan()['build_services'], ['data-api', 'realtime'])

    def test_config_change_deploys_all_without_rebuilding(self):
        result = module.plan(self.source, self.prior, 'd' * 40, 'f' * 40)
        self.assertEqual(result['build_services'], [])
        self.assertEqual(set(result['deploy_services']), module.SERVICES)

    def test_prod_or_other_registry_is_rejected(self):
        self.prior['images']['data-api'] = 'example.com/data-api@sha256:' + 'c' * 64
        with self.assertRaises(ValueError):
            self.run_plan()

    def test_first_deployment_builds_all(self):
        result = module.plan(self.source, None, 'd' * 40, 'b' * 40)
        self.assertEqual(set(result['build_services']), module.SERVICES)


if __name__ == '__main__':
    unittest.main()
