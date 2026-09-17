#!/usr/bin/env python3
"""PR 변경 입력으로 위성 전체 검사·이미지를 선택한다. 계약 검사는 별도로 유지한다."""
import json
import os
from pathlib import Path
import subprocess

SERVICES = ('business-api', 'notification')


# 위성 «빌드 방식» 자체를 바꾸는 입력 — 이것만 두 서비스 전체 검사를 켠다.
# 나머지 .github 변경(다른 워크플로·다른 스크립트)은 계약 검사만 돌리면 충분하다.
# 안 가르면 워크플로 한 줄만 고쳐도 business-api·notification 전체 빌드가 켜져
# 러너 슬롯을 오래 물고, 관계없는 PR 까지 줄줄이 대기한다 (GROMO-1918).
BUILD_AFFECTING = (
    '.github/workflows/satellite-ci.yml',
    '.github/scripts/satellite-ci-plan.py',
    '.github/scripts/check-migration-checksum.py',
    # JAR 재사용 팩·검증 로직 — build 와 images 가 이 스크립트로 아티팩트를 주고받는다.
    # 처음에 `.github/actions/ci-jar/` 만 넣고 이걸 빠뜨렸다가 test_ci_build_reuse 에 잡혔다.
    '.github/scripts/ci-jar.py',
)
BUILD_AFFECTING_PREFIXES = (
    '.github/actions/ci-jar/',
)
# 계약 검사(runtime-contracts·public-command-contracts)만 돌리면 되는 입력.
# 이 잡들은 어차피 ubuntu-latest 에서 몇 분이면 끝나고 서비스 빌드와 무관하다.
CONTRACT_ONLY_PREFIXES = (
    'docs/', 'app/', 'server/realtime/', '.github/',
)
CONTRACT_ONLY_FILES = ('README.md', 'AGENTS.md', 'CLAUDE.md')


def plan(paths):
    selected = {service: False for service in SERVICES}
    if not paths:
        return {service: True for service in SERVICES}
    for path in paths:
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


def changed_paths(event):
    pr = event['pull_request']
    # API 파일 목록의 상한 없이 rename 전후·삭제 경로까지 검사한다.
    result = subprocess.check_output([
        'git', 'diff', '--no-renames', '--name-only', '-z',
        f"{pr['base']['sha']}...{pr['head']['sha']}", '--',
    ])
    return [p for p in result.decode().split('\0') if p]


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    selected = {service: True for service in SERVICES}
    reason = 'main/release는 최종 SHA의 두 이미지를 모두 검증·발행한다'
    if os.environ['GITHUB_EVENT_NAME'] == 'pull_request':
        try:
            paths = changed_paths(event)
            selected = plan(paths)
            reason = f'PR 변경 경로 {len(paths)}개를 검사했다'
        except (KeyError, ValueError, UnicodeError, subprocess.CalledProcessError) as error:
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
