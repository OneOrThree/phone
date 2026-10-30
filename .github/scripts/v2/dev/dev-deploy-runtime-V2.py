#!/usr/bin/env python3
"""고정된 main 산출물을 dev V2의 해당 런타임 VM에 적용한다."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[4]
BUCKET = 'gs://catus-dev-v2-deploy-263851348176'


def command(args, *, data=None):
    result = subprocess.run(args, input=data, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('dev V2 명령 실패: ' + args[0])
    return result.stdout


def aws_secret(name):
    if name not in ('catus/dev/env-v2', 'catus/dev/cicd-v2'):
        raise ValueError('허용되지 않은 시크릿')
    raw = command(['aws', '--region', 'ap-northeast-2', 'secretsmanager', 'get-secret-value',
                   '--secret-id', name, '--query', 'SecretString', '--output', 'text'])
    result = json.loads(raw)
    if not isinstance(result, dict): raise ValueError('시크릿이 JSON 객체가 아닙니다')
    return result


def validate_manifest(role, uri, manifest, archive):
    match = re.fullmatch(re.escape(BUCKET) + r'/releases/' + role + r'/([0-9a-f]{40}-[0-9]+-[0-9]+)/manifest\.json', uri)
    if not match or manifest.get('release_id') != match.group(1): raise ValueError('v2 릴리스 URI 오류')
    if manifest.get('environment') != 'dev-v2' or manifest.get('project') != 'oneorthree2' or manifest.get('role') != role:
        raise ValueError('v2 대상이 아닙니다')
    revision = match.group(1).split('-')[0]
    if manifest.get('revision') != revision or manifest.get('archive_uri') != uri.rsplit('/', 1)[0] + '/runtime.tar':
        raise ValueError('릴리스 주소와 내용이 다릅니다')
    if hashlib.sha256(archive).hexdigest() != manifest.get('archive_sha256'):
        raise ValueError('런타임 묶음 해시 불일치')
    ancestor = subprocess.run(['git', 'merge-base', '--is-ancestor', revision, 'HEAD'], cwd=ROOT, capture_output=True)
    if ancestor.returncode: raise ValueError('현재 main에 포함된 릴리스가 아닙니다')
    expected = manifest.get('files')
    if not isinstance(expected, dict) or not expected: raise ValueError('파일 해시가 없습니다')
    tracked = command(['git', '-C', str(ROOT), 'ls-tree', '-r', '--name-only', revision, '--',
                       f'server/scripts/v2/dev/{role}/', 'server/scripts/v2/dev/common/',
                       '.github/scripts/v2/dev/dev-publish-runtime-V2.py']).decode().splitlines()
    if set(tracked) != set(expected): raise ValueError('main에 포함된 런타임 파일 목록과 다릅니다')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tar:
        members = tar.getmembers()
        if len(members) != len(expected) or len({m.name for m in members}) != len(members):
            raise ValueError('런타임 파일 목록이 다릅니다')
        for member in members:
            name = member.name
            allowed = name.startswith(f'server/scripts/v2/dev/{role}/') or name.startswith('server/scripts/v2/dev/common/') or name == '.github/scripts/v2/dev/dev-publish-runtime-V2.py'
            if not allowed or not member.isfile() or '..' in Path(name).parts or name not in expected or member.size > 5_000_000:
                raise ValueError('허용되지 않은 런타임 파일')
            data = tar.extractfile(member).read()
            if hashlib.sha256(data).hexdigest() != expected[name]: raise ValueError('파일 해시 불일치')
            tracked = command(['git', '-C', str(ROOT), 'show', revision + ':' + name])
            if hashlib.sha256(tracked).hexdigest() != expected[name]: raise ValueError('main 소스와 파일이 다릅니다')
    return revision, match.group(1)


ssh_key_ready = False


def ssh(host, remote, data=None):
    global ssh_key_ready
    args = ['gcloud', 'compute', 'ssh', host, '--project=oneorthree2', '--zone=asia-northeast3-a',
            '--tunnel-through-iap', '--quiet', '--command']
    if not ssh_key_ready:
        # 새 러너 첫 호출은 키 생성 출력이 stdout에 섞임. 먼저 소비.
        command(args + ['true'])
        ssh_key_ready = True
    return command(args + [remote], data=data)


def redis_changes(previous_files, current_files):
    if previous_files is None: return {'shared', 'business'}
    changed = {name for name in set(previous_files) | set(current_files)
               if previous_files.get(name) != current_files.get(name)}
    prefix = 'server/scripts/v2/dev/redis/'
    roles = set()
    for name in changed:
        if name == prefix + 'shared.yml': roles.add('shared')
        elif name == prefix + 'business.yml': roles.add('business')
        else: return {'shared', 'business'}
    return roles


def deploy(role, uri, selection):
    if os.environ.get('GITHUB_REF') != 'refs/heads/main': raise ValueError('main 배포만 허용합니다')
    if role not in ('kafka', 'redis', 'postgres'): raise ValueError('허용되지 않은 런타임')
    if not re.fullmatch(re.escape(BUCKET) + '/releases/' + role + r'/[0-9a-f]{40}-[0-9]+-[0-9]+/manifest\.json', uri):
        raise ValueError('허용되지 않은 manifest 주소')
    manifest = json.loads(command(['gcloud', 'storage', 'cat', uri]))
    archive_uri = uri.rsplit('/', 1)[0] + '/runtime.tar'
    if manifest.get('archive_uri') != archive_uri: raise ValueError('런타임 묶음 주소가 다릅니다')
    archive = command(['gcloud', 'storage', 'cat', archive_uri])
    if len(archive) > 20_000_000: raise ValueError('런타임 묶음이 너무 큽니다')
    revision, release = validate_manifest(role, uri, manifest, archive)
    state_spec = importlib.util.spec_from_file_location('dev_state_v2', ROOT/'.github/scripts/v2/dev/dev-state-V2.py')
    state_store = importlib.util.module_from_spec(state_spec); state_spec.loader.exec_module(state_store)
    state_store.URI = f'{BUCKET}/deployments/{role}/current.json'
    previous, generation = state_store.read()
    if previous:
        if previous.get('role') != role or not re.fullmatch(r'[0-9a-f]{40}', previous.get('revision', '')):
            raise ValueError('기존 dev V2 성공 상태가 올바르지 않습니다')
        if subprocess.run(['git','merge-base','--is-ancestor',previous['revision'],revision],cwd=ROOT,capture_output=True).returncode:
            raise ValueError('오래된 런타임 릴리스는 적용할 수 없습니다')
    if role == 'redis':
        required = redis_changes(previous.get('files') if previous else None, manifest['files'])
        selected = {'shared','business'} if selection == 'all' else {selection}
        if not required.issubset(selected):
            raise ValueError('선택한 Redis에 누적 변경이 모두 포함되지 않습니다')
    config = aws_secret('catus/dev/cicd-v2')
    if config.get('environment') != 'dev-v2' or config.get('project') != 'oneorthree2' or config.get('zone') != 'asia-northeast3-a':
        raise ValueError('dev V2 설정이 아닙니다')
    host_role = 'redis' if role == 'redis' else 'data'
    host = config['hosts'][host_role]
    expected_name = 'catus-dev-v2-' + host_role
    if host.get('name') != expected_name or not re.fullmatch(r'10\.30\.0\.[0-9]{1,3}', host.get('private_ip', '')):
        raise ValueError('대상 VM 정보가 다릅니다')
    actual = command(['gcloud', 'compute', 'instances', 'describe', expected_name, '--project=oneorthree2',
                      '--zone=asia-northeast3-a', '--format=value(id)']).decode().strip()
    if actual != str(host['id']): raise ValueError('대상 VM ID가 다릅니다')
    # 이미지 버전 변경은 Kafka/DB 데이터 호환성 검토 없이 수행하지 않는다.
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as tar:
        if role == 'redis':
            image_files = [(name, f'server/scripts/v2/dev/redis/{name}.yml')
                           for name in ('shared', 'business')]
        else:
            image_files = [(role, f'server/scripts/v2/dev/{role}/compose.yml')]
        for name, file in image_files:
            config_text = tar.extractfile(file).read().decode()
            found = re.findall(r'(?m)^\s*image:\s*([^\s#]+)\s*$', config_text)
            if len(found) != 1: raise ValueError('런타임 이미지가 확정되지 않았습니다')
            container = {'kafka':'catus-dev-kafka-v2-kafka-1', 'postgres':'catus-dev-postgres-v2-postgres-1',
                         'shared':'catus-dev-redis-v2-shared-1', 'business':'catus-dev-redis-v2-business-1'}[name]
            cmd = ("if sudo docker inspect --format '{{.Config.Image}}' " + container +
                   ' 2>/dev/null; then :; else sudo docker info >/dev/null && echo __ABSENT__; fi')
            actual_image = ssh(expected_name, cmd).decode().strip()
            if actual_image != '__ABSENT__' and actual_image != found[0]:
                raise ValueError('런타임 이미지 변경은 별도 데이터 호환 계획이 필요합니다')
    destination = f'/opt/catus-dev-v2/releases/{role}/{release}'
    # tar는 위에서 경로·파일 타입·원본 SHA를 검증했다.
    ssh(expected_name, f'sudo install -d -m 700 {destination} && sudo tar -xf - -C {destination}', archive)
    root = destination + '/server/scripts/v2/dev'
    variables = {'HOST_PRIVATE_IP':host['private_ip']}
    if role == 'kafka':
        variables['KAFKA_HEALTHCHECK_FILE'] = root + '/kafka/healthcheck.sh'
        target = 'kafka'
    else:
        secret = aws_secret('catus/dev/env-v2')
        spec = importlib.util.spec_from_file_location('writer', ROOT/'.github/scripts/write-compose-env.py')
        w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
        if role == 'redis':
            if selection not in ('shared', 'business', 'all'): raise ValueError('Redis 대상 오류')
            for name, content in (('shared', w.shared_redis_acl(secret)), ('business', w.business_redis_acl(secret))):
                # 실행별 경로. 같은 산출물 재배포도 마운트 변경으로 컨테이너 재생성, 새 ACL 적용.
                path = f"{destination}/{name}-{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}.acl"
                ssh(expected_name, f'sudo install -m 600 -o 999 -g 999 /dev/stdin {path}', content.encode())
                variables[name.upper() + '_ACL_FILE'] = path
            target = 'redis-' + selection
        else:
            keys = ('POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD')
            w.require(secret, keys)
            content = ''.join(f'{k}={w.dotenv_quote(secret[k])}\n' for k in keys)
            env_path = f'{destination}/postgres.env'
            ssh(expected_name, f'sudo install -m 600 /dev/stdin {env_path}', content.encode())
            variables['POSTGRES_ENV_FILE'] = env_path
            target = 'postgres'
    env_args = ' '.join(shlex.quote(k + '=' + v) for k, v in sorted(variables.items()))
    try:
        ssh(expected_name, f'sudo env {env_args} {root}/common/apply.sh {target}')
        if role == 'kafka':
            ssh(expected_name, f'sudo {root}/kafka/prepare-topics.sh')
            ssh(expected_name, f'sudo {root}/kafka/verify.sh')
        elif role == 'postgres':
            ssh(expected_name, f'sudo {root}/postgres/verify.sh')
        else:
            selected = ('shared', 'business') if selection == 'all' else (selection,)
            for name in selected:
                password = secret['REDIS_REALTIME_PASSWORD' if name == 'shared' else 'BUSINESS_REDIS_PASSWORD']
                if not isinstance(password, str) or '\n' in password or '\r' in password:
                    raise ValueError('Redis 비밀번호 형식 오류')
                ssh(expected_name, f'sudo {root}/redis/verify.sh {name}', (password + '\n').encode())
    finally:
        if role == 'postgres': ssh(expected_name, f'sudo python3 -c "from pathlib import Path; Path(\'{destination}/postgres.env\').unlink(missing_ok=True)"')
    result = {'environment':'dev-v2','project':'oneorthree2','role':role,'release_id':release,
              'revision':revision,'host_id':actual,'result':'healthy','files':manifest['files'],
              'selection':selection if role == 'redis' else role}
    # 성공 상태는 검증을 마친 뒤에만 기록하며, 다른 실행이 먼저 기록하면 덮어쓰지 않는다.
    state_store.write(result, generation)
    print(json.dumps({k:v for k,v in result.items() if k != 'files'}))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--role', choices=['kafka','redis','postgres'], required=True)
    parser.add_argument('--manifest-uri', required=True)
    parser.add_argument('--selection', choices=['shared','business','all'], default='all')
    args = parser.parse_args()
    deploy(args.role, args.manifest_uri, args.selection)
