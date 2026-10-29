#!/usr/bin/env python3
"""백오피스 불변 릴리스 manifest 및 SSM 배포. AWS 호출은 CLI 진입점에서만 한다."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time

REPOSITORY = '808715036056.dkr.ecr.ap-northeast-2.amazonaws.com/catus-backoffice-prod'
INSTANCE = 'i-0f2087a3295642a46'
DOCUMENT = 'catus-backoffice-app-deploy'
TAG = r'backoffice-v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'
ROOT = Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / 'backoffice/server/contract.json').read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_tag(tag):
    require(isinstance(tag, str) and re.fullmatch(TAG, tag), '잘못된 백오피스 릴리스 태그')
    return tag


def validate_manifest(value, tag):
    validate_tag(tag)
    require(isinstance(value, dict) and value.get('schemaVersion') == 1, 'manifest schema 오류')
    require(value.get('tag') == tag and value.get('repository') == REPOSITORY, '릴리스 대상 불일치')
    require(re.fullmatch(r'[a-f0-9]{40}', str(value.get('commit', ''))), '소스 SHA 오류')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', str(value.get('digest', ''))), '이미지 digest 오류')
    require(re.fullmatch(r'[1-9][0-9]*', str(value.get('documentVersion', ''))), 'SSM 문서 버전 오류')
    require(value.get('document') == DOCUMENT and value.get('instance') == INSTANCE, 'SSM 대상 오류')
    # 과거 릴리스는 자체 계약으로 검증하며 현재 앱의 capability와 동일할 필요는 없다.
    contract = value.get('requiredContracts')
    require(isinstance(contract, dict) and isinstance(contract.get('contractVersion'), str), 'API 계약 오류')
    for service in ('data', 'notification'):
        require(isinstance(contract.get(service), list) and bool(contract[service])
                and all(isinstance(item, str) and item for item in contract[service]), 'API capability 오류')
    return value


def aws(*args):
    env = dict(os.environ)
    if args[:2] == ('ssm', 'send-command'):
        env['AWS_MAX_ATTEMPTS'] = '1'  # SendCommand에는 멱등 키가 없다.
    command = ['aws', '--region', 'ap-northeast-2', *args, '--output', 'json']
    if args[:2] == ('ssm', 'list-commands'):
        # 다른 운영 시스템의 명령이 많아도 조회 실패를 배포 명령 재전송으로 오해하지 않는다.
        env['AWS_MAX_ATTEMPTS'] = '1'
        for attempt in range(5):
            result = subprocess.run(command, check=False, text=True, capture_output=True, env=env)
            if result.returncode == 0:
                return json.loads(result.stdout or '{}')
            if 'ThrottlingException' not in result.stderr and 'Rate exceeded' not in result.stderr:
                raise subprocess.CalledProcessError(result.returncode, command)
            if attempt < 4:
                time.sleep(min(2 ** attempt, 8))
        raise RuntimeError('SSM 명령 조회 제한이 계속되어 배포를 중단합니다.')
    result = subprocess.run(command, check=True, text=True, capture_output=True, env=env)
    return json.loads(result.stdout or '{}')


def verify_image(manifest, call=aws):
    images = call('ecr', 'describe-images', '--repository-name', 'catus-backoffice-prod',
                  '--image-ids', 'imageTag=' + manifest['tag'])['imageDetails']
    require(len(images) == 1 and images[0]['imageDigest'] == manifest['digest'], 'ECR 태그와 manifest digest 불일치')


def execute(manifest, intent, attempt, call=aws, sleep=time.sleep, monotonic=time.monotonic, timeout=1500):
    require(re.fullmatch(r'backoffice:[0-9]+', intent), '배포 intent 오류')
    # 같은 workflow run 재실행은 이미 전송한 명령을 이어서 관찰한다.
    existing = [item for item in call('ssm', 'list-commands', '--filters',
                                      'key=DocumentName,value=' + DOCUMENT)['Commands'] if item.get('Comment') == intent]
    require(len(existing) <= 1, '동일 intent 명령이 중복되었습니다. 수동 확인 필요')
    parameters = {'ImageDigest': [manifest['digest'].removeprefix('sha256:')]}
    if existing:
        command = existing[0]
        require(command.get('DocumentName') == DOCUMENT
                and command.get('DocumentVersion') == manifest['documentVersion']
                and command.get('InstanceIds') == [INSTANCE]
                and command.get('Parameters') == parameters, '재시도 명령과 릴리스 불일치')
        identifier = command['CommandId']
    else:
        require(attempt == 1, '이전 실행의 SSM 수신 여부가 불확실합니다. 자동 재전송하지 않습니다.')
        identifier = call('ssm', 'send-command', '--document-name', DOCUMENT,
                          '--document-version', manifest['documentVersion'], '--instance-ids', INSTANCE,
                          '--parameters', json.dumps(parameters), '--comment', intent,
                          '--timeout-seconds', '120')['Command']['CommandId']
    print('SSM command: ' + identifier, flush=True)
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        commands = call('ssm', 'list-commands', '--command-id', identifier)['Commands']
        if not commands:
            sleep(5)
            continue
        status = commands[0]['Status']
        if status == 'Success':
            return identifier
        require(status in ('Pending', 'InProgress', 'Delayed'),
                'SSM 배포 실패: ' + status + '; 공개 경로 차단 여부와 복구 상태를 확인하세요.')
        sleep(5)
    raise TimeoutError('SSM 관찰 시간 초과. 명령을 재전송하지 말고 같은 workflow run을 재실행하세요.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['create', 'deploy'])
    parser.add_argument('--tag', required=True)
    parser.add_argument('--manifest', default='backoffice-release.json')
    parser.add_argument('--commit')
    parser.add_argument('--digest')
    parser.add_argument('--document-version')
    args = parser.parse_args()
    validate_tag(args.tag)
    if args.action == 'create':
        require(os.environ.get('GITHUB_REF') == 'refs/tags/' + args.tag, '태그 workflow만 릴리스할 수 있습니다.')
        value = dict(schemaVersion=1, tag=args.tag, commit=args.commit, digest=args.digest,
                     repository=REPOSITORY, document=DOCUMENT, instance=INSTANCE,
                     documentVersion=args.document_version, requiredContracts=CONTRACT)
        validate_manifest(value, args.tag)
        Path(args.manifest).write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')
    else:
        require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'main workflow만 운영 배포할 수 있습니다.')
        manifest = validate_manifest(json.loads(Path(args.manifest).read_text()), args.tag)
        verify_image(manifest)
        execute(manifest, 'backoffice:' + os.environ['GITHUB_RUN_ID'], int(os.environ['GITHUB_RUN_ATTEMPT']))


if __name__ == '__main__':
    main()
