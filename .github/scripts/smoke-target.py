#!/usr/bin/env python3
"""잠금 안에서 실제 컨테이너 버전을 기록하고 요청 SHA와 비교한다."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

CONTAINERS = {'data-api': 'phone-data-api', 'realtime': 'phone-realtime',
              'business-api': 'phone-business-api-1', 'notification': 'phone-notification-1'}


def inspect_targets():
    records = {}
    for service, name in CONTAINERS.items():
        container = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
        image = json.loads(subprocess.check_output(['docker', 'image', 'inspect', container['Image']]))[0]
        records[service] = {'container_id': container['Id'], 'image_id': container['Image'],
                            'image': container['Config']['Image'],
                            'repo_digests': image.get('RepoDigests') or [],
                            'revision': (image.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision', '')}
    return records


def target_state(plan, records, descendant):
    revision = plan.get('revision', '')
    services = plan.get('services')
    if not re.fullmatch('[0-9a-f]{40}', revision) or not isinstance(services, list) or any(s not in CONTAINERS for s in services):
        raise ValueError('smoke 대상 계획 오류')
    superseded = False
    for service in services:
        actual = records[service]['revision']
        if actual == revision:
            continue
        if not re.fullmatch('[0-9a-f]{40}', actual) or not descendant(revision, actual):
            raise ValueError(service + ' 실제 이미지가 요청 SHA와 일치하지 않음')
        superseded = True
    return 'superseded' if superseded else 'matched'


def main():
    path = Path(os.environ['RUNNER_TEMP']) / 'smoke-results' / 'targets.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    records = inspect_targets()
    if len(sys.argv) > 1 and sys.argv[1] == 'verify':
        before = json.loads(path.read_text())
        if before['services'] != records:
            raise ValueError('검사 중 컨테이너·이미지 버전 변경')
        return
    payload = os.environ.get('SMOKE_TARGET_PLAN', '')
    if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
        plan = {'revision': os.environ['GITHUB_SHA'], 'services': []}
    else:
        plan = json.loads(payload)
        if not plan.get('services'):
            raise ValueError('자동 smoke에 배포 대상 서비스가 없음')
    def descendant(before, after):
        # 얕은 checkout으로 추정하지 않는다. 알려진 main 이력 안의 후속 SHA만 인정한다.
        return subprocess.run(['git', 'merge-base', '--is-ancestor', before, after],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    # 불일치로 중단해도 실제 이미지 증거는 산출물에 남긴다.
    path.write_text(json.dumps({'request': plan, 'state': 'unverified', 'services': records}, indent=2) + '\n')
    state = target_state(plan, records, descendant)
    path.write_text(json.dumps({'request': plan, 'state': state, 'services': records}, indent=2) + '\n')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
        file.write('state=' + state + '\n')
    print('smoke 대상: ' + state + ' — 실제 SHA·image ID·digest는 targets.json 참조')


if __name__ == '__main__':
    main()
