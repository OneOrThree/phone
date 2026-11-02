#!/usr/bin/env python3
"""앱 출시 게이트(GROMO-2684): 운영 서버에 아직 없는 서버 실행 코드가 있으면 앱 출시를 막는다.

앱이 서버보다 먼저 나가면 새 API 가 운영에서 404 가 된다. 운영에 배포된 커밋과 현재 HEAD 를 비교해
서버 실행 코드가 다르면 exit 1. 조회·git 이 실패해도 판정할 수 없으므로 exit 1(fail closed).
표준 라이브러리만 쓴다.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS_URL = ('https://api.github.com/repos/OneOrThree/phone/actions/workflows/'
            'prod-cd-V2.yml/runs?status=success&per_page=1')
# 서버 실행 코드 정규식. backoffice/server/release-status.mjs 의 SERVER_RUNTIME 과 같이 고쳐야 한다.
SERVER_RUNTIME = re.compile(r'^server/(business-api|data-api|realtime|notification)/src/main/')
MAX_LISTED = 20


class GateError(Exception):
    pass


def fetch_json(url):
    try:
        request = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'app-server-gate'})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    except Exception as first:
        # python.org 배포판 파이썬은 macOS 에서 인증서 저장소가 비어 있는 경우가 있어 curl 로 한 번 더 시도한다.
        try:
            out = subprocess.run(['curl', '-fsS', '--max-time', '10', '-H', 'User-Agent: app-server-gate', url],
                                 capture_output=True, text=True, check=True).stdout
            return json.loads(out)
        except Exception:
            raise GateError(f'운영 배포 기록을 조회하지 못했습니다: {first}')


def run_git(*args):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise GateError(f'git {" ".join(args)} 실패: {getattr(error, "stderr", "") or error}'.strip())


def production_commit(fetch=fetch_json):
    # ponytail: 롤백 실행이면 실제 실행 커밋이 아니라 release 끝 커밋이다.
    # 정확한 값은 S3 current-V2.json 이지만 AWS 권한이 필요하다.
    try:
        sha = fetch(RUNS_URL)['workflow_runs'][0]['head_sha']
    except (KeyError, IndexError, TypeError):
        raise GateError('운영 배포 기록에서 성공한 실행을 찾지 못했습니다.')
    if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise GateError(f'운영 커밋 형식이 올바르지 않습니다: {sha!r}')
    return sha


def server_changes(sha, git=run_git):
    git('fetch', '--quiet', 'origin', 'release')
    # 세 점 비교: 운영 커밋이 release 의 merge 커밋이라 두 점 비교는 이미 반영된 변경까지 잡는다.
    files = git('diff', '--name-only', f'{sha}...HEAD').splitlines()
    return [name for name in files if SERVER_RUNTIME.match(name)]


def main(env=None, fetch=fetch_json, git=run_git, out=sys.stdout, err=sys.stderr):
    env = os.environ if env is None else env
    reason = env.get('ALLOW_SERVER_GAP', '').strip()
    if reason:
        print(f'app-server-gate: 서버 선행 검사를 건너뜁니다. 사유: {reason}', file=out)
        return 0
    try:
        sha = production_commit(fetch)
        changed = server_changes(sha, git)
    except GateError as error:
        print(f'app-server-gate: 판정 불가로 차단합니다. {error}\n'
              '서버 선행 여부를 직접 확인했다면 ALLOW_SERVER_GAP="사유" 를 설정해 다시 실행하세요.', file=err)
        return 1
    if changed:
        listed = '\n'.join(f'  {name}' for name in changed[:MAX_LISTED])
        more = f'\n  … 외 {len(changed) - MAX_LISTED}개' if len(changed) > MAX_LISTED else ''
        print(f'app-server-gate: 운영 서버({sha[:7]})에 없는 서버 실행 코드 변경 {len(changed)}파일이 있어 앱 출시를 차단합니다.\n'
              f'{listed}{more}\n'
              '조치: 서버를 먼저 release 로 승격·배포한 뒤 다시 실행하세요. 의도한 예외라면 '
              'ALLOW_SERVER_GAP="사유" 를 설정하세요.', file=err)
        return 1
    print(f'app-server-gate: 통과 (운영 커밋 {sha[:7]})', file=out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
