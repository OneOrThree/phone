#!/usr/bin/env python3
"""같은 main 커밋에서 성공한 v2 CI 실행의 이미지 증거만 읽는다."""
import argparse
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

REPO = 'OneOrThree/phone'
WORKFLOWS = {'data-api': 'data-api-ci.dev-v2.yml', 'realtime': 'data-api-ci.dev-v2.yml',
             'business-api': 'satellite-ci.dev-v2.yml', 'notification': 'satellite-ci.dev-v2.yml'}


def api(path):
    return subprocess.run(['gh', 'api', path], check=True, stdout=subprocess.PIPE).stdout


def validate_run(run, revision, workflow):
    if (run.get('event') not in ('push', 'workflow_dispatch') or run.get('head_branch') != 'main'
        or run.get('head_sha') != revision or run.get('conclusion') != 'success'
        or run.get('status') != 'completed' or run.get('path') != '.github/workflows/' + workflow
        or run.get('repository', {}).get('full_name') != REPO
        or run.get('head_repository', {}).get('full_name') != REPO):
        raise ValueError('같은 저장소 main의 성공한 v2 CI 실행이 아닙니다')


def read_zip(blob, service, revision):
    if len(blob) > 1_000_000: raise ValueError('이미지 증거가 너무 큽니다')
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        entries = z.infolist()
        if len(entries) != 1 or entries[0].filename != service + '-dev-v2-image.json' or entries[0].file_size > 10_000:
            raise ValueError('이미지 증거 파일이 다릅니다')
        data = json.loads(z.read(entries[0]))
    image = data.get('image', '')
    if (data.get('service') != service or data.get('revision') != revision
        or not re.fullmatch(r'asia-northeast3-docker\.pkg\.dev/oneorthree2/' + service + '/' + service + r'@sha256:[0-9a-f]{64}', image)):
        raise ValueError('이미지 증거 내용이 다릅니다')
    return data


def collect(revision, services, core_run, satellite_run):
    if not re.fullmatch(r'[0-9a-f]{40}', revision): raise ValueError('전체 소스 SHA가 필요합니다')
    if not set(services) <= set(WORKFLOWS): raise ValueError('알 수 없는 서비스')
    runs = {'data-api-ci.dev-v2.yml': core_run, 'satellite-ci.dev-v2.yml': satellite_run}
    result = {}
    for workflow in sorted({WORKFLOWS[s] for s in services}):
        run_id = str(runs[workflow] or '')
        if not re.fullmatch(r'[1-9][0-9]*', run_id): raise ValueError('필요한 CI 실행 번호가 없습니다')
        run = json.loads(api(f'repos/{REPO}/actions/runs/{run_id}'))
        validate_run(run, revision, workflow)
        # A run has few artifacts; fail rather than silently ignore pagination.
        response = json.loads(api(f'repos/{REPO}/actions/runs/{run_id}/artifacts?per_page=100'))
        entries = response.get('artifacts', [])
        if response.get('total_count', 0) > len(entries): raise ValueError('CI 증거 목록이 너무 큽니다')
        for service in (s for s in services if WORKFLOWS[s] == workflow):
            matches = [a for a in entries if a.get('name') == service + '-dev-v2-image' and not a.get('expired')]
            if len(matches) != 1: raise ValueError('유효한 CI 이미지 증거가 하나가 아닙니다')
            artifact_id = str(matches[0].get('id', ''))
            if not re.fullmatch(r'[1-9][0-9]*', artifact_id): raise ValueError('CI 증거 ID 오류')
            result[service] = read_zip(api(f'repos/{REPO}/actions/artifacts/{artifact_id}/zip'), service, revision)
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--revision', required=True)
    p.add_argument('--services', required=True, help='쉼표로 구분한 서비스 이름')
    p.add_argument('--core-run')
    p.add_argument('--satellite-run')
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    services = [s for s in a.services.split(',') if s]
    if len(services) != len(set(services)): raise ValueError('중복 서비스')
    a.output.write_text(json.dumps(collect(a.revision, services, a.core_run, a.satellite_run), indent=2) + '\n')


if __name__ == '__main__': main()
