#!/usr/bin/env python3
"""CD 자격 증명 사용 전에 원본 CI·main 이력·시도별 산출물을 검증한다."""
import json
import os
from pathlib import Path
import re
import subprocess


def validate(run, repository_id, workflow_id, expected_attempt=None):
    if (run.get('path', '').split('@')[0] != '.github/workflows/app-android-ci.yml'
            or run.get('workflow_id') != workflow_id
            or (run.get('head_repository') or {}).get('id') != repository_id
            or run.get('head_branch') != 'main'
            or run.get('event') not in {'push', 'workflow_dispatch'}
            or run.get('status') != 'completed' or run.get('conclusion') != 'success'):
        raise ValueError('성공한 동일 저장소 main Android CI만 게시할 수 있다')
    if expected_attempt is not None and run.get('run_attempt') != expected_attempt:
        raise ValueError('원본 CI가 다른 attempt로 재실행됨')
    if not re.fullmatch('[0-9a-f]{40}', run.get('head_sha', '')) or any(
            type(run.get(key)) is not int or run[key] <= 0 for key in ('id', 'run_attempt')):
        raise ValueError('원본 CI 식별자 오류')
    return {key: run[key] for key in ('id', 'run_attempt', 'head_sha')}


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY'] + path]))


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if os.environ['GITHUB_REF'] != 'refs/heads/main':
        raise ValueError('Android CD 실행 브랜치는 main이어야 한다')
    expected_attempt = None
    if os.environ['GITHUB_EVENT_NAME'] == 'workflow_run':
        source = event['workflow_run']
        run_id = str(source['id'])
        expected_attempt = source['run_attempt']
    elif os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch':
        run_id = os.environ['CI_RUN_ID']
    else:
        raise ValueError('허용되지 않은 CD 이벤트')
    if not re.fullmatch('[1-9][0-9]*', run_id):
        raise ValueError('CI run ID는 양의 정수여야 한다')
    run = api('/actions/runs/' + run_id)
    workflow_id = api('/actions/workflows/app-android-ci.yml')['id']
    source = validate(run, int(os.environ['GITHUB_REPOSITORY_ID']), workflow_id, expected_attempt)
    if api('/compare/' + source['head_sha'] + '...main').get('status') not in {'ahead', 'identical'}:
        raise ValueError('원본 CI SHA가 현재 main 이력에 없음')
    # 테스트 전용 변경은 CI가 성공해도 AAB job을 의도적으로 생략한다.
    # 원본 attempt의 실제 job 결과를 확인하고, 이 경우 CD도 성공적으로 생략한다.
    builds = []
    for page in range(1, 101):
        batch = api(f'/actions/runs/{run_id}/attempts/{source["run_attempt"]}/jobs?per_page=100&page={page}')['jobs']
        builds.extend(job for job in batch if job['name'] == 'release AAB 빌드')
        if len(batch) < 100:
            break
    else:
        raise ValueError('Android CI job 페이지 상한 초과')
    if len(builds) != 1 or builds[0]['conclusion'] not in {'success', 'skipped'}:
        raise ValueError('원본 CI의 AAB job 결과가 없거나 모호함')
    if builds[0]['conclusion'] == 'skipped':
        with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
            file.write('has-artifact=false\n')
        print('검증 전용 CI에서 AAB 생략 — Android CD도 생략')
        return
    name = f'android-ci-{source["id"]}-{source["run_attempt"]}'
    artifacts = []
    for page in range(1, 101):
        batch = api(f'/actions/runs/{run_id}/artifacts?per_page=100&page={page}')['artifacts']
        artifacts.extend(item for item in batch if item['name'] == name and not item['expired'])
        if len(batch) < 100:
            break
    else:
        raise ValueError('Android 산출물 페이지 상한 초과')
    if len(artifacts) != 1:
        raise ValueError('현재 CI attempt의 AAB 산출물이 없거나 모호함')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as file:
        for key, value in {'has-artifact': 'true', 'run-id': source['id'], 'attempt': source['run_attempt'],
                           'revision': source['head_sha'], 'artifact-name': name}.items():
            file.write(f'{key}={value}\n')


if __name__ == '__main__':
    main()
