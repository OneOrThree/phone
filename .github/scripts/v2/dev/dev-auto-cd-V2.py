#!/usr/bin/env python3
"""main 최신 커밋 기준으로 필요한 dev V2 런타임과 앱만 순서대로 자동 배포한다."""
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
# 선행 저장소 순서. 앱 배포 전에 모두 끝나야 한다.
RUNTIMES = ('redis', 'kafka', 'postgres')
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
    return ('success', latest['id']) if latest['conclusion'] == 'success' else ('failed', None)


def ci_for(workflow, revision):
    path = f'repos/{REPO}/actions/workflows/{workflow}/runs?branch=main&head_sha={revision}&per_page=30'
    runs = json.loads(output(['gh', 'api', path]))['workflow_runs']
    return ci_status([run for run in runs if run['event'] in ('push', 'workflow_dispatch')])


def dispatch(workflow):
    # 경로 필터로 이 커밋 CI가 없을 때 실행. 완료되면 이 워크플로가 다시 시작된다.
    output(['gh', 'workflow', 'run', workflow, '--repo', REPO, '--ref', 'main'])


def newest_manifest(lines, pattern):
    """`gcloud storage ls -l` 출력에서 가장 최근 manifest 주소."""
    rows = []
    for line in lines.splitlines():
        parts = line.split()
        if len(parts) == 3 and re.fullmatch(pattern, parts[2]): rows.append((parts[1], parts[2]))
    return max(rows)[1] if rows else None


def listing(prefix):
    result = subprocess.run(['gcloud', 'storage', 'ls', '-l', prefix], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ''


def runtime_manifest(role, revision):
    pattern = re.escape(BUCKET) + f'/releases/{role}/[0-9a-f]{{40}}-[0-9]+-[0-9]+/manifest\\.json'
    uri = newest_manifest(listing(f'{BUCKET}/releases/{role}/*/manifest.json'), pattern)
    if uri is None: return None
    published = uri.split('/')[-2].split('-')[0]
    return uri if is_ancestor(published, revision) and same_runtime(role, published, revision) else None


def deploy_runtimes(state, revision):
    """전부 최신이면 True. 발행 대기 중이면 False."""
    ready = True
    for role in RUNTIMES:
        state.URI = f'{BUCKET}/deployments/{role}/current.json'
        previous, _ = state.read()
        if previous and same_runtime(role, previous['revision'], revision): continue
        uri = runtime_manifest(role, revision)
        if uri:
            output([sys.executable, str(HERE/'dev-deploy-runtime-V2.py'), '--role', role, '--manifest-uri', uri])
            continue
        ready = False
        status, _ = ci_for(f'{role}-ci.dev-v2.yml', revision)
        if status == 'failed': raise RuntimeError(role + ' CI 실패')
        if status != 'running': dispatch(f'{role}-ci.dev-v2.yml')
    state.URI = f'{BUCKET}/deployments/app/current.json'
    return ready


def main():
    revision = os.environ['GITHUB_SHA']
    if os.environ.get('GITHUB_REF') != 'refs/heads/main': raise ValueError('main 배포만 허용합니다')
    state = load('auto_state', 'dev-state-V2.py')
    if not deploy_runtimes(state, revision):
        print('런타임 발행 대기. CI 완료 시 다시 실행')
        return
    infra = newest_manifest(listing(f'{BUCKET}/infra/*/manifest.json'),
                            re.escape(BUCKET) + r'/infra/[0-9a-f]{40}-[0-9]+-[0-9]+/manifest\.json')
    if infra is None: raise RuntimeError('발행된 Infra 산출물이 없습니다')
    previous, _ = state.read()
    plan = load('auto_plan', 'dev-plan-V2.py').plan(load('auto_fp', 'dev-fingerprint-V2.py').fingerprint(revision),
                                                    previous, revision, infra.split('/')[-2].split('-')[0])
    if not plan['deploy_services']:
        print('배포 대상 없음')
        return
    args = {}
    waiting = False
    for workflow in sorted({SERVICE_CI[service] for service in plan['build_services']}):
        status, run_id = ci_for(workflow, revision)
        if status == 'failed': raise RuntimeError(workflow + ' 실패')
        if status == 'success':
            args[workflow] = str(run_id)
            continue
        waiting = True
        if status == 'missing': dispatch(workflow)
    if waiting:
        print('이미지 CI 대기. 완료 시 다시 실행')
        return
    command = [sys.executable, str(HERE/'dev-deploy-app-V2.py'), '--infra-manifest-uri', infra]
    if CORE_CI in args: command += ['--core-run', args[CORE_CI]]
    if SATELLITE_CI in args: command += ['--satellite-run', args[SATELLITE_CI]]
    output(command)


if __name__ == '__main__': main()
