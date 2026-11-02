#!/usr/bin/env python3
"""앱 출시 게이트(GROMO-2684): 운영 서버에 아직 없는 서버 실행 코드가 있으면 앱 출시를 막는다.

앱이 서버보다 먼저 나가면 새 API 가 운영에서 404 가 된다. 운영에 배포된 태그(deployment-status 기록)의 커밋과 현재 HEAD 를 비교해
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
# CD 의 record 단계가 성공 배포마다 deployment-status 브랜치에 배포 태그(message)를 기록한다.
# raw CDN 은 최대 5분 늦어 게이트는 contents API 로 읽는다.
RECORD_URL = ('https://api.github.com/repos/OneOrThree/phone/contents/prod-V2/app.json?ref=deployment-status')
RAW = 'application/vnd.github.raw+json'
# record 는 prod-cd-V2.yml 안의 작업이라 실패하면 실행 결론이 success 가 아니다.
# release 의 가장 최근 운영 CD 실행이 끝났고 성공일 때만 위 기록을 믿는다(롤백 뒤 record 실패로 옛 태그가 남는 경우를 막는다).
LATEST_RUN_URL = ('https://api.github.com/repos/OneOrThree/phone/actions/workflows/'
                  'prod-cd-V2.yml/runs?branch=release&per_page=1')
PROD_TAG = re.compile(r'catus-v\d+\.\d+\.\d+-V2')
# 서버 실행 코드 정규식. backoffice/server/release-status.mjs 의 SERVER_RUNTIME 과 같이 고쳐야 한다.
SERVER_RUNTIME = re.compile(r'^server/(business-api|data-api|realtime|notification)/src/main/')
MAX_LISTED = 20


class GateError(Exception):
    pass


def fetch_json(url, accept='application/vnd.github+json'):
    try:
        request = urllib.request.Request(url, headers={'Accept': accept, 'User-Agent': 'app-server-gate'})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)
    except Exception as first:
        # python.org 배포판 파이썬은 macOS 에서 인증서 저장소가 비어 있는 경우가 있어 curl 로 한 번 더 시도한다.
        try:
            out = subprocess.run(['curl', '-fsS', '--max-time', '10', '-H', 'User-Agent: app-server-gate', '-H', f'Accept: {accept}', url],
                                 capture_output=True, text=True, check=True).stdout
            return json.loads(out)
        except Exception:
            raise GateError(f'운영 배포 기록을 조회하지 못했습니다: {first}')


def run_git(*args):
    try:
        return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True, timeout=60).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise GateError(f'git {" ".join(args)} 실패: {getattr(error, "stderr", "") or error}'.strip())


def require_successful_deploy(fetch=fetch_json):
    try:
        run = fetch(LATEST_RUN_URL)['workflow_runs'][0]
        status, conclusion = run['status'], run['conclusion']
    except (KeyError, IndexError, TypeError):
        raise GateError('release 의 최근 운영 CD 실행을 찾지 못해 운영 상태를 확인할 수 없습니다.')
    if status != 'completed' or conclusion != 'success':
        raise GateError(f'release 의 최근 운영 CD 실행이 성공으로 끝나지 않아(상태 {status}, 결론 {conclusion}) '
                        '운영 상태를 확인할 수 없습니다. 배포 기록을 믿을 수 없습니다.')


def production_tag(fetch=fetch_json):
    # 기록 단계(record)가 실패했거나 배포가 진행·취소·실패 중이면 기록이 옛 값일 수 있어 여기서 먼저 막는다.
    require_successful_deploy(fetch)
    try:
        tag = fetch(RECORD_URL, RAW)['message']
    except (KeyError, TypeError):
        raise GateError('운영 배포 기록(deployment-status)에서 태그를 찾지 못했습니다.')
    if not isinstance(tag, str) or not PROD_TAG.fullmatch(tag):
        raise GateError(f'운영 배포 태그 형식이 올바르지 않습니다: {tag!r}')
    return tag


def tag_commit(tag, git=run_git):
    git('fetch', '--quiet', 'origin', f'refs/tags/{tag}:refs/tags/{tag}')
    sha = git('rev-parse', '--verify', f'refs/tags/{tag}^{{commit}}').strip()
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise GateError(f'운영 태그 {tag} 의 커밋을 풀지 못했습니다: {sha!r}')
    return sha


def server_changes(sha, git=run_git):
    # 세 점 비교: 운영 커밋이 release 의 merge 커밋이라 두 점 비교는 이미 반영된 변경까지 잡는다.
    # --no-renames: 이름이 바뀐 파일을 삭제+추가로 내보내 서버 밖으로 옮겨진 옛 경로도 잡는다.
    files = git('diff', '--name-only', '--no-renames', f'{sha}...HEAD').splitlines()
    return [name for name in files if SERVER_RUNTIME.match(name)]


def main(env=None, fetch=fetch_json, git=run_git, out=sys.stdout, err=sys.stderr):
    env = os.environ if env is None else env
    reason = env.get('ALLOW_SERVER_GAP', '').strip()
    if reason:
        print(f'app-server-gate: 서버 선행 검사를 건너뜁니다. 사유: {reason}', file=out)
        return 0
    tag = None
    try:
        tag = production_tag(fetch)
        sha = tag_commit(tag, git)
        changed = server_changes(sha, git)
    except GateError as error:
        print(f'app-server-gate: 판정 불가로 차단합니다 (운영 태그: {tag or "확인 못 함"}). {error}\n'
              '서버 선행 여부를 직접 확인했다면 ALLOW_SERVER_GAP="사유" 를 설정해 다시 실행하세요.', file=err)
        return 1
    if changed:
        listed = '\n'.join(f'  {name}' for name in changed[:MAX_LISTED])
        more = f'\n  … 외 {len(changed) - MAX_LISTED}개' if len(changed) > MAX_LISTED else ''
        print(f'app-server-gate: 운영 서버({tag}, {sha[:7]})에 없는 서버 실행 코드 변경 {len(changed)}파일이 있어 앱 출시를 차단합니다.\n'
              f'{listed}{more}\n'
              '조치: 서버를 먼저 release 로 승격·배포한 뒤 다시 실행하세요. 의도한 예외라면 '
              'ALLOW_SERVER_GAP="사유" 를 설정하세요.', file=err)
        return 1
    print(f'app-server-gate: 통과 (운영 {tag}, 커밋 {sha[:7]})', file=out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
