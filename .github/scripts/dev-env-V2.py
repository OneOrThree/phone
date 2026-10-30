#!/usr/bin/env python3
"""v2 복사 시크릿을 서비스별로 필터하고 내부 주소를 새 VM으로 고정한다."""
import importlib.util
import ipaddress
import json
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('compose_writer', Path(__file__).with_name('write-compose-env.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)


def private_ip(value):
    addr = ipaddress.ip_address(value)
    if addr not in ipaddress.ip_network('10.30.0.0/24'):
        raise ValueError('dev V2 서브넷의 private IP가 필요합니다')
    return str(addr)


def database_name(value):
    match = re.fullmatch(r'jdbc:postgresql://[^/]+/([A-Za-z0-9_]+)(?:\?.*)?', value)
    if not match:
        raise ValueError('기존 JDBC URL에서 데이터베이스 이름을 확인할 수 없습니다')
    return match.group(1)


def realtime_db_password(secret):
    # 관리자 비밀번호 재사용 금지. 유출 시 다른 DB 접근 차단.
    w.require(secret, ('REALTIME_DB_PASSWORD',))
    if secret['REALTIME_DB_PASSWORD'] == secret.get('POSTGRES_PASSWORD'):
        raise ValueError('Realtime DB 비밀번호는 관리자 비밀번호와 달라야 합니다')
    return secret['REALTIME_DB_PASSWORD']


def generate(secret, config, images):
    if config.get('environment') != 'dev-v2' or config.get('project') != 'oneorthree2':
        raise ValueError('dev V2 배포 설정이 아닙니다')
    hosts = config['hosts']
    for role in ('app', 'data', 'redis'):
        if hosts[role].get('name') != f'catus-dev-v2-{role}' or not hosts[role].get('id'):
            raise ValueError('dev V2 VM 대상 식별자가 다릅니다')
    if len({hosts[role]['private_ip'] for role in ('app', 'data', 'redis')}) != 3:
        raise ValueError('dev V2 VM 주소는 서로 달라야 합니다')
    for service in ('data-api', 'business-api', 'notification', 'realtime'):
        image = images.get(service, '')
        pattern = rf'asia-northeast3-docker\.pkg\.dev/oneorthree2/{service}/{service}@sha256:[0-9a-f]{{64}}'
        if not re.fullmatch(pattern, image):
            raise ValueError('dev GAR 이미지 digest가 다릅니다: ' + service)
    data_host, redis_host = private_ip(hosts['data']['private_ip']), private_ip(hosts['redis']['private_ip'])
    if data_host == redis_host:
        raise ValueError('Data와 Redis VM 주소가 같습니다')
    required = ('API_DB_URL', 'NOTI_DB_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
                'REDIS_DATA_PASSWORD', 'REDIS_REALTIME_PASSWORD', 'BUSINESS_REDIS_PASSWORD',
                'JWT_SECRET', 'SVC_TOKEN_REALTIME_TO_DATA', 'SVC_TOKEN_DATA_TO_REALTIME', 'SVC_TOKEN_BIZ_TO_REALTIME')
    w.require(secret, required)
    values = dict(secret)
    values.update(API_DB_URL=f"jdbc:postgresql://{data_host}:5432/{database_name(secret['API_DB_URL'])}",
                  NOTI_DB_URL=f"jdbc:postgresql://{data_host}:5432/{database_name(secret['NOTI_DB_URL'])}",
                  DATA_API_BASE_URL='http://app:8080', NOTIFICATION_BASE_URL='http://notification:8082',
                  REALTIME_BASE_URL='http://realtime:8081', REALTIME_AUTHORIZATION_DATA_URL='http://app:8080',
                  KAFKA_BOOTSTRAP_SERVERS=f'{data_host}:9092', REDIS_HOST=redis_host, REDIS_PORT='6379')
    if values.get('BUSINESS_REDIS_LEGACY_HOST'):
        values.update(BUSINESS_REDIS_LEGACY_HOST=redis_host, BUSINESS_REDIS_LEGACY_PORT='6379')
    result = {}
    for service in ('data-api', 'business-api', 'notification'):
        rendered = w.render_service(values, images[service], service, 'transition', 'dev')
        if service == 'data-api':
            # 기존 writer의 단일 VM 기본값 redis를 원격 v2 주소로 교체한다.
            rendered, count = re.subn(r'(?m)^REDIS_HOST=.*$', f'REDIS_HOST={w.dotenv_quote(redis_host)}', rendered)
            if count != 1:
                raise ValueError('Data Redis 주소를 확정할 수 없습니다')
        result[service] = rendered
    rtkeys = ('JWT_SECRET', 'SVC_TOKEN_REALTIME_TO_DATA', 'SVC_TOKEN_DATA_TO_REALTIME',
              'SVC_TOKEN_BIZ_TO_REALTIME', 'CHAT_WS_ALLOWED_ORIGINS', 'REALTIME_AUTHORIZATION_CLIENT_ENABLED',
              'REALTIME_BLOCKS_FILTER_ENABLED', 'REALTIME_EVENTS_KAFKA_ENABLED',
              'REALTIME_MOVEMENT_MULTI_INSTANCE_ENABLED', 'REALTIME_AUTHORIZATION_WAIT_TIMEOUT',
              'REALTIME_AUTHORIZATION_CACHE_TTL_SECONDS', 'CHAT_DATA_API_MAX_CONCURRENCY')
    rt = {key: values[key] for key in rtkeys if values.get(key) is not None}
    origins = [origin.strip() for origin in str(rt.get('CHAT_WS_ALLOWED_ORIGINS', '')).split(',') if origin.strip()]
    if 'https://oneorthree-v2.dev.mooo.com' not in origins:
        origins.append('https://oneorthree-v2.dev.mooo.com')
    rt['CHAT_WS_ALLOWED_ORIGINS'] = ','.join(origins)
    rt.update(SPRING_PROFILES_ACTIVE='dev', CHAT_DB_URL=f'jdbc:postgresql://{data_host}:5432/gromo_chat',
              CHAT_DB_USERNAME='catus_realtime_v2', CHAT_DB_PASSWORD=realtime_db_password(secret),
              DATA_API_BASE_URL='http://app:8080', REALTIME_AUTHORIZATION_DATA_URL='http://app:8080',
              KAFKA_BOOTSTRAP_SERVERS=f'{data_host}:9092', REDIS_HOST=redis_host, REDIS_PORT='6379',
              REDIS_USERNAME='realtime', REDIS_PASSWORD=secret['REDIS_REALTIME_PASSWORD'])
    result['realtime'] = ''.join(f'{k}={w.dotenv_quote(v)}\n' for k, v in rt.items())
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--images', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    secret = json.load(sys.stdin)
    result = generate(secret, json.loads(args.config.read_text()), json.loads(args.images.read_text()))
    for service, contents in result.items():
        w.write_atomic(args.output_dir / f'{service}.env', contents)


if __name__ == '__main__':
    main()
