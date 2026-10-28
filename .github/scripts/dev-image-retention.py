#!/usr/bin/env python3
"""dev 스모크 전 이미지 정리와 통과 후 성공 이력 갱신을 분리한다."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

SERVICES = {
    'data-api': 'phone-data-api',
    'business-api': 'phone-business-api-1',
    'realtime': 'phone-realtime',
    'notification': 'phone-notification-1',
}
REPOSITORIES = {
    service: f'asia-northeast3-docker.pkg.dev/oneorthree2/{service}/{service}'
    for service in SERVICES
}
IMAGE_ID = re.compile(r'sha256:[0-9a-f]{64}')
MIN_AGE = datetime.timedelta(days=7)


def docker(*args):
    # inspect 원문에는 env 비밀이 있으므로 오류에 stdout/stderr를 포함하지 않는다.
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f'Docker 작업 실패: {args[0]} {args[1]}')
    return result.stdout


def inspect(kind, identifiers):
    return json.loads(docker(kind, 'inspect', *identifiers)) if identifiers else []


def repository(reference):
    return reference.split('@', 1)[0].split(':', 1)[0]


def current_images():
    containers = inspect('container', list(SERVICES.values()))
    by_name = {item['Name'].lstrip('/'): item for item in containers}
    current = {}
    for service, name in SERVICES.items():
        item = by_name[name]
        labels = item['Config'].get('Labels') or {}
        if (labels.get('com.docker.compose.project') != 'phone'
                or labels.get('com.docker.compose.service') != service
                or not item['State'].get('Running')
                or item['State'].get('Health', {}).get('Status') != 'healthy'
                or repository(item['Config']['Image']) != REPOSITORIES[service]
                or not IMAGE_ID.fullmatch(item['Image'])):
            raise ValueError(f'dev 서비스 식별/healthy 확인 실패: {service}')
        current[service] = item['Image']
    return current


def load_history(path):
    if not path.exists():
        return {service: [] for service in SERVICES}
    data = json.loads(path.read_text())
    if data.get('version') != 1 or set(data.get('images', {})) != set(SERVICES):
        raise ValueError('dev 성공 이미지 이력 형식 오류 — 삭제하지 않음')
    for images in data['images'].values():
        if (not isinstance(images, list) or len(images) > 2
                or any(not isinstance(value, str) or not IMAGE_ID.fullmatch(value) for value in images)
                or len(images) != len(set(images))):
            raise ValueError('dev 성공 이미지 ID 오류 — 삭제하지 않음')
    return data['images']


def advance(history, current):
    return {service: list(dict.fromkeys([image, *history[service]]))[:2]
            for service, image in current.items()}


def save_history(path, history):
    # 중간 종료에도 다음 실행이 잘린 이력을 읽지 않도록 같은 파일시스템에서 교체한다.
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        json.dump({'version': 1, 'images': history}, stream)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def referenced_images():
    # 중지된 컨테이너도 보존한다. 컨테이너·볼륨은 정리 대상이 아니다.
    ids = docker('container', 'ls', '--all', '--quiet').split()
    return {item['Image'] for item in inspect('container', ids)}


def candidates(images, history, referenced, now):
    protected = referenced | {image for values in history.values() for image in values}
    eligible_repositories = {REPOSITORIES[service] for service, values in history.items() if len(values) == 2}
    result = []
    for image in images:
        refs = (image.get('RepoTags') or []) + (image.get('RepoDigests') or [])
        repos = {repository(ref) for ref in refs}
        # dev VM의 Python 3.8은 Docker의 나노초(9자리)를 읽지 못하므로 마이크로초로 자른다.
        stamp = re.sub(r'(\.\d{6})\d+', r'\1', image['Created']).replace('Z', '+00:00')
        created = datetime.datetime.fromisoformat(stamp)
        if (image['Id'] not in protected and repos and repos <= eligible_repositories
                and now - created >= MIN_AGE):
            result.append(image['Id'])
    return sorted(set(result))


def run(path, apply=False, record_success=False):
    if os.environ.get('DEPLOY_ENV') != 'dev':
        raise ValueError('DEPLOY_ENV=dev에서만 실행할 수 있음')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix('.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = current_images()
        history = load_history(path)
        if record_success:
            save_history(path, advance(history, current))
            print('dev 스모크 성공 이미지 이력 갱신 완료')
            return
        ids = sorted(set(docker('image', 'ls', '--all', '--quiet', '--no-trunc').split()))
        images = inspect('image', ids)
        if not {value for values in history.values() for value in values} <= set(ids):
            raise ValueError('보존할 성공 이미지가 로컬에 없음 — 삭제하지 않음')
        planned = candidates(images, history, referenced_images() | set(current.values()),
                             datetime.datetime.now(datetime.timezone.utc))
        print(json.dumps({'apply': apply, 'protected_success_images': history, 'candidates': planned}))
        if not apply:
            return
        for image_id in planned:
            if current_images() != current:
                raise RuntimeError('실행 이미지 변경 감지 — 정리 중단')
            if image_id in referenced_images():
                print(f'컨테이너가 참조하기 시작한 이미지 보존: {image_id}')
                continue
            try:
                # ID로만 지워 태그 재지정으로 다른 이미지를 지우지 않는다. 부모 자동 정리도 막는다.
                # 여러 태그/저장소 참조 때문에 Docker가 거부하면 강제 삭제하지 않고 남긴다.
                docker('image', 'rm', '--no-prune', image_id)
                print(f'dev 미사용 이미지 삭제: {image_id}')
            except RuntimeError:
                print(f'::warning::이미지 삭제 거절 — 보존하고 계속: {image_id}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='기존 성공 이력을 보존하며 스모크 전 정리')
    mode.add_argument('--record-success', action='store_true', help='전체 dev 스모크 성공 후에만 이력 갱신')
    args = parser.parse_args()
    run(Path(os.environ['DEV_IMAGE_HISTORY']), args.apply, args.record_success)
