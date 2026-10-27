#!/usr/bin/env python3
"""공유 dev 이미지로 임시 DB·서비스를 만들어 TC014를 검증하고 소유한 컨테이너만 정리한다.
실행: GCP dev VM에서 SMOKE_ALLOW_ISOLATED_TEST=1 python3 .../isolated-core.py
"""
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import tempfile
import time
import urllib.request
import uuid


def cmd(*args, input_text=None):
    p = subprocess.run(args, input=input_text, capture_output=True, text=True, timeout=120)
    if p.returncode:
        raise RuntimeError('검증 환경 명령 실패: ' + args[0] + ' (원문·자격은 출력하지 않음)')
    return p.stdout.strip()


def info(name):
    return json.loads(cmd('docker', 'inspect', name))[0]


def main():
    if os.environ.get('SMOKE_ALLOW_ISOLATED_TEST') != '1':
        raise RuntimeError('격리된 테스트 환경 실행을 명시해야 함')
    if not os.environ.get('RESULTS_FILE'):
        raise RuntimeError('보존할 RESULTS_FILE 경로 필요')
    source_data = info('phone-data-api')
    source_business = info('phone-business-api-1')
    networks = set(source_data['NetworkSettings']['Networks']) & set(source_business['NetworkSettings']['Networks'])
    if len(networks) != 1:
        raise RuntimeError('검사 대상 dev 네트워크를 한 개로 확정할 수 없음')
    network = networks.pop()
    prefix = 'gromo-smoke-2285-' + uuid.uuid4().hex[:10]
    created = []
    def cancel(signum, _frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, cancel)
    private = Path(tempfile.mkdtemp(prefix=prefix))
    os.chmod(private, 0o700)
    db, redis, data, business = [prefix + '-' + s for s in ('db', 'redis', 'data', 'business')]
    password = secrets.token_urlsafe(32)
    shared = {k: secrets.token_urlsafe(48) for k in ('JWT_SECRET', 'LOGIN_ATTEMPT_DIGEST_SECRET', 'LINK_CAPABILITY_KEY')}
    shared.update({k: secrets.token_urlsafe(32) for k in ('SVC_TOKEN_BIZ_TO_DATA', 'SVC_TOKEN_BIZ_TO_NOTI',
                                                       'SVC_TOKEN_DATA_TO_NOTI', 'SVC_TOKEN_NOTI_TO_DATA',
                                                       'SVC_TOKEN_BIZ_TO_REALTIME', 'SVC_TOKEN_DATA_TO_REALTIME',
                                                       'SVC_TOKEN_REALTIME_TO_DATA', 'SVC_TOKEN_BIZ_TO_LINK',
                                                       'SVC_TOKEN_DATA_TO_LINK')})

    def start(name, image, environment, extra=()):
        file = private / (name + '.env')
        with file.open('w') as f:
            for key, value in environment.items():
                if '\n' not in value and '\r' not in value:
                    f.write(key + '=' + value + '\n')
        os.chmod(file, 0o600)
        created.append(name)
        cmd('docker', 'run', '-d', '--name', name, '--network', network,
            '--label', 'gromo.smoke.owner=' + prefix, '--env-file', str(file), *extra, image)

    def source_env(source):
        return dict(x.split('=', 1) for x in source['Config'].get('Env', []) if '=' in x)

    def wait_db():
        for _ in range(60):
            p = subprocess.run(['docker', 'exec', db, 'pg_isready', '-U', 'smoke', '-d', 'smoke_core'], capture_output=True)
            if p.returncode == 0:
                return
            time.sleep(1)
        raise RuntimeError('격리 DB 기동 실패')

    def wait_health(name, port):
        for _ in range(180):
            if not info(name)['State']['Running']:
                raise RuntimeError('격리 서비스 부팅 실패: ' + name)
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/actuator/health', timeout=2) as r:
                    if r.status == 200:
                        return
            except Exception:
                pass
            time.sleep(1)
        logs = cmd('docker', 'logs', '--tail', '60', name)
        # 시작 로그만 취하고 복사한 자격 문자열은 출력 전에 제거한다.
        for source in (source_data, source_business):
            for entry in source['Config'].get('Env', []):
                key, _, value = entry.partition('=')
                if value and any(word in key for word in ('SECRET', 'TOKEN', 'PASSWORD', 'JSON', 'API_KEY')):
                    logs = logs.replace(value, '[redacted]')
        for line in logs.splitlines():
            if any(word in line for word in ('ERROR', 'Exception', 'Started', 'Tomcat', 'Caused by', 'Hikari')):
                print(line, flush=True)
        raise RuntimeError('격리 서비스 health 대기 시간 초과: ' + name)

    def port(name, container_port):
        return info(name)['NetworkSettings']['Ports'][f'{container_port}/tcp'][0]['HostPort']

    rc = 1
    try:
        start(db, 'postgres:16-alpine', {'POSTGRES_USER': 'smoke', 'POSTGRES_PASSWORD': password,
                                       'POSTGRES_DB': 'smoke_core'}, ('--tmpfs', '/var/lib/postgresql/data'))
        start(redis, 'redis:7-alpine', {})
        wait_db()
        print('격리 DB 준비 완료', flush=True)
        environment = source_env(source_data)
        environment.update(shared)
        environment.update({'API_DB_URL': f'jdbc:postgresql://{db}:5432/smoke_core',
                            'API_DB_USERNAME': 'smoke', 'API_DB_PASSWORD': password,
                            'REDIS_HOST': redis, 'REDIS_PORT': '6379', 'REDIS_USERNAME': '', 'REDIS_PASSWORD': '',
                            'OUTBOX_RELAY_ENABLED': 'false',
                            'FOCUS_PRESENCE_ENABLED': 'false',
                            'NOTIFICATION_DISPATCH_MODE': 'OUTBOX', 'DD_TRACE_ENABLED': 'false',
                            'JAVA_TOOL_OPTIONS': '-Xmx1024m -XX:ActiveProcessorCount=2',
                            'JAVA_OPTS': '-Djava.security.egd=file:/dev/./urandom', 'APP_SCHEDULING_ENABLED': 'false'})
        start(data, source_data['Image'], environment, ('--publish', '127.0.0.1::9091'))
        wait_health(data, port(data, 9091))
        print('격리 Data API 기동 완료', flush=True)
        # 빈 임시 DB에만 테스트 카탈로그를 발행한다. 공유 DB·가격 publication에는 접근하지 않는다.
        sql = """BEGIN;
INSERT INTO catalog_assets(product_id,title,kind,owner_type) VALUES('smoke-private-shirt','smoke fixture','clothes','user');
INSERT INTO shop_product_revisions(product_id,revision,currency,price,required_building) VALUES('smoke-private-shirt',1,'village_points',5,'shop');
INSERT INTO shop_catalog_publications(version) VALUES(1);
INSERT INTO shop_catalog_publication_entries(publication_version,product_id,product_revision,category,display_order)
 VALUES(1,'smoke-private-shirt',1,'personal',1);
INSERT INTO shop_catalog_active_publication(singleton,publication_version) VALUES(true,1);
COMMIT;"""
        cmd('docker', 'exec', '-i', db, 'psql', '-U', 'smoke', '-d', 'smoke_core', '-v', 'ON_ERROR_STOP=1', '-q', input_text=sql)
        environment = source_env(source_business)
        environment.update(shared)
        environment.update({'DATA_API_BASE_URL': f'http://{data}:8080', 'BUSINESS_REDIS_HOST': redis,
                            'BUSINESS_REDIS_PORT': '6379', 'BUSINESS_REDIS_USERNAME': '', 'BUSINESS_REDIS_PASSWORD': '',
                            'DD_TRACE_ENABLED': 'false',
                            # 신규 JVM/빈 DB의 기능 검사다. 공유 dev 지연 SLO와 별도로 cold start 예산을 명시한다.
                            'JAVA_TOOL_OPTIONS': '-Xmx512m -XX:ActiveProcessorCount=2 '
                                         '-Djava.security.egd=file:/dev/./urandom '
                                         '-Dbusiness.upstream.data.read-timeout=10s '
                                         '-Dbusiness.upstream.composition.deadline=20s', 'JAVA_OPTS': ''})
        start(business, source_business['Image'], environment,
              ('--publish', '127.0.0.1::8080', '--publish', '127.0.0.1::9091'))
        wait_health(business, port(business, 9091))
        print('격리 Business API 기동 완료', flush=True)
        env = os.environ.copy()
        env.update({'BASE_URL': 'http://127.0.0.1:' + port(business, 8080), 'SMOKE_DB_CONTAINER': db,
                    'SMOKE_DB_USER': 'smoke', 'SMOKE_DB_NAME': 'smoke_core', 'SMOKE_HTTP_TIMEOUT': '25'})
        script = Path(__file__).resolve().parent.parent / 'core-flow.sh'
        # 실행기 stdout은 안전한 TC 요약이며 보호된 응답 파일은 자체 정리된다.
        process = subprocess.Popen(['bash', str(script)], env=env, start_new_session=True)
        try:
            rc = process.wait()
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=30)
        print('격리 GCP TC014 EXIT=' + str(rc))
    finally:
        failures = []
        for name in reversed(created):
            try:
                if not cmd('docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$'):
                    continue
                if info(name)['Config'].get('Labels', {}).get('gromo.smoke.owner') != prefix:
                    raise RuntimeError('소유권 불일치')
                cmd('docker', 'rm', '-f', '-v', name)
            except Exception:
                failures.append(name)
        for file in private.glob('*.env'):
            file.unlink()
        private.rmdir()
        if failures:
            raise RuntimeError('격리 검증 컨테이너 정리 실패: ' + ', '.join(failures))
        print('격리 컨테이너·임시 DB·자격 파일 정리 완료')
    return rc


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(str(error))
        raise SystemExit(1)
