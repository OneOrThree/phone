#!/usr/bin/env python3
"""dev V2 앱 호스트에서 선택한 서비스만 교체하고 결과를 저널에 남긴다."""
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

SERVICES = {'data-api': 'app', 'realtime': 'realtime', 'business-api': 'business-api', 'notification': 'notification'}
ROOT = Path('/opt/catus-dev-v2/app')
RUNTIME = Path('/run/catus-dev-v2/releases')
JOURNAL = ROOT / 'deployment-journal.json'


def atomic_json(path, data):
    fd, tmp = tempfile.mkstemp(prefix='.journal-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(data, out, sort_keys=True)
            out.write('\n')
            out.flush()
            os.fsync(out.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def run(args, *, timeout=600):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('앱 호스트 명령 실패: ' + ' '.join(args[:2]))
    return result.stdout.decode()


def validate(payload):
    release = payload.get('release_id', '')
    if not re.fullmatch(r'[0-9a-f]{40}-[0-9]+-[0-9]+', release): raise ValueError('릴리스 ID 오류')
    selected = payload.get('services')
    if not isinstance(selected, list) or not selected or len(set(selected)) != len(selected) or not set(selected) <= set(SERVICES):
        raise ValueError('서비스 선택 오류')
    if bool(set(selected) & {'data-api', 'realtime'}) and not {'data-api', 'realtime'} <= set(selected):
        raise ValueError('Data와 Realtime은 함께 배포해야 합니다')
    images = payload.get('images', {})
    envs = payload.get('envs', {})
    if set(images) != set(SERVICES) or set(envs) != set(SERVICES): raise ValueError('네 서비스 설정이 필요합니다')
    for name in SERVICES:
        pattern = rf'asia-northeast3-docker\.pkg\.dev/oneorthree2/{name}/{name}@sha256:[0-9a-f]{{64}}'
        if not re.fullmatch(pattern, images[name]): raise ValueError('이미지 digest 오류')
        if not isinstance(envs[name], str) or len(envs[name]) > 100000 or '\x00' in envs[name]: raise ValueError('서비스 env 오류')
    ip = ipaddress.ip_address(payload.get('redis_ip', ''))
    if ip not in ipaddress.ip_network('10.30.0.0/24'): raise ValueError('Redis 주소 오류')
    compose = Path(payload.get('compose_path', ''))
    if compose != ROOT / 'releases' / release / 'compose.yml' or not compose.is_file():
        raise ValueError('고정된 릴리스 Compose가 아닙니다')
    nginx = ROOT / 'releases' / release / 'nginx.conf'
    if not nginx.is_file() or nginx.is_symlink(): raise ValueError('고정된 nginx 설정이 아닙니다')
    return release, selected, images, envs, str(ip), compose, nginx


def deploy(payload):
    release, selected, images, envs, redis_ip, compose, nginx = validate(payload)
    ROOT.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ROOT / 'deployment.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prior = json.loads(JOURNAL.read_text()) if JOURNAL.exists() else None
        if prior and prior.get('status') != 'healthy':
            raise RuntimeError('미완료 배포 저널이 있어 복구 확인이 필요합니다')
        if prior and prior.get('release_id') == release:
            if prior.get('images') != images or prior.get('services') != selected:
                raise ValueError('같은 릴리스 ID의 내용이 변경됐습니다')
            for name, compose_name in SERVICES.items():
                info = json.loads(run(['docker', 'inspect', 'catus-dev-app-v2-' + compose_name + '-1'], timeout=30))[0]
                if info['Config']['Image'] != images[name] or info['State'].get('Health', {}).get('Status') != 'healthy':
                    raise RuntimeError('이미 완료된 릴리스의 현재 이미지 또는 상태가 다릅니다')
            run(['docker', 'exec', 'catus-dev-app-v2-nginx-1', 'nginx', '-t'], timeout=30)
            run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--resolve',
                 'oneorthree-v2.dev.mooo.com:443:127.0.0.1', 'https://oneorthree-v2.dev.mooo.com/health'], timeout=30)
            return prior
        if prior and prior.get('release_id') != payload.get('base_release_id'):
            raise RuntimeError('성공 상태와 호스트 배포 저널의 기준 릴리스가 다릅니다')
        stage = RUNTIME / release
        stage.mkdir(mode=0o700, exist_ok=False)
        for name, content in envs.items():
            path = stage / (name + '.env')
            path.write_text(content)
            path.chmod(0o600)
        vars = {'APP_IMAGE': images['data-api'], 'REALTIME_IMAGE': images['realtime'],
                'BUSINESS_API_IMAGE': images['business-api'], 'NOTIFICATION_IMAGE': images['notification'],
                'DATA_API_ENV_FILE': str(stage/'data-api.env'), 'REALTIME_ENV_FILE': str(stage/'realtime.env'),
                'BUSINESS_API_ENV_FILE': str(stage/'business-api.env'), 'NOTIFICATION_ENV_FILE': str(stage/'notification.env'),
                'REDIS_PRIVATE_IP': redis_ip, 'NGINX_CONFIG_FILE': str(nginx),
                'NGINX_CERT_DIR': '/opt/catus-dev-v2/certs'}
        envfile = stage/'compose.env'
        envfile.write_text(''.join(k + '=' + v + '\n' for k, v in vars.items()))
        envfile.chmod(0o600)
        cmd = ['docker', 'compose', '--env-file', str(envfile), '-f', str(compose)]
        targets = [SERVICES[s] for s in selected]
        # 이미지를 먼저 받아 기동 전 오류는 기존 컨테이너에 영향을 주지 않는다.
        try:
            run(cmd + ['pull', *targets], timeout=900)
        except Exception:
            shutil.rmtree(stage)
            raise
        journal = {'environment': 'dev-v2', 'release_id': release, 'services': selected,
                   'images': images, 'status': 'applying', 'started_at': int(time.time())}
        atomic_json(JOURNAL, journal)
        try:
            run(cmd + ['up', '-d', '--no-deps', *targets], timeout=600)
            run(cmd + ['up', '-d', '--no-deps', 'nginx'], timeout=180)
            deadline = time.monotonic() + 900
            while True:
                states = {}
                for name in SERVICES:
                    container = 'catus-dev-app-v2-' + SERVICES[name] + '-1'
                    info = json.loads(run(['docker', 'inspect', container], timeout=30))[0]
                    states[name] = info['State'].get('Health', {}).get('Status')
                    if info['Config']['Image'] != images[name]: raise RuntimeError('실행 중 이미지가 릴리스와 다릅니다')
                if all(value == 'healthy' for value in states.values()): break
                if time.monotonic() >= deadline: raise RuntimeError('앱 준비 검사 시간 초과')
                time.sleep(5)
            run(['docker', 'exec', 'catus-dev-app-v2-nginx-1', 'nginx', '-t'], timeout=30)
            run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*', '--resolve',
                 'oneorthree-v2.dev.mooo.com:443:127.0.0.1', 'https://oneorthree-v2.dev.mooo.com/health'], timeout=30)
            journal['status'] = 'healthy'
            journal['finished_at'] = int(time.time())
            atomic_json(JOURNAL, journal)
            return journal
        except Exception:
            journal['status'] = 'failed'
            journal['finished_at'] = int(time.time())
            atomic_json(JOURNAL, journal)
            raise


def main():
    if os.geteuid() != 0: raise RuntimeError('root 권한이 필요합니다')
    payload = json.load(sys.stdin)
    print(json.dumps(deploy(payload), sort_keys=True))


if __name__ == '__main__': main()
