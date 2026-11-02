#!/usr/bin/env python3
"""008 서비스 health, 017·018 Redis 읽기·쓰기. 자격과 Docker 오류 본문은 출력하지 않는다."""
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path


def docker(*args, input_text=None):
    result = subprocess.run([os.environ.get('SMOKE_DOCKER', 'docker'), *args],
                            input=input_text, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError('Docker 요청 실패 (기동·권한·접속 설정 확인)')
    return result.stdout.strip()


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def check_health():
    names = os.environ.get('SMOKE_CONTAINER_NAMES',
                           'phone-data-api phone-realtime phone-business-api-1 phone-notification-1 phone-kafka').split()
    if len(names) != 5 or len(set(names)) != 5:
        raise RuntimeError('서로 다른 서비스 컨테이너 5개를 지정해야 함')
    for name in names:
        state = inspect(name).get('State', {})
        if not state.get('Running') or state.get('Restarting') or state.get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('서비스 컨테이너가 running·healthy 상태가 아님')
    return '서비스 5개 running·healthy'


def redis_probe(business=False):
    prefix = 'SMOKE_BUSINESS_REDIS' if business else 'SMOKE_REDIS'
    name = os.environ.get(prefix + '_CONTAINER', 'phone-business-redis-1' if business else 'phone-redis')
    source = os.environ.get(prefix + '_ENV_CONTAINER', 'phone-business-api-1' if business else 'phone-data-api')
    raw = inspect(source).get('Config', {}).get('Env', [])
    settings = dict(item.split('=', 1) for item in raw if '=' in item)
    app_prefix = 'BUSINESS_REDIS_' if business else 'REDIS_'
    username = os.environ.get(prefix + '_USERNAME', settings.get(app_prefix + 'USERNAME', ''))
    password = os.environ.get(prefix + '_PASSWORD', settings.get(app_prefix + 'PASSWORD', ''))
    # dev V2 공용 Redis의 data 계정은 presence:* 만 허용. 환경별로 접두사를 받는다.
    key = ('cache:business:smoke:' if business else os.environ.get('SMOKE_REDIS_KEY_PREFIX', 'smoke:redis:')) + str(uuid.uuid4())
    value = str(uuid.uuid4())

    # 비밀번호는 argv로 넘기지 않는다. docker exec stdin은 redis-cli의 명령 입력으로 사용한다.
    # REDISCLI_AUTH는 컨테이너 환경에만 전달하며 결과·예외에 자격은 포함하지 않는다.
    base = ['exec', '-i']
    command_env = os.environ.copy()
    if password:
        command_env['REDISCLI_AUTH'] = password
        base += ['-e', 'REDISCLI_AUTH']
    base += [name, 'redis-cli', '--raw', '--no-auth-warning']
    if username:
        base += ['--user', username]

    def cli(command):
        p = subprocess.run([os.environ.get('SMOKE_DOCKER', 'docker'), *base],
                           input=command + '\n', text=True, capture_output=True, timeout=15, env=command_env)
        if p.returncode:
            raise RuntimeError('Redis 요청 실패')
        out = p.stdout.strip()
        if any(x in out for x in ('NOAUTH', 'WRONGPASS', 'NOPERM', 'ERR ', 'error')):
            raise RuntimeError('Redis 인증·ACL·명령 오류')
        return out

    failure = None
    try:
        if cli(f'SET {key} {value} EX 60') != 'OK':
            raise RuntimeError('Redis SET 실패')
        if cli(f'GET {key}') != value:
            raise RuntimeError('Redis GET 값 불일치')
        if business:
            # 앱 ACL은 TTL/PTTL 조회를 허용하지 않는다. 허용된 EXPIRE·GET으로
            # 실제 만료를 확인하고, 삭제 검사 전에 TTL 60초 임시 키를 다시 만든다.
            if cli(f'EXPIRE {key} 1') != '1':
                raise RuntimeError('Redis EXPIRE 실패')
            time.sleep(1.2)
            if cli(f'GET {key}') != '':
                raise RuntimeError('Redis 임시 키 만료 실패')
            if cli(f'SET {key} {value} EX 60') != 'OK' or cli(f'GET {key}') != value:
                raise RuntimeError('Redis 만료 후 재저장 실패')
        elif not 0 < int(cli(f'TTL {key}')) <= 60:
            raise RuntimeError('Redis TTL 범위 불일치')
        if cli(f'DEL {key}') != '1' or cli(f'GET {key}') != '':
            raise RuntimeError('Redis 임시 키 삭제 실패')
    except (RuntimeError, ValueError, subprocess.TimeoutExpired) as exc:
        failure = exc
    finally:
        try:
            cli(f'DEL {key}')
        except (RuntimeError, subprocess.TimeoutExpired):
            failure = RuntimeError('Redis 임시 키 정리 실패 (TTL 60초)')
    if failure:
        raise RuntimeError(str(failure) if isinstance(failure, RuntimeError) else 'Redis 요청·TTL 검증 실패')
    return '임시 키 SET·GET·만료·DEL 검증' if business else '임시 키 SET·GET·TTL·DEL 검증'


def main():
    path = Path(os.environ.get('RESULTS_FILE', 'results.tsv'))
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.environ.get('SMOKE_APPEND_RESULTS') != '1' or not path.exists() or path.stat().st_size == 0:
        path.write_text('id\tstatus\thttp_code\tms\treason\n')
    failed = False
    for number, fn in ((8, check_health), (17, redis_probe), (18, lambda: redis_probe(True))):
        start = time.monotonic()
        try:
            reason = fn()
            status = 'PASS'
        except Exception as exc:
            # 임의 subprocess/JSON 예외 내용에는 원문·자격이 포함될 수 있다.
            reason = str(exc) if isinstance(exc, RuntimeError) else '검사 실행 실패 (로컬 Docker·설정 확인)'
            status = 'FAIL'
            failed = True
        row = f'SMOKE-SERVER-{number:03}\t{status}\t-\t{int((time.monotonic()-start)*1000)}\t{reason}\n'
        with path.open('a') as f:
            f.write(row)
        print(row.strip())
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
