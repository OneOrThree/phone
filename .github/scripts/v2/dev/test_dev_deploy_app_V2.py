import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('app_deploy', Path(__file__).with_name('dev-deploy-app-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class DeployAppTest(unittest.TestCase):
    def setUp(self):
        self.rev = 'a'*40
        self.uri = m.BUCKET + '/infra/' + self.rev + '-12-1/manifest.json'
        self.files = {'dev/runtime-v2/app-compose.yml':('app-compose.yml', b'compose'),
                      'dev/runtime-v2/nginx.conf.template':('nginx.conf.template', b'config')}
        self.manifest = {'environment':'dev-v2','repository':'OneOrThree/cattus-infra',
                         'revision':self.rev,'release_id':self.rev+'-12-1',
                         'files':{name:{'uri':self.uri.rsplit('/',1)[0]+'/'+base,
                                        'sha256':hashlib.sha256(content).hexdigest()}
                                  for name,(base,content) in self.files.items()}}

    def fetch(self, args, **kwargs):
        uri = args[-1]
        if uri == self.uri: return json.dumps(self.manifest).encode()
        for base,content in self.files.values():
            if uri.endswith('/'+base): return content
        raise AssertionError(uri)

    def test_infra_requires_matching_digest_and_fixed_location(self):
        with patch.object(m.runtime,'command',side_effect=self.fetch):
            self.assertEqual(m.infra_runtime(self.uri)[0],self.rev)
            self.manifest['files']['dev/runtime-v2/app-compose.yml']['sha256'] = '0'*64
            with self.assertRaises(ValueError): m.infra_runtime(self.uri)
            with self.assertRaises(ValueError): m.infra_runtime('gs://another-bucket/manifest.json')

    def test_runtime_gate_blocks_missing_and_changed_predecessors(self):
        original = m.state_store.URI
        config = {'hosts':{'data':{'id':'1'},'redis':{'id':'2'}}}
        with patch.object(m.state_store,'read',return_value=(None,'0')):
            with self.assertRaises(ValueError): m.verify_runtime_prerequisites(self.rev,config)
            self.assertEqual(m.state_store.URI, original)

    def test_package_only_accepts_expected_files(self):
        with self.assertRaises(ValueError): m.package({'../escape':b'data'})

    def test_generated_env_values_are_registered_before_any_ssh(self):
        source = Path(__file__).with_name('dev-deploy-app-V2.py').read_text()
        self.assertLess(source.index('runtime.remember_env_secrets(envs)'), source.index('runtime.ssh('))


if __name__ == '__main__': unittest.main()
