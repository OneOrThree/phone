import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('dev_env_v2', Path(__file__).with_name('dev-env-V2.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class EnvTest(unittest.TestCase):
    def setUp(self):
        keys = set(m.w.TRANSITION_KEYS)
        for values in m.w.SERVICE_REQUIRED_KEYS.values():
            keys.update(values)
        keys.update(('POSTGRES_USER', 'POSTGRES_PASSWORD', 'CHAT_DB_PASSWORD', 'REDIS_DATA_PASSWORD', 'REDIS_REALTIME_PASSWORD',
                     'SVC_TOKEN_REALTIME_TO_DATA', 'SVC_TOKEN_DATA_TO_REALTIME', 'SVC_TOKEN_BIZ_TO_REALTIME'))
        self.secret = {k: k.lower() for k in keys}
        self.secret.update(API_DB_URL='jdbc:postgresql://old:5432/data_db',
                           NOTI_DB_URL='jdbc:postgresql://old:5432/noti_db',
                           CHAT_DB_URL='jdbc:postgresql://old:5432/gromo_chat',
                           CHAT_DB_USERNAME='catus_realtime_v2',
                           SVC_TOKEN_CONSOLE_TO_NOTI='member-1:console-token',
                           BUSINESS_REDIS_LEGACY_HOST='old', BUSINESS_REDIS_LEGACY_PASSWORD='legacy')
        self.config = {'environment':'dev-v2', 'project':'oneorthree2', 'hosts': {
            role: {'name':f'catus-dev-v2-{role}', 'id':str(i), 'private_ip':f'10.30.0.{i}'}
            for i, role in enumerate(('app','data','redis'), 7)}}
        self.images = {service: f'asia-northeast3-docker.pkg.dev/oneorthree2/{service}/{service}@sha256:' + 'a'*64
                       for service in ('data-api', 'realtime', 'business-api', 'notification')}

    def test_replaces_old_addresses_and_splits_roles(self):
        result = m.generate(self.secret, self.config, self.images)
        self.assertIn("REDIS_HOST='10.30.0.9'", result['data-api'])
        self.assertIn("BUSINESS_REDIS_LEGACY_HOST='10.30.0.9'", result['business-api'])
        self.assertIn("BUSINESS_REDIS_LEGACY_PORT='6380'", result['business-api'])
        self.assertIn("BUSINESS_REDIS_LEGACY_USERNAME='business'", result['business-api'])
        self.assertIn("BUSINESS_REDIS_LEGACY_PASSWORD='business_redis_password'", result['business-api'])
        self.assertIn("jdbc:postgresql://10.30.0.8:5432/data_db", result['data-api'])
        self.assertIn("jdbc:postgresql://10.30.0.8:5432/gromo_chat", result['realtime'])
        self.assertIn("CHAT_DB_USERNAME='catus_realtime_v2'", result['realtime'])
        self.assertIn('https://oneorthree-v2.dev.mooo.com', result['realtime'])
        self.assertNotIn('old:5432', ''.join(result.values()))
        self.assertNotIn('JWT_SECRET=', result['notification'])

    def test_realtime_db_password_is_separate_from_admin(self):
        result = m.generate(self.secret, self.config, self.images)
        self.assertIn("CHAT_DB_PASSWORD='chat_db_password'", result['realtime'])
        self.assertNotIn('postgres_password', result['realtime'])
        self.secret['CHAT_DB_PASSWORD'] = self.secret['POSTGRES_PASSWORD']
        with self.assertRaises(ValueError): m.generate(self.secret, self.config, self.images)

    def test_wrong_target_and_registry_rejected(self):
        self.config['hosts']['data']['name'] = 'gromo-dev-app'
        with self.assertRaises(ValueError): m.generate(self.secret, self.config, self.images)
        self.config['hosts']['data']['name'] = 'catus-dev-v2-data'
        self.images['data-api'] = 'prod.example/image@sha256:' + 'a'*64
        with self.assertRaises(ValueError): m.generate(self.secret, self.config, self.images)


if __name__ == '__main__': unittest.main()
