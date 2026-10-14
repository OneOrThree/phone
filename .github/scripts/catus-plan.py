#!/usr/bin/env python3
"""실제 prod 성공 상태와 소스 지문을 비교해 서비스별 빌드·배포 대상을 정한다."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

SERVICES = {'data-api', 'realtime', 'business-api', 'notification'}
SHARED = ('.github/actions/ci-jar/', '.github/scripts/ci-jar.py', '.github/scripts/catus-',
          '.github/workflows/prod-ci.yml', '.dockerignore', 'server/gradle')
IMAGE = re.compile(r'^808715036056\.dkr\.ecr\.ap-northeast-2\.amazonaws\.com/catus-prod/([^/]+)@sha256:[0-9a-f]{64}$')


def fingerprints(root, files):
    source, migrations = {}, {}
    for service in sorted(SERVICES):
        code, sql = hashlib.sha256(), hashlib.sha256()
        for name in sorted(files):
            own = name.startswith(f'server/{service}/')
            if not own and not name.startswith(SHARED):
                continue
            if name.endswith('.md') or '/docs/' in name:
                continue
            path = root / name
            if path.is_symlink() or not path.is_file():
                raise ValueError('빌드 입력은 일반 파일이어야 한다')
            content = path.read_bytes()
            code.update(name.encode() + b'\0' + content + b'\0')
            if own and '/src/main/resources/db/migration/' in name and name.endswith('.sql'):
                sql.update(name.encode() + b'\0' + content + b'\0')
        source[service], migrations[service] = code.hexdigest(), sql.hexdigest()
    return source, migrations


def plan(source, migrations, previous, revision, infra_revision, force=False):
    if previous:
        if previous.get('product') != 'catus' or set(previous.get('images', {})) != SERVICES:
            raise ValueError('Catus prod 성공 상태 오류')
        if not re.fullmatch('[0-9a-f]{40}-[0-9]+-[0-9]+', previous.get('release_id', '')):
            raise ValueError('기준 릴리스 ID 오류')
        for service, image in previous['images'].items():
            match = IMAGE.fullmatch(image)
            if not match or match.group(1) != service: raise ValueError('기준 이미지 오류')
    build = sorted(service for service in SERVICES if force or not previous or
                   previous.get('source_fingerprints', {}).get(service) != source[service])
    deploy = sorted(SERVICES) if not previous or previous.get('infra_revision') != infra_revision else build
    return {'source_revision': revision, 'infra_revision': infra_revision, 'build_services': build,
            'deploy_services': deploy, 'base_release_id': previous['release_id'] if previous else None,
            'source_fingerprints': source, 'migration_fingerprints': migrations, 'previous': previous}


def fetch_previous(output):
    def aws(*args):
        return subprocess.run(['aws', '--region', 'ap-northeast-2', *args], capture_output=True, text=True, timeout=30)
    result = aws('secretsmanager', 'get-secret-value', '--secret-id', 'catus/prod/cicd', '--query', 'SecretString', '--output', 'text')
    if result.returncode: raise RuntimeError('배포 설정 조회 실패')
    config = json.loads(result.stdout)
    if config.get('PRODUCT') != 'catus' or not config['DEPLOY_BUCKET'].startswith('catus-prod-deploy-artifacts-'):
        raise ValueError('배포 설정 불일치')
    result = aws('s3api', 'get-object', '--bucket', config['DEPLOY_BUCKET'], '--key', 'deployments/current.json', str(output))
    if result.returncode:
        if 'NoSuchKey' in result.stderr or '(404)' in result.stderr: return None
        raise RuntimeError('prod 성공 상태 조회 실패 (권한/네트워크 오류를 최초 배포로 취급하지 않음)')
    return json.loads(output.read_text())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--previous-from-aws', action='store_true')
    parser.add_argument('--pr-base')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    root = Path.cwd()
    files = subprocess.check_output(['git', 'ls-files', '-z'], text=True).split('\0')
    source, migrations = fingerprints(root, [name for name in files if name])
    previous = fetch_previous(args.output.with_name('previous.json')) if args.previous_from_aws else None
    result = plan(source, migrations, previous, os.environ['GITHUB_SHA'], os.environ.get('INFRA_REVISION', ''), args.force)
    if args.pr_base:
        names = subprocess.check_output(['git', 'diff', '--no-renames', '--name-only', args.pr_base, os.environ['GITHUB_SHA']], text=True).splitlines()
        shared = any(name.startswith(SHARED) for name in names)
        result['build_services'] = sorted(service for service in SERVICES if shared or
            any(name.startswith(f'server/{service}/') and not name.endswith('.md') and '/docs/' not in name for name in names))
    args.output.write_text(json.dumps(result, sort_keys=True))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('matrix=' + json.dumps({'service': result['build_services']}) + '\n')
        output.write('build_any=' + str(bool(result['build_services'])).lower() + '\n')
        output.write('any=' + str(bool(result['deploy_services'])).lower() + '\n')
    print('빌드 대상: ' + ', '.join(result['build_services']))
    print('배포 대상: ' + ', '.join(result['deploy_services']))


if __name__ == '__main__':
    main()
