"""격리된 실제 Redis로 V2 Business 차단 표지의 ACL·AOF 보존을 검증한다."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid


class RedisTest(unittest.TestCase):
    def test_캐시와_차단_표지가_재시작_후_남고_다른_역할의_키를_거부한다(self):
        spec=importlib.util.spec_from_file_location('writer',Path(__file__).with_name('write-compose-env.py'))
        writer=importlib.util.module_from_spec(spec);spec.loader.exec_module(writer)
        name='catus-business-probe-v2-'+uuid.uuid4().hex[:12]
        volume=name+'-data';password='isolated-test-only-password'
        def run(*args,**kwargs):
            return subprocess.run(['docker',*args],check=True,capture_output=True,text=True,timeout=120,**kwargs).stdout
        with tempfile.TemporaryDirectory() as d:
            acl=Path(d)/'users.acl';acl.write_text(writer.business_redis_acl({'BUSINESS_REDIS_PASSWORD':password}));acl.chmod(0o644)
            compose_env=Path(d)/'compose.env'
            compose_env.write_text(f'HOST_PRIVATE_IP=127.0.0.1\nSHARED_ACL_FILE={acl}\nBUSINESS_ACL_FILE={acl}\n')
            source=Path(__file__).resolve().parents[2]/'server/scripts/runtime-V2/redis-V2.yml'
            service=json.loads(run('compose','--env-file',str(compose_env),'-f',str(source),'config','--format','json'))['services']['business']
            env={**os.environ,'REDISCLI_AUTH':password}
            def redis(*args):return run('exec','-e','REDISCLI_AUTH',name,'redis-cli','-e','--user','business',*args,env=env).strip()
            try:
                run('volume','create',volume)
                run('run','-d','--name',name,'--network','none','-v',volume+':/data','-v',str(acl)+':/etc/redis/users.acl:ro',
                    service['image'],*service['command'])
                for _ in range(30):
                    try:
                        if redis('PING')=='PONG':break
                    except subprocess.CalledProcessError:pass
                    time.sleep(1)
                else:self.fail('Redis readiness timeout')
                self.assertEqual(run('exec',name,*service['healthcheck']['test'][1:]).strip(),'PONG')
                self.assertIn('noeviction',run('exec',name,'redis-cli','-e','--user','health','--pass','','CONFIG','GET','maxmemory-policy'))
                self.assertEqual(redis('SET','cache:business:revoked:probe-V2','1','PX','60000'),'OK')
                self.assertEqual(redis('HSET','cache:business:preview:probe-V2','json','fixture'),'1')
                self.assertEqual(redis('HGET','cache:business:preview:probe-V2','json'),'fixture')
                with self.assertRaises(subprocess.CalledProcessError):redis('SET','presence:probe-V2','blocked')
                run('restart',name)
                self.assertEqual(redis('GET','cache:business:revoked:probe-V2'),'1')
                self.assertEqual(redis('HGET','cache:business:preview:probe-V2','json'),'fixture')
            finally:
                subprocess.run(['docker','rm','-f',name],capture_output=True,timeout=60)
                subprocess.run(['docker','volume','rm',volume],capture_output=True,timeout=60)


if __name__=='__main__':unittest.main()
