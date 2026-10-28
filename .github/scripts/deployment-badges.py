#!/usr/bin/env python3
"""검증한 배포 결과 JSON만 별도 상태 브랜치에 게시한다. 산출물 코드는 실행하지 않는다."""
import datetime
import io
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

DEV = {'data-api', 'realtime', 'business-api', 'notification'}
RULES = {
    '.github/workflows/data-api-ci.dev.yml': ('push', 'main', {'data-api', 'realtime'}, 'dev'),
    '.github/workflows/data-api-cd.dev.yml': ('workflow_dispatch', 'main', {'data-api', 'realtime'}, 'dev'),
    '.github/workflows/realtime-ci.dev.yml': ('push', 'main', {'realtime'}, 'dev'),
    '.github/workflows/satellite-ci.dev.yml': ('push', 'main', {'business-api', 'notification'}, 'dev'),
    '.github/workflows/satellite-cd.dev.yml': ('workflow_run', 'main', {'business-api', 'notification'}, 'dev'),
    '.github/workflows/prod-cd.yml': ('workflow_dispatch', 'release', {'catus'}, 'prod'),
}
BRANCH = 'deployment-status'


def trusted_run(event):
    run = event['workflow_run']
    rule = RULES.get(run.get('path', '').split('@')[0])
    if not rule or run.get('event') != rule[0] or run.get('head_branch') != rule[1]:
        return None
    if (run.get('head_repository') or {}).get('id') != event['repository']['id']:
        return None
    return rule


def validate(records, rule):
    if not isinstance(records, list) or len(records) > 4:
        raise ValueError('배포 결과 목록 오류')
    seen = set()
    for record in records:
        allowed = {'environment', 'service', 'result', 'revision', 'finished_at'}
        if rule[3] == 'prod': allowed |= {'version', 'release_id', 'infra_revision'}
        if set(record) - allowed: raise ValueError('공개 배포 결과에 허용되지 않은 키')
        if record.get('environment') != rule[3] or record.get('service') not in rule[2]:
            raise ValueError('배포 환경/서비스 불일치')
        if record['service'] in seen or record.get('result') not in {'success', 'failure'}:
            raise ValueError('중복 또는 배포 결과 오류')
        seen.add(record['service'])
        if not re.fullmatch('[0-9a-f]{40}', record.get('revision', '')):
            raise ValueError('배포 SHA 오류')
        stamp = datetime.datetime.fromisoformat(record['finished_at'])
        if stamp.tzinfo is None or stamp > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5):
            raise ValueError('배포 시각 오류')
        if rule[3] == 'prod':
            if not re.fullmatch('[0-9a-f]{40}', record.get('infra_revision', '')):
                raise ValueError('Infra SHA 오류')
            if record['result'] != 'success' or not re.fullmatch(r'catus-v[0-9]+\.[0-9]+\.[0-9]+', record.get('version', '')):
                raise ValueError('prod 성공 버전 오류')
            if not re.fullmatch('[0-9a-f]{40}-[0-9]+-[0-9]+', record.get('release_id', '')):
                raise ValueError('prod 릴리스 ID 오류')
    return records


def missing_result(run, rule):
    # CI 실패로 CD가 미실행되거나 결과 업로드에 실패해도 이전 성공을 최신 성공으로 보이지 않게 한다.
    if rule[3] != 'dev' or run.get('conclusion') not in {'failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required'}:
        return []
    return validate([{'environment': 'dev', 'service': service, 'result': 'failure',
                      'revision': run['head_sha'], 'finished_at': run['updated_at'].replace('Z', '+00:00')}
                     for service in sorted(rule[2])], rule)


def merge(state, records):
    state = json.loads(json.dumps(state))
    for record in records:
        key = record['environment'] + '/' + record['service']
        old = state.get(key)
        if old and datetime.datetime.fromisoformat(old['finished_at']) >= datetime.datetime.fromisoformat(record['finished_at']):
            continue
        state[key] = record
    return state


def badges(state):
    base = {'schemaVersion': 1, 'cacheSeconds': 300}
    statuses = [state.get('dev/' + service, {}).get('result') for service in DEV]
    count = statuses.count('success')
    if 'failure' in statuses:
        dev = {'message': f'배포 실패 · 성공 {count}/4', 'color': 'red'}
    elif count == 4:
        dev = {'message': '배포 완료 4/4', 'color': 'brightgreen'}
    else:
        dev = {'message': f'배포 확인 {count}/4', 'color': 'lightgrey'}
    prod = state.get('prod/catus')
    return {'dev.json': {**base, 'label': 'dev 서버', **dev},
            'prod.json': {**base, 'label': 'Catus prod', 'message': prod['version'] if prod else '배포 확인 전',
                          'color': 'brightgreen' if prod else 'lightgrey'},
            'state.json': state}


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and urllib.parse.urlsplit(req.full_url).netloc != urllib.parse.urlsplit(newurl).netloc:
            redirected.remove_header('Authorization')
        return redirected


class GitHub:
    def __init__(self):
        self.base = os.environ.get('GITHUB_API_URL', 'https://api.github.com') + '/repos/' + os.environ['GITHUB_REPOSITORY']
        self.opener = urllib.request.build_opener(SafeRedirect())

    def request(self, path, method='GET', data=None, raw=False):
        request = urllib.request.Request(self.base + path, method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'})
        with self.opener.open(request, timeout=30) as response:
            body = response.read(1024 * 1024 + 1)
            if len(body) > 1024 * 1024:
                raise ValueError('응답 크기 초과')
            return body if raw else json.loads(body)


def publish(api, records):
    for attempt in range(5):
        try:
            tip = api.request('/git/ref/heads/' + BRANCH)['object']['sha']
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            tip = None
        state, base_tree = {}, None
        if tip:
            commit = api.request('/git/commits/' + tip)
            base_tree = commit['tree']['sha']
            tree = api.request('/git/trees/' + base_tree)['tree']
            blob = next((item['sha'] for item in tree if item['path'] == 'state.json'), None)
            if blob:
                import base64
                state = json.loads(base64.b64decode(api.request('/git/blobs/' + blob)['content']))
        updated = merge(state, records)
        if tip and updated == state:
            print('이미 반영된 결과 또는 이전 배포 — 배지 유지')
            return
        payload = {'tree': [{'path': name, 'mode': '100644', 'type': 'blob',
                             'content': json.dumps(value, ensure_ascii=False, sort_keys=True)}
                            for name, value in badges(updated).items()]}
        if base_tree:
            payload['base_tree'] = base_tree
        tree = api.request('/git/trees', 'POST', payload)
        commit = api.request('/git/commits', 'POST', {'message': '배포 상태 배지 갱신',
            'tree': tree['sha'], 'parents': [tip] if tip else []})
        try:
            if tip:
                api.request('/git/refs/heads/' + BRANCH, 'PATCH', {'sha': commit['sha'], 'force': False})
            else:
                api.request('/git/refs', 'POST', {'ref': 'refs/heads/' + BRANCH, 'sha': commit['sha']})
            print('배포 상태 배지 반영 완료')
            return
        except urllib.error.HTTPError as error:
            if error.code not in {409, 422}:
                raise
            time.sleep(attempt + 1)
    raise RuntimeError('상태 브랜치 갱신 충돌 — 재실행 필요')


def artifact_json(api, artifact, expected):
    content = api.request(f'/actions/artifacts/{artifact["id"]}/zip', raw=True)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.namelist() != [expected] or archive.getinfo(expected).file_size > 128 * 1024:
            raise ValueError('배포 결과 산출물 구조 오류')
        return json.loads(archive.read(expected))


def planned_rule(rule, plan):
    if set(plan) != {'business-api', 'notification'} or any(type(value) is not bool for value in plan.values()):
        raise ValueError('위성 배포 대상 형식 오류')
    return (rule[0], rule[1], {service for service, selected in plan.items() if selected}, rule[3])


def cancelled_before_execution(api, run):
    if run.get('conclusion') != 'cancelled':
        return False
    for page in range(1, 101):
        jobs = api.request(f'/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs?per_page=100&page={page}')['jobs']
        if any(step.get('started_at') for job in jobs for step in job.get('steps', [])):
            return False
        if len(jobs) < 100:
            return True
    raise ValueError('취소된 실행 job 페이지 상한 초과')


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    api = GitHub()
    if os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch':
        publish(api, [])
        return
    rule = trusted_run(event)
    if not rule:
        print('허용되지 않은 실행 — 배지 변경 없음')
        return
    run = event['workflow_run']
    # 같은 run_id의 이전 성공 산출물이 재실행 실패를 가리지 않게 시도별 이름을 사용한다.
    name = f'deployment-status-{rule[3]}-{run["run_attempt"]}'
    available = []
    page = 1
    while True:
        response = api.request(f'/actions/runs/{run["id"]}/artifacts?per_page=100&page={page}')['artifacts']
        available.extend(item for item in response if not item['expired'])
        if len(response) < 100:
            break
        page += 1
    artifacts = [item for item in available if item['name'] == name]
    if not artifacts:
        if cancelled_before_execution(api, run):
            print('대기 중 취소된 실행 — 배포 실패로 기록하지 않음')
            return
        if run.get('path', '').split('@')[0] == '.github/workflows/satellite-ci.dev.yml':
            plans = [item for item in available if item['name'] == 'satellite-deploy-plan']
            if not plans:
                print('위성 CI 배포 계획 없음 — 배지 유지')
                return
            plan = artifact_json(api, max(plans, key=lambda item: item['id']), 'satellite-deploy-plan.json')
            rule = planned_rule(rule, plan)
        elif run.get('path', '').split('@')[0] == '.github/workflows/satellite-cd.dev.yml':
            plans = [item for item in available if item['name'] == 'satellite-deploy-record']
            if not plans:
                print('위성 배포 대상 기록 없음 — 배지 유지')
                return
            plan = artifact_json(api, max(plans, key=lambda item: item['id']), 'satellite-deploy-record.json')
            revision = plan.pop('head_sha', '')
            if not re.fullmatch('[0-9a-f]{40}', revision):
                raise ValueError('위성 배포 원본 SHA 오류')
            rule = planned_rule(rule, plan)
            run = {**run, 'head_sha': revision}
        records = missing_result(run, rule)
        if records:
            publish(api, records)
        else:
            print('배포 결과 산출물 없음 — 배지 유지')
        return
    artifact = max(artifacts, key=lambda item: item['id'])
    expected = 'dev.json' if rule[3] == 'dev' else 'deployment-status-prod.json'
    records = validate(artifact_json(api, artifact, expected), rule)
    if rule[0] == 'push' and any(record['revision'] != run['head_sha'] for record in records):
        raise ValueError('dev 결과가 원본 실행 SHA와 다름')
    publish(api, records)


if __name__ == '__main__':
    main()
