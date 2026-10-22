#!/usr/bin/env python3
"""main 커밋에 필요한 CI·dev 배포만 기다린다. 배포 잠금은 대기 중 잡지 않는다."""
import json
from pathlib import Path
import subprocess
import os
import re
import time
import urllib.parse
import urllib.request

WORKFLOWS = ('data-api-ci.dev.yml', 'realtime-ci.dev.yml', 'satellite-ci.dev.yml')
SATELLITE_CONTEXT = 'dev-deploy/satellites'


def observed_workflows(runs, revision):
    # GitHub 자체 경로 필터·대규모 push 제한을 재현하지 않는다.
    return {run.get('path', '').split('@')[0].rsplit('/', 1)[-1]
            for run in runs if run.get('event') == 'push'
            and run.get('head_branch') == 'main' and run.get('head_sha') == revision
            and run.get('path', '').split('@')[0].rsplit('/', 1)[-1] in WORKFLOWS}


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


def path_matches(path, pattern):
    # Actions 경로 필터의 *, **, ?를 슬래시 경계까지 구분한다.
    expression = ''
    i = 0
    while i < len(pattern):
        if pattern[i:i + 3] == '**/':
            expression += '(?:.*/)?'; i += 3
        elif pattern[i:i + 2] == '**':
            expression += '.*'; i += 2
        elif pattern[i] == '*':
            expression += '[^/]*'; i += 1
        elif pattern[i] == '?':
            expression += '[^/]'; i += 1
        else:
            expression += re.escape(pattern[i]); i += 1
    return re.fullmatch(expression, path) is not None


def matches_paths(paths, patterns):
    for path in paths:
        included = False
        for pattern in patterns:
            negative = pattern.startswith('!')
            if path_matches(path, pattern[1:] if negative else pattern):
                included = not negative
        if included:
            return True
    return False


def satellite_expected(revision):
    import yaml
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    before = event['before']
    if os.environ.get('GITHUB_EVENT_NAME') != 'push' or event.get('after') != revision or not re.fullmatch('[0-9a-f]{40}', before):
        raise RuntimeError('main push 변경 범위를 확인할 수 없습니다.')
    changed = subprocess.check_output(['git', 'diff', '--no-renames', '--name-only', '-z', before, revision, '--'])
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.load((root / '.github/workflows/satellite-ci.dev.yml').read_text(), Loader=yaml.BaseLoader)
    return matches_paths([path for path in changed.decode().split('\0') if path], workflow['on']['push']['paths'])


def main():
    revision = os.environ['GITHUB_SHA']
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise RuntimeError('커밋 SHA 형식 오류')
    satellite_only = os.environ.get('DEPLOY_WAIT_SATELLITES_ONLY') == 'true'
    expected_id = None
    if satellite_only:
        if not satellite_expected(revision):
            print('push 변경 경로에 위성 CI 대상이 없어 선행 대기를 생략합니다.', flush=True)
            return 0
        expected_id = api('/actions/workflows/satellite-ci.dev.yml')['id']
    deadline = time.monotonic() + int(os.environ.get('SMOKE_DEPLOY_WAIT_SECONDS', '10800'))
    # 등록 지연을 기다린 뒤 실제 생성된 run만 대상으로 삼는다. 신규 대상 발견 시
    # 안정화 시간을 다시 센다. pending/queued run도 등록된 즉시 대기에 포함한다.
    quiet_seconds = int(os.environ.get('SMOKE_DEPLOY_DISCOVERY_SECONDS', '120'))
    quiet_since = time.monotonic()
    expected = {'satellite-ci.dev.yml'} if satellite_only else set()
    previous = None
    while True:
        runs = pages('/actions/runs?head_sha=' + urllib.parse.quote(revision), 'workflow_runs')
        if satellite_only:
            runs = [run for run in runs if run.get('workflow_id') == expected_id]
        discovered = observed_workflows(runs, revision)
        if satellite_only:
            discovered &= {'satellite-ci.dev.yml'}
        if discovered - expected:
            expected |= discovered
            quiet_since = time.monotonic()
            print('실제 생성된 대기 대상: ' + ', '.join(sorted(expected)), flush=True)
        statuses = pages('/commits/' + revision + '/statuses') if 'satellite-ci.dev.yml' in expected else []
        state, reason = verdict(expected, runs, statuses, revision)
        if reason != previous:
            print(reason, flush=True); previous = reason
        if state == 'failure':
            return 1
        if state == 'success' and time.monotonic() - quiet_since >= quiet_seconds:
            return 0
        if time.monotonic() >= deadline:
            print('CI·배포 대기 시간 초과', flush=True)
            return 1
        time.sleep(30)


if __name__ == '__main__':
    raise SystemExit(main())
