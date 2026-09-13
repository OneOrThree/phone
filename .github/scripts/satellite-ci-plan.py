#!/usr/bin/env python3
"""PR 변경 입력으로 위성 전체 검사·이미지를 선택한다. 계약 검사는 별도로 유지한다."""
import json
import os
from pathlib import Path
import subprocess

SERVICES = ('business-api', 'notification')


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
        elif path.startswith(('docs/', 'app/', 'server/realtime/')) or path in ('README.md', 'AGENTS.md', 'CLAUDE.md'):
            continue
        else:
            # 공통 CI·배포 설정과 아직 분류하지 않은 입력은 두 서비스 모두 검사한다.
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
