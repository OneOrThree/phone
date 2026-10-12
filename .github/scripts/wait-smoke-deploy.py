#!/usr/bin/env python3
"""main 커밋에 필요한 CI·dev 배포만 기다린다. 배포 잠금은 대기 중 잡지 않는다."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import urllib.request

WORKFLOWS = ('data-api-ci.dev.yml', 'realtime-ci.dev.yml', 'satellite-ci.dev.yml')
SATELLITE_CONTEXT = 'dev-deploy/satellites'


def glob_match(path, pattern):
    parts = []
    i = 0
    while i < len(pattern):
        if pattern[i:i + 3] == '**/':
            parts.append('(?:.*/)?'); i += 3
        elif pattern[i:i + 2] == '**':
            parts.append('.*'); i += 2
        elif pattern[i] == '*':
            parts.append('[^/]*'); i += 1
        elif pattern[i] == '?':
            parts.append('[^/]'); i += 1
        else:
            parts.append(re.escape(pattern[i])); i += 1
    return re.fullmatch(''.join(parts), path) is not None


def selected(path, patterns):
    matched = False
    for pattern in patterns:
        negative = pattern.startswith('!')
        if glob_match(path, pattern[1:] if negative else pattern):
            matched = not negative
    return matched


def expected_workflows(root, files):
    import yaml  # repository CI와 같은 pinned PyYAML, 이 대기 잡에서만 사용
    expected = set()
    for name in WORKFLOWS:
        workflow = yaml.load((root / '.github/workflows' / name).read_text(), Loader=yaml.BaseLoader)
        push = workflow['on']['push']
        if 'main' not in push.get('branches', []):
            raise RuntimeError('CI main 트리거 계약 변경: ' + name)
        patterns = push.get('paths', ['**'])
        if any(selected(file, patterns) for file in files):
            expected.add(name)
    return expected


def api(path):
    url = os.environ.get('GITHUB_API_URL', 'https://api.github.com')
    request = urllib.request.Request(url + '/repos/' + os.environ['GITHUB_REPOSITORY'] + path,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def pages(path, key=None):
    result = []
    for page in range(1, 101):
        separator = '&' if '?' in path else '?'
        payload = api(f'{path}{separator}per_page=100&page={page}')
        items = payload[key] if key else payload
        result.extend(items)
        if len(items) < 100:
            return result
    raise RuntimeError('GitHub 결과 페이지 상한 초과')


def verdict(expected, runs, statuses, revision):
    current = {}
    for run in runs:
        name = run.get('path', '').split('@')[0].rsplit('/', 1)[-1]
        if name not in expected or run.get('event') != 'push' or run.get('head_branch') != 'main' or run.get('head_sha') != revision:
            continue
        if name not in current or (run['id'], run.get('run_attempt', 1)) > (current[name]['id'], current[name].get('run_attempt', 1)):
            current[name] = run
    for name in sorted(expected):
        run = current.get(name)
        if not run or run['status'] != 'completed':
            return 'waiting', name + ' CI·배포 대기'
        if run['conclusion'] != 'success':
            return 'failure', name + ' CI·배포 실패: ' + str(run['conclusion'])
    # Data·Realtime CD는 해당 CI run 안에 있다. Satellite CD는 별도 workflow_run이므로
    # 원본 CI id/attempt에 연결된 완료 상태를 반드시 확인한다(현재 main SHA와 달라도 식별 가능).
    satellite = current.get('satellite-ci.dev.yml')
    if satellite:
        prefix = f"Satellite CI {satellite['id']}/{satellite.get('run_attempt', 1)}:"
        status = next((s for s in statuses if s['context'] == SATELLITE_CONTEXT and (s.get('description') or '').startswith(prefix)), None)
        if not status or status['state'] == 'pending':
            return 'waiting', 'Satellite dev 배포 완료 대기'
        if status['state'] != 'success':
            return 'failure', 'Satellite dev 배포 실패'
    return 'success', '대상 커밋의 필요한 CI·dev 배포 완료'


def main():
    revision = os.environ['GITHUB_SHA']
    before = os.environ['SMOKE_BEFORE_SHA']
    if not all(re.fullmatch('[0-9a-f]{40}', value) for value in (revision, before)):
        raise RuntimeError('커밋 SHA 형식 오류')
    args = ['git', 'ls-tree', '-r', '--name-only', revision] if before == '0' * 40 else ['git', 'diff', '--name-only', before, revision]
    files = subprocess.check_output(args, text=True).splitlines()
    root = Path(__file__).resolve().parents[2]
    expected = expected_workflows(root, files)
    print('대기 대상: ' + (', '.join(sorted(expected)) or '서비스 배포 변경 없음'), flush=True)
    deadline = time.monotonic() + int(os.environ.get('SMOKE_DEPLOY_WAIT_SECONDS', '3600'))
    previous = None
    while True:
        runs = pages('/actions/runs?head_sha=' + urllib.parse.quote(revision), 'workflow_runs') if expected else []
        statuses = pages('/commits/' + revision + '/statuses') if 'satellite-ci.dev.yml' in expected else []
        state, reason = verdict(expected, runs, statuses, revision)
        if reason != previous:
            print(reason, flush=True); previous = reason
        if state != 'waiting':
            return 0 if state == 'success' else 1
        if time.monotonic() >= deadline:
            print('CI·배포 대기 시간 초과', flush=True)
            return 1
        time.sleep(30)


if __name__ == '__main__':
    raise SystemExit(main())
