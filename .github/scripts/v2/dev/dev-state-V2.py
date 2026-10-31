#!/usr/bin/env python3
"""dev V2 성공 상태를 세대 조건으로 읽고 갱신한다."""
import json
from pathlib import Path
import subprocess
import tempfile

BUCKET = 'catus-dev-v2-deploy-263851348176'
URI = f'gs://{BUCKET}/deployments/app/current.json'


def run(args):
    return subprocess.run(['gcloud', 'storage', *args, '--quiet'], capture_output=True, text=True, check=False)


def read():
    bucket = run(['buckets', 'describe', f'gs://{BUCKET}', '--format=json'])
    if bucket.returncode:
        raise RuntimeError('dev V2 저장 버킷 조회 실패')
    meta = run(['objects', 'describe', URI, '--format=json'])
    if meta.returncode:
        if 'No URLs matched' in meta.stderr or 'NotFoundException: 404' in meta.stderr or 'not found: 404' in meta.stderr:
            return None, '0'
        raise RuntimeError('dev V2 성공 상태 조회 실패')
    info = json.loads(meta.stdout)
    generation = str(info['generation'])
    # 객체가 교체되면 다음 쓰기에서 generation 조건으로 실패한다.
    value = run(['cat', URI + '#' + generation])
    if value.returncode:
        raise RuntimeError('dev V2 성공 상태 본문 조회 실패')
    state = json.loads(value.stdout)
    if state.get('environment') != 'dev-v2' or state.get('project') != 'oneorthree2':
        raise ValueError('dev V2 상태가 아닙니다')
    return state, generation


def write(state, expected_generation):
    if state.get('environment') != 'dev-v2' or state.get('project') != 'oneorthree2':
        raise ValueError('dev V2 상태만 기록할 수 있습니다')
    if not str(expected_generation).isdigit():
        raise ValueError('기준 객체 세대가 필요합니다')
    with tempfile.TemporaryDirectory(prefix='catus-v2-state-') as directory:
        file = Path(directory) / 'state.json'
        file.write_text(json.dumps(state, sort_keys=True) + '\n')
        file.chmod(0o600)
        result = run(['cp', '--if-generation-match=' + str(expected_generation), str(file), URI])
    if result.returncode:
        raise RuntimeError('dev V2 성공 상태 갱신 실패: 기준 세대 변경 또는 저장 오류')


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['read', 'write'])
    parser.add_argument('--input', type=Path)
    parser.add_argument('--expected-generation')
    args = parser.parse_args()
    if args.action == 'read':
        state, generation = read()
        print(json.dumps({'state': state, 'generation': generation}))
    else:
        if args.input is None or args.expected_generation is None:
            parser.error('write에는 --input과 --expected-generation이 필요합니다')
        write(json.loads(args.input.read_text()), args.expected_generation)


if __name__ == '__main__':
    main()
