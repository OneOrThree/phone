#!/usr/bin/env python3
"""PR 변경 입력으로 위성 전체 검사·이미지를 선택한다. 계약 검사는 별도로 유지한다."""
import json
import io
import zipfile
import os
import re
from pathlib import Path
import subprocess

SERVICES = ('business-api', 'notification')


# 위성 «빌드 방식» 자체를 바꾸는 입력 — 이것만 두 서비스 전체 검사를 켠다.
# 나머지 .github 변경(다른 워크플로·다른 스크립트)은 계약 검사만 돌리면 충분하다.
# 안 가르면 워크플로 한 줄만 고쳐도 business-api·notification 전체 빌드가 켜져
# 러너 슬롯을 오래 물고, 관계없는 PR 까지 줄줄이 대기한다 (GROMO-1918).
BUILD_AFFECTING = (
    '.github/workflows/be-gradle.yml',
    '.github/workflows/prod-ci.yml',
    '.dockerignore',
    '.github/workflows/satellite-check.yml',
    '.github/workflows/satellite-ci.dev.yml',
    '.github/workflows/satellite-ci.prod.yml',
    '.github/scripts/satellite-ci-plan.py',
    # JAR 재사용 팩·검증 로직 — build 와 images 가 이 스크립트로 아티팩트를 주고받는다.
    # 처음에 `.github/actions/ci-jar/` 만 넣고 이걸 빠뜨렸다가 test_ci_build_reuse 에 잡혔다.
    '.github/scripts/ci-jar.py',
    # 위성 배포가 직접 실행하는 공용 스크립트·CD — 바뀌면 다시 배포해 검증해야 한다 (GROMO-2224).
    # contract-only(.github/)로 떨어지면 CI 는 돌아도 배포 계획이 비어 CD 가 통째로 건너뛴다.
    '.github/scripts/dev-env.sh',
    '.github/scripts/write-compose-env.py',
    '.github/scripts/wait-healthy.sh',
    '.github/scripts/mark-deploy.sh',
    '.github/workflows/satellite-cd.dev.yml',
)
BUILD_AFFECTING_PREFIXES = (
    '.github/actions/ci-jar/',
    '.github/actions/check-arm-image/',
)
# 계약 검사(runtime-contracts·public-command-contracts)만 돌리면 되는 입력.
# 이 잡들은 어차피 ubuntu-latest 에서 몇 분이면 끝나고 서비스 빌드와 무관하다.
CONTRACT_ONLY_PREFIXES = (
    'docs/', 'app/', 'server/realtime/', '.github/',
)
# 루트 파일은 이름이 정확히 같을 때만 걸린다 — server/business-api/.gitignore 같은 건
# 위의 `own` 판정에서 이미 그 서비스로 간다. 이걸 안 넣으면 .gitignore 한 줄이
# 「분류 안 된 경로」로 떨어져 두 서비스 전체 빌드를 켠다 (PR #790 이 실제로 그랬다).
CONTRACT_ONLY_FILES = (
    'README.md', 'AGENTS.md', 'CLAUDE.md',
    # realtime compose 는 위성이 안 띄움 — 설정 계약 테스트만 돌리면 됨 (GROMO-2224)
    'server/scripts/docker-compose.realtime.yml',
    '.gitignore', '.gitattributes', '.editorconfig',
)


def plan(paths):
    selected = {service: False for service in SERVICES}
    if not paths:
        return {service: True for service in SERVICES}
    for path in paths:
        if path.endswith(('.md', '.mdx', '.rst', '.txt')):
            continue
        if path.startswith('server/data-api/'):
            # 실제 Noti bootJar를 이용한 체크섬·공개 명령 계약은 workflow가 계속 검사한다.
            continue
        own = next((s for s in SERVICES if path.startswith(f'server/{s}/')), None)
        if own:
            selected[own] = True
        elif path in BUILD_AFFECTING or path.startswith(BUILD_AFFECTING_PREFIXES):
            # 빌드 방식이 바뀌었으니 그 빌드가 실제로 도는지 증명해야 한다.
            return {service: True for service in SERVICES}
        elif path.startswith(CONTRACT_ONLY_PREFIXES) or path in CONTRACT_ONLY_FILES:
            continue
        else:
            # 아직 분류하지 않은 입력은 안전한 쪽으로 — 두 서비스 모두 검사한다.
            return {service: True for service in SERVICES}
    return selected


def github_api(path):
    return json.loads(subprocess.check_output([
        'gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY'] + path,
    ], timeout=20))


def last_deployed_revision(head):
    """취소된 대기 CI의 변경도 포함하도록 성공한 실제 CD를 기준으로 삼는다."""
    runs = github_api('/actions/workflows/satellite-cd.dev.yml/runs?branch=main&event=workflow_run&status=success&per_page=20')['workflow_runs']
    for run in runs:
        if (run.get('event') != 'workflow_run' or run.get('head_branch') != 'main'
                or run.get('conclusion') != 'success'
                or str((run.get('head_repository') or {}).get('id')) != os.environ['GITHUB_REPOSITORY_ID']):
            continue
        artifacts = github_api(f'/actions/runs/{run["id"]}/artifacts?per_page=100')['artifacts']
        records = [item for item in artifacts if item['name'] == 'satellite-deploy-record' and not item['expired']]
        if not records:
            continue
        record = max(records, key=lambda item: item['id'])
        content = subprocess.check_output(['gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY']
                                          + f'/actions/artifacts/{record["id"]}/zip'], timeout=20)
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if archive.namelist() != ['satellite-deploy-record.json']:
                raise ValueError('위성 성공 배포 기록 ZIP 형식 오류')
            record = json.loads(archive.read('satellite-deploy-record.json'))
        revision = record.get('head_sha', '')
        if not re.fullmatch('[0-9a-f]{40}', revision):
            raise ValueError('위성 성공 배포 기록 SHA 오류')
        if any(type(record.get(service)) is not bool for service in SERVICES):
            raise ValueError('위성 성공 배포 기록 서비스 형식 오류')
        if subprocess.run(['git', 'merge-base', '--is-ancestor', revision, head],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            return revision
    raise ValueError('확인 가능한 위성 성공 배포 기준이 없습니다.')


def changed_paths(event):
    if 'pull_request' in event:
        pr = event['pull_request']
        base, head, separator = pr['base']['sha'], pr['head']['sha'], '...'
    else:
        head, separator = event['after'], '..'
        base = last_deployed_revision(head)
    if any(not re.fullmatch('[0-9a-f]{40}', sha) or sha == '0' * 40 for sha in (base, head)):
        raise ValueError('변경 범위 SHA 오류')
    # API 파일 목록의 상한 없이 rename 전후·삭제 경로까지 검사한다.
    result = subprocess.check_output([
        'git', 'diff', '--no-renames', '--name-only', '-z',
        base + separator + head, '--',
    ])
    return [p for p in result.decode().split('\0') if p]


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    selected = {service: True for service in SERVICES}
    reason = 'main/release는 최종 SHA의 두 이미지를 모두 검증·발행한다'
    if (os.environ['GITHUB_EVENT_NAME'] == 'pull_request' or
            (os.environ['GITHUB_EVENT_NAME'] == 'push' and os.environ.get('GITHUB_REF') == 'refs/heads/main')):
        try:
            paths = changed_paths(event)
            selected = plan(paths)
            reason = f'변경 경로 {len(paths)}개로 필요한 위성만 선택했다'
        except (KeyError, ValueError, UnicodeError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
            reason = f'변경 범위 판정 실패: 전체 검사 ({type(error).__name__})'
    result = {'services': selected, 'reason': reason}
    print(json.dumps(result, ensure_ascii=False))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('services=' + json.dumps(selected) + '\n')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write('### 위성 실행 범위\n\n' + reason + '\n\n')
        for service, enabled in selected.items():
            summary.write(f'- {service}: ' + ('전체 검사·이미지' if enabled else '전체 검사·이미지 생략') + '\n')
        summary.write('- 공개 명령·격리·Data/Noti 체크섬 계약 검사는 유지\n')


if __name__ == '__main__':
    main()
