#!/usr/bin/env python3
"""앱 검증 입력과 플랫폼별 자동 게시 입력을 구분한다."""
import argparse
import json
import io
import zipfile
import os
from pathlib import Path
import re
import subprocess


def runtime_input(path, platform):
    if not path.startswith('app/app-dev/'):
        return False
    relative = path.removeprefix('app/app-dev/')
    if (path.endswith(('.md', '.mdx', '.rst', '.txt'))
            or re.search(r'(^|/)(__tests__|__mocks__|tests|docs|\.docs)/|\.(test|spec)\.[^/]+$', relative)
            or re.search(r'(^|/)jest\.[^/]+$', relative)
            or re.search(r'android/(?:.*/)?src/(test|androidTest)/', relative)):
        return False
    other = 'ios' if platform == 'android' else 'android'
    if path == 'app/app-dev/ios/release-config.sh':
        return True
    if relative.startswith(other + '/') or re.search(r'/'+other+r'/', relative) or re.search(r'\.'+other+r'\.[^/]+$', relative):
        return False
    # 배포 도구 자체를 바꿔도 자동 게시하지 않는다. 수동 실행으로 검증 가능하다.
    if relative.startswith('ios/') and path.endswith(('.sh', '.rb')):
        return False
    return True


def plan(paths, platform):
    publish = any(runtime_input(path, platform) for path in paths)
    build = publish or any(path.startswith('.github/') for path in paths)
    if platform == 'ios':
        build = publish
    return {'build': build, 'publish': publish}


def api(path):
    return json.loads(subprocess.check_output([
        'gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY'] + path,
    ], timeout=20))


def successful_main(run):
    return (run.get('conclusion') == 'success' and run.get('head_branch') == 'main'
            and run.get('event') in {'push', 'workflow_dispatch', 'workflow_run'}
            and str((run.get('head_repository') or {}).get('id')) == os.environ['GITHUB_REPOSITORY_ID'])


def job_steps(run):
    result = []
    for page in range(1, 11):
        jobs = api(f'/actions/runs/{run["id"]}/attempts/{run.get("run_attempt", 1)}/jobs?per_page=100&page={page}')['jobs']
        result.extend(step for job in jobs if job.get('conclusion') == 'success' for step in job.get('steps', []))
        if len(jobs) < 100:
            return result
    raise ValueError('게시 검사 job 페이지 상한 초과')


def publication_record(run, platform, artifact=None):
    records = [artifact] if artifact else api(f'/actions/runs/{run["id"]}/artifacts?per_page=100')['artifacts']
    records = [item for item in records if item['name'] == 'app-publication' and not item['expired']]
    if not records:
        return None
    latest = max(records, key=lambda item: item['id'])
    content = subprocess.check_output(['gh', 'api', 'repos/' + os.environ['GITHUB_REPOSITORY']
                                      + f'/actions/artifacts/{latest["id"]}/zip'], timeout=20)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.namelist() != ['app-publication.json']:
            raise ValueError('앱 게시 기록 ZIP 형식 오류')
        record = json.loads(archive.read('app-publication.json'))
    if record.get('platform') != platform:
        raise ValueError('앱 게시 기록 플랫폼 불일치')
    return record.get('revision', '')


def published_revision(platform, head):
    primary = 'app-android-cd.yml' if platform == 'android' else 'app-ios-testflight-dev.yml'
    # 게시 기록을 직접 조회해 검증 전용 성공 실행이 많아도 실제 게시 기준을 놓치지 않는다.
    artifacts = api('/actions/artifacts?name=app-publication&per_page=100')['artifacts']
    for artifact in sorted(artifacts, key=lambda item: item['id'], reverse=True):
        run_id = (artifact.get('workflow_run') or {}).get('id')
        if artifact['expired'] or not run_id:
            continue
        run = api(f'/actions/runs/{run_id}')
        if not successful_main(run) or run.get('path', '').split('@')[0] != '.github/workflows/' + primary:
            continue
        revision = publication_record(run, platform, artifact)
        if not isinstance(revision, str) or not re.fullmatch('[0-9a-f]{40}', revision):
            raise ValueError('앱 게시 기록 SHA 형식 오류')
        if subprocess.run(['git', 'merge-base', '--is-ancestor', revision, head],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            return revision
    workflows = ['app-android-ci.yml'] if platform == 'android' else [primary]
    for workflow in workflows:
        runs = api(f'/actions/workflows/{workflow}/runs?branch=main&status=success&per_page=20')['workflow_runs']
        for run in runs:
            if not successful_main(run):
                continue
            if run.get('event') not in {'push', 'workflow_dispatch'}:
                continue
            revision = publication_record(run, platform)
            if revision is None:
                # 기록 도입 전의 실제 게시 성공만 인정한다. AAB·검증 전용 성공은 기준이 아니다.
                step_name = '업로드 확인 (internal 트랙 재조회)' if platform == 'android' else 'dev TestFlight 빌드·업로드'
                if workflow == 'app-android-cd.yml' or not any(
                        step['name'] == step_name and step.get('conclusion') == 'success' for step in job_steps(run)):
                    continue
                revision = run['head_sha']
            if not re.fullmatch('[0-9a-f]{40}', revision):
                raise ValueError('앱 게시 기록 SHA 형식 오류')
            if subprocess.run(['git', 'merge-base', '--is-ancestor', revision, head],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                return revision
    raise ValueError('성공한 앱 게시 기준을 확인할 수 없습니다. main 수동 게시로 기준을 초기화하세요.')


def changed_paths(event, event_name, platform=None):
    if event_name == 'push':
        after = event['after']
        before = published_revision(platform, after) if platform else event['before']
        separator = '..'
    elif event_name == 'pull_request':
        before, after = event['pull_request']['base']['sha'], event['pull_request']['head']['sha']
        separator = '...'
    else:
        raise ValueError('변경 범위를 확인할 수 없는 이벤트')
    if any(not re.fullmatch('[0-9a-f]{40}', sha) or sha == '0' * 40 for sha in (before, after)):
        raise ValueError('변경 범위 SHA 오류')
    return [path for path in subprocess.check_output([
        'git', 'diff', '--no-renames', '--name-only', '-z', before + separator + after, '--',
    ]).decode().split('\0') if path]


def push_plan(event, platform):
    # 검증은 이번 push, 게시는 마지막 실제 게시 이후의 미게시 런타임 입력을 기준으로 한다.
    current = plan(changed_paths(event, 'push'), platform)
    pending = plan(changed_paths(event, 'push', platform), platform)
    return {'build': current['build'] or pending['publish'], 'publish': pending['publish']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['android', 'ios'], required=True)
    parser.add_argument('--record', action='store_true')
    args = parser.parse_args()
    if args.record:
        revision = os.environ.get('PUBLISHED_REVISION', os.environ['GITHUB_SHA'])
        if not re.fullmatch('[0-9a-f]{40}', revision):
            raise ValueError('게시 기록 SHA 형식 오류')
        Path('app-publication.json').write_text(json.dumps({'platform': args.platform, 'revision': revision}) + '\n')
        return
    event_name = os.environ['GITHUB_EVENT_NAME']
    if event_name == 'workflow_dispatch':
        # CI 수동 검증도 자동 게시하지 않는다. CD의 명시적 수동 실행은 별도 허용한다.
        result = {'build': True, 'publish': False}
    else:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        result = push_plan(event, args.platform) if event_name == 'push' else plan(changed_paths(event, event_name), args.platform)
        if event_name == 'pull_request':
            result['publish'] = False
    print(json.dumps(result))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        for key, value in result.items():
            output.write(f'{key}={str(value).lower()}\n')


if __name__ == '__main__':
    main()
