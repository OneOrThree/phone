import json
import os
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


def config(role):
    env = dict(os.environ, HOST_PRIVATE_IP='10.30.0.9', KAFKA_HEALTHCHECK_FILE='/tmp/kafka-health',
               SHARED_ACL_FILE='/tmp/shared.acl', BUSINESS_ACL_FILE='/tmp/business.acl', POSTGRES_ENV_FILE='/dev/null')
    base = ROOT / 'server/scripts/runtime-dev-V2' / role
    files = [base / 'shared.yml', base / 'business.yml'] if role == 'redis' else [base / 'compose.yml']
    args = [arg for path in files for arg in ('-f', str(path))]
    return json.loads(subprocess.check_output(['docker', 'compose', *args, 'config', '--format', 'json'], env=env))


class RuntimeContractTest(unittest.TestCase):
    def test_kafka_is_kraft_and_private(self):
        service = config('kafka')['services']['kafka']
        self.assertEqual(service['environment']['KAFKA_PROCESS_ROLES'], 'broker,controller')
        self.assertEqual(service['environment']['KAFKA_DEFAULT_REPLICATION_FACTOR'], '1')
        self.assertEqual(service['ports'][0]['host_ip'], '10.30.0.9')
        self.assertNotIn('9093', [p['published'] for p in service['ports']])

    def test_postgres_uses_private_ip_and_separate_data_directory(self):
        service = config('postgres')['services']['postgres']
        self.assertEqual(service['ports'][0]['host_ip'], '10.30.0.9')
        self.assertEqual(service['volumes'][0]['source'], '/var/lib/catus-dev-v2/postgres')

    def test_both_redis_instances_persist_and_do_not_evict(self):
        services = config('redis')['services']
        self.assertEqual(set(services), {'shared', 'business'})
        for service in services.values():
            self.assertIn('noeviction', service['command'])
            self.assertEqual(service['command'][service['command'].index('--appendonly') + 1], 'yes')
            self.assertEqual(service['ports'][0]['host_ip'], '10.30.0.9')
        self.assertNotEqual(services['shared']['volumes'][0]['source'], services['business']['volumes'][0]['source'])


if __name__ == '__main__':
    unittest.main()
