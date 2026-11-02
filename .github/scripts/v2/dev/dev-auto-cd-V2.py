#!/usr/bin/env python3
"""main 최신 커밋 기준으로 배포할 dev V2 런타임과 앱을 정해 워크플로 job에 넘긴다."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).parent
REPO = 'OneOrThree/phone'
BUCKET = 'gs://catus-dev-v2-deploy-263851348176'
# 앱 배포 전에 모두 끝나야 한다.
RUNTIMES = ('redis', 'kafka', 'postgres')
# 같은 VM은 apply.sh 호스트 잠금이 대기 없이 실패. 병렬은 VM 단위.
RUNTIME_HOST = {'redis': 'redis', 'kafka': 'data', 'postgres': 'data'}
CORE_CI, SATELLITE_CI = 'data-api-ci.dev-v2.yml', 'satellite-ci.dev-v2.yml'
SERVICE_CI = {'data-api': CORE_CI, 'realtime': CORE_CI, 'business-api': SATELLITE_CI, 'notification': SATELLITE_CI}


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE/file)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


def output(args):
    return subprocess.run(args, cwd=ROOT, check=True, stdout=subprocess.PIPE, text=True).stdout


def runtime_paths(role):
    return [f'server/scripts/v2/dev/{role}', 'server/scripts/v2/dev/common', '.github/scripts/v2/dev/dev-publish-runtime-V2.py']


def same_runtime(role, before, after):
    return subprocess.run(['git', 'diff', '--quiet', before, after, '--', *runtime_paths(role)], cwd=ROOT).returncode == 0


def is_ancestor(before, after):
    return subprocess.run(['git', 'merge-base', '--is-ancestor', before, after], cwd=ROOT, capture_output=True).returncode == 0


def ci_status(runs):
    """최신 실행 하나로 판정. 반환 (상태, run id)."""
    if not runs: return 'missing', None
    latest = max(runs, key=lambda run: (run['run_number'], run.get('run_attempt', 1)))
    if latest['status'] != 'completed': return 'running', None
    if latest['conclusion'] == 'success': return 'success', latest['id']
    # 취소는 코드 실패가 아니다. 새 실행으로 메운다.
    return ('missing', None) if latest['conclusion'] == 'cancelled' else ('failed', None)


def ci_for(workflow, revision):
    path = f'repos/{REPO}/actions/workflows/{workflow}/runs?branch=main&head_sha={revision}&per_page=30'
    runs = json.loads(output(['gh', 'api', path]))['workflow_runs']
    return ci_status([run for run in runs if run['event'] in ('push', 'workflow_dispatch')])


def dispatch(workflow):
    # 경로 필터로 이 커밋 CI가 없을 때 실행. 토큰 실행은 workflow_run이 안 깨우므로 CI 끝 job이 다시 호출.
    output(['gh', 'workflow', 'run', workflow, '--repo', REPO, '--ref', 'main'])


def emit(**values):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
        for key, value in values.items(): stream.write(f'{key}={value}\n')


def note(message):
    print(message)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        # 요약은 마크다운이다. 목록으로 써야 줄마다 따로 보인다.
        with open(summary, 'a') as stream: stream.write('- ' + message + '\n')


def manifests(lines, pattern):
    """`gcloud storage ls -l` 출력의 manifest 주소. 최신순."""
    rows = []
    for line in lines.splitlines():
        parts = line.split()
        if len(parts) == 3 and re.fullmatch(pattern, parts[2]): rows.append((parts[1], parts[2]))
    return [uri for _, uri in sorted(rows, reverse=True)]


def listing(prefix):
    result = subprocess.run(['gcloud', 'storage', 'ls', '-l', prefix], capture_output=True, text=True)
    if result.returncode == 0: return result.stdout
    # 산출물 없음만 빈 목록. 조회 실패를 없음으로 보면 재발행이 반복된다.
    if 'matched no objects' in result.stderr: return ''
    raise RuntimeError('dev V2 산출물 목록 조회 실패')


def runtime_manifest(role, revision):
    pattern = re.escape(BUCKET) + f'/releases/{role}/[0-9a-f]{{40}}-[0-9]+-[0-9]+/manifest\\.json'
    for uri in manifests(listing(f'{BUCKET}/releases/{role}/*/manifest.json'), pattern):
        published = uri.split('/')[-2].split('-')[0]
        if is_ancestor(published, revision) and same_runtime(role, published, revision): return uri
    return None


def plan_runtimes(state, revision):
    """반환 (배포 대상, 전부 준비 여부). 준비 안 됐으면 앱은 이번 실행에서 제외."""
    targets, ready = [], True
    for role in RUNTIMES:
        state.URI = f'{BUCKET}/deployments/{role}/current.json'
        previous, _ = state.read()
        if previous and same_runtime(role, previous['revision'], revision):
            note(f'{role} 런타임 변경 없음')
            continue
        uri = runtime_manifest(role, revision)
        if uri:
            targets.append({'role': role, 'uri': uri})
            continue
        ready = False
        workflow = f'{role}-ci.dev-v2.yml'
        status, _ = ci_for(workflow, revision)
        if status == 'failed': raise RuntimeError(role + ' CI 실패')
        # 성공했는데 산출물이 없으면 재실행으로 해결되지 않는다. 반복 대신 실패.
        if status == 'success': raise RuntimeError(role + ' CI는 성공했지만 일치하는 산출물이 없습니다')
        if status == 'missing': dispatch(workflow)
        note(f'{role} 런타임 산출물 대기: {workflow} ' + ('실행 요청' if status == 'missing' else '진행 중'))
    state.URI = f'{BUCKET}/deployments/app/current.json'
    return targets, ready


def host_groups(targets):
    groups = {}
    for target in targets:
        groups.setdefault(RUNTIME_HOST[target['role']], []).append(target)
    return [{'host': host, 'targets': items} for host, items in groups.items()]


def deploy_group(targets):
    # 배포 결과 JSON을 실행 로그에 남긴다.
    for target in targets:
        subprocess.run([sys.executable, str(HERE/'dev-deploy-runtime-V2.py'), '--role', target['role'],
                        '--manifest-uri', target['uri']], cwd=ROOT, check=True)


def plan_app(state, revision):
    """앱 배포 인자. 대상 없음·이미지 대기면 None."""
    published = manifests(listing(f'{BUCKET}/infra/*/manifest.json'),
                          re.escape(BUCKET) + r'/infra/[0-9a-f]{40}-[0-9]+-[0-9]+/manifest\.json')
    if not published: raise RuntimeError('발행된 Infra 산출물이 없습니다')
    infra = published[0]
    previous, _ = state.read()
    plan = load('auto_plan', 'dev-plan-V2.py').plan(load('auto_fp', 'dev-fingerprint-V2.py').fingerprint(revision),
                                                    previous, revision, infra.split('/')[-2].split('-')[0])
    if not plan['deploy_services']:
        note('앱 배포 대상 없음')
        return None
    runs, waiting = {}, False
    for workflow in sorted({SERVICE_CI[service] for service in plan['build_services']}):
        status, run_id = ci_for(workflow, revision)
        if status == 'failed': raise RuntimeError(workflow + ' 실패')
        if status == 'success':
            runs[workflow] = str(run_id)
            continue
        waiting = True
        if status == 'missing': dispatch(workflow)
        note(f'앱 이미지 대기: {workflow} ' + ('실행 요청' if status == 'missing' else '진행 중'))
    if waiting:
        note('이미지 CI 대기. 완료 시 다시 실행')
        return None
    note('앱 배포 대상: ' + ','.join(plan['deploy_services']))
    return {'infra': infra, 'core_run': runs.get(CORE_CI, ''), 'satellite_run': runs.get(SATELLITE_CI, ''),
            'deploy_services': json.dumps(plan['deploy_services'], separators=(',', ':')),
            'build_services': json.dumps(plan['build_services'], separators=(',', ':'))}


def main():
    revision = os.environ['GITHUB_SHA']
    if os.environ.get('GITHUB_REF') != 'refs/heads/main': raise ValueError('main 배포만 허용합니다')
    # 대기 중 main이 앞서면 낡은 실행. 최신 커밋 기준으로 다시 시작.
    latest = output(['git', 'ls-remote', 'origin', 'refs/heads/main']).split()[0]
    if latest != revision:
        dispatch('cd-auto.dev-v2.yml')
        note(f'main이 {latest}로 앞서 최신 기준으로 다시 실행')
        emit(runtimes='[]')
        return
    state = load('auto_state', 'dev-state-V2.py')
    targets, ready = plan_runtimes(state, revision)
    app = plan_app(state, revision) if ready else None
    if not ready: note('런타임 발행 대기. CI 완료 시 다시 실행')
    note('런타임 배포 대상: ' + (','.join(target['role'] for target in targets) or '없음'))
    emit(runtimes=json.dumps(host_groups(targets), separators=(',', ':')), **(app or {}))


if __name__ == '__main__':
    if len(sys.argv) > 1: deploy_group(json.loads(sys.argv[1]))
    else: main()
