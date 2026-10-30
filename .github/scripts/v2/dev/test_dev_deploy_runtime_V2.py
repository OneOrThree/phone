import importlib.util
from pathlib import Path
import unittest
from unittest import mock

spec=importlib.util.spec_from_file_location('dev_deploy',Path(__file__).with_name('dev-deploy-runtime-V2.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DeployTest(unittest.TestCase):
    def test_first_ssh_key_output_is_not_mixed_into_result(self):
        outputs=[b'Generating public/private rsa key pair.\n',b'redis:7.4.11-alpine\n',b'second\n']
        m.ssh_key_ready=False
        with mock.patch.object(m,'command',side_effect=outputs) as run:
            self.assertEqual(m.ssh('vm','probe'),b'redis:7.4.11-alpine\n')
            self.assertEqual(m.ssh('vm','next'),b'second\n')
        self.assertEqual([call.args[0][-1] for call in run.call_args_list],['true','probe','next'])
        # 러너마다 새 키. 만료 없으면 OS Login 프로필에 누적.
        self.assertTrue(all('--ssh-key-expire-after=1h' in call.args[0] for call in run.call_args_list))

    def test_redis_first_deployment_requires_both(self):
        self.assertEqual(m.redis_changes(None, {}), {'shared','business'})

    def test_redis_individual_and_shared_changes(self):
        shared='server/scripts/v2/dev/redis/shared.yml'
        business='server/scripts/v2/dev/redis/business.yml'
        common='server/scripts/v2/dev/common/apply.sh'
        before={shared:'a',business:'b',common:'c'}
        self.assertEqual(m.redis_changes(before,{**before,shared:'x'}), {'shared'})
        self.assertEqual(m.redis_changes(before,{**before,business:'x'}), {'business'})
        self.assertEqual(m.redis_changes(before,{**before,common:'x'}), {'shared','business'})
        self.assertEqual(m.redis_changes(before,{shared:'a',common:'c'}), {'business'})

    def test_wrong_manifest_uri_is_rejected(self):
        with self.assertRaises(ValueError): m.validate_manifest('kafka','gs://prod/manifest.json',{},b'')

    def test_wrong_archive_checksum_is_rejected(self):
        release='a'*40+'-1-1'; uri=m.BUCKET+'/releases/kafka/'+release+'/manifest.json'
        manifest={'release_id':release,'environment':'dev-v2','project':'oneorthree2','role':'kafka',
                  'revision':'a'*40,'archive_uri':uri.rsplit('/',1)[0]+'/runtime.tar','archive_sha256':'0'*64}
        with self.assertRaises(ValueError): m.validate_manifest('kafka',uri,manifest,b'not a tar')
