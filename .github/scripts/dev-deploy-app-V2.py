#!/usr/bin/env python3
"""고정된 CI 이미지와 Infra 산출물을 검증해 dev V2 앱에 적용한다."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BUCKET = 'gs://catus-dev-v2-deploy-263851348176'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'.github/scripts'/file)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


runtime = module('runtime', 'dev-deploy-runtime-V2.py')
state_store = module('state', 'dev-state-V2.py')
planner = module('planner', 'dev-plan-V2.py')
fingerprints = module('fingerprints', 'dev-fingerprint-V2.py')
artifacts = module('artifacts', 'dev-app-artifacts-V2.py')
manifest_builder = module('app_manifest', 'dev-app-manifest-V2.py')
env_builder = module('env_builder', 'dev-env-V2.py')


def infra_runtime(uri):
    match = re.fullmatch(re.escape(BUCKET) + r'/infra/([0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*)/manifest\.json', uri)
    if not match: raise ValueError('허용되지 않은 Infra 산출물 주소')
    release = match.group(1)
    revision = release.split('-')[0]
    manifest = json.loads(runtime.command(['gcloud', 'storage', 'cat', uri]))
    if (manifest.get('environment') != 'dev-v2' or manifest.get('repository') != 'OneOrThree/cattus-infra'
        or manifest.get('revision') != revision or manifest.get('release_id') != release):
        raise ValueError('Infra 산출물 출처 오류')
    names = {'dev/runtime-v2/app-compose.yml': 'app-compose.yml',
             'dev/runtime-v2/nginx.conf.template': 'nginx.conf.template'}
    if set(manifest.get('files', {})) != set(names): raise ValueError('Infra 파일 목록 오류')
    files = {}
    for name, basename in names.items():
        meta = manifest['files'][name]
        expected_uri = uri.rsplit('/', 1)[0] + '/' + basename
        if meta.get('uri') != expected_uri or not re.fullmatch(r'[0-9a-f]{64}', meta.get('sha256', '')):
            raise ValueError('Infra 파일 경로 또는 해시 오류')
        data = runtime.command(['gcloud', 'storage', 'cat', expected_uri])
        if len(data) > 1_000_000 or hashlib.sha256(data).hexdigest() != meta['sha256']:
            raise ValueError('Infra 파일 해시가 다릅니다')
        files[basename] = data
    return revision, files


def package(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as tar:
        for name, data in files.items():
            if name not in ('compose.yml', 'nginx.conf', 'deploy.py'): raise ValueError('허용되지 않은 파일')
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o700 if name == 'deploy.py' else 0o600
            tar.addfile(info, io.BytesIO(data))
    return output.getvalue()


def verify_runtime_prerequisites(revision, config):
    saved_uri = state_store.URI
    try:
        for role in ('kafka', 'redis', 'postgres'):
            state_store.URI = f'{BUCKET}/deployments/{role}/current.json'
            state, _ = state_store.read()
            host_role = 'redis' if role == 'redis' else 'data'
            if (not state or state.get('role') != role or state.get('result') != 'healthy'
                or str(state.get('host_id')) != str(config['hosts'][host_role]['id'])
                or not re.fullmatch(r'[0-9a-f]{40}', state.get('revision', ''))):
                raise ValueError(role + '의 성공한 v2 선행 배포가 필요합니다')
            before = state['revision']
            ancestor = subprocess.run(['git', '-C', str(ROOT), 'merge-base', '--is-ancestor', before, revision],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            diff = subprocess.run(['git', '-C', str(ROOT), 'diff', '--quiet', before, revision, '--',
                                   f'server/scripts/runtime-dev-V2/{role}', 'server/scripts/runtime-dev-V2/common',
                                   '.github/scripts/dev-publish-runtime-V2.py'],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ancestor.returncode or diff.returncode:
                raise ValueError(role + '의 현재 main 변경이 선행 배포되지 않았습니다')
    finally:
        state_store.URI = saved_uri


def deploy(infra_uri, core_run, satellite_run):
    revision = os.environ.get('GITHUB_SHA', '')
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    if (os.environ.get('GITHUB_REPOSITORY') != 'OneOrThree/phone'
        or os.environ.get('GITHUB_REF') != 'refs/heads/main'
        or not re.fullmatch(r'[0-9a-f]{40}', revision)
        or not re.fullmatch(r'[1-9][0-9]*', run_id)):
        raise ValueError('phone main의 고정된 실행만 허용합니다')
    # 워크플로가 실제 체크아웃한 커밋과 입력 SHA를 반드시 일치시킨다.
    head = runtime.command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD']).decode().strip()
    if head != revision: raise ValueError('체크아웃과 실행 SHA가 다릅니다')
    infra_revision, files = infra_runtime(infra_uri)
    previous, generation = state_store.read()
    if previous:
        prev_revision = previous.get('revision', '')
        if not re.fullmatch(r'[0-9a-f]{40}', prev_revision) or subprocess.run(
            ['git', '-C', str(ROOT), 'merge-base', '--is-ancestor', prev_revision, revision],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            raise ValueError('이전 성공 이후의 main 커밋이 아닙니다')
    source = fingerprints.fingerprint(revision)
    plan = planner.plan(source, previous, revision, infra_revision)
    evidence = artifacts.collect(revision, plan['build_services'], core_run, satellite_run)
    # 같은 workflow run 재시도는 같은 릴리스 ID를 사용해 응답 유실 후 재배포를 피한다.
    release_id = f'{revision}-{run_id}-1'
    candidate = manifest_builder.candidate(source, previous, revision, infra_revision, evidence, release_id)
    if not candidate['deploy_services']:
        print(json.dumps({'result':'no_change','revision':revision}))
        return
    config = runtime.aws_secret('gromo/dev/cicd-v2')
    host = config.get('hosts', {}).get('app', {})
    if (config.get('environment') != 'dev-v2' or config.get('project') != 'oneorthree2'
        or config.get('zone') != 'asia-northeast3-a' or host.get('name') != 'catus-dev-v2-app'):
        raise ValueError('dev V2 앱 대상 오류')
    actual = json.loads(runtime.command(['gcloud','compute','instances','describe','catus-dev-v2-app',
                 '--project=oneorthree2','--zone=asia-northeast3-a','--format=json']))
    if (str(actual.get('id')) != str(host.get('id')) or actual.get('status') != 'RUNNING'
        or len(actual.get('networkInterfaces', [])) != 1
        or actual['networkInterfaces'][0].get('networkIP') != host.get('private_ip')):
        raise ValueError('앱 VM ID 또는 주소가 다릅니다')
    verify_runtime_prerequisites(revision, config)
    envs = env_builder.generate(runtime.aws_secret('gromo/dev/env-v2'), config, candidate['images'])
    template = files['nginx.conf.template']
    if template.count(b'__PUBLIC_HOST__') != 2: raise ValueError('nginx 도메인 템플릿 오류')
    nginx = template.replace(b'__PUBLIC_HOST__', b'oneorthree-v2.dev.mooo.com')
    host_script = runtime.command(['git','-C',str(ROOT),'show',revision + ':server/scripts/runtime-dev-V2/app/deploy.py'])
    archive = package({'compose.yml': files['app-compose.yml'], 'nginx.conf':nginx, 'deploy.py':host_script})
    dest = f'/opt/catus-dev-v2/app/releases/{release_id}'
    # 같은 실행 재시도는 같은 파일만 덮는다. 파일은 신뢰된 커밋·불변 산출물에서 만들었다.
    runtime.ssh(host['name'], f'sudo install -d -m 700 {dest} && sudo tar -xf - -C {dest}', archive)
    payload = {'release_id':release_id, 'base_release_id':candidate['base_release_id'],
               'services':candidate['deploy_services'], 'images':candidate['images'], 'envs':envs,
               'redis_ip':config['hosts']['redis']['private_ip'], 'compose_path':dest+'/compose.yml'}
    journal = json.loads(runtime.ssh(host['name'], f'sudo python3 {dest}/deploy.py', json.dumps(payload).encode()))
    if (journal.get('status') != 'healthy' or journal.get('release_id') != release_id
        or journal.get('images') != candidate['images'] or journal.get('services') != candidate['deploy_services']):
        raise RuntimeError('호스트 성공 저널이 릴리스와 다릅니다')
    candidate['infra_manifest_uri'] = infra_uri
    candidate['host_id'] = str(host['id'])
    candidate['result'] = 'healthy'
    state_store.write(candidate, generation)
    print(json.dumps({'result':'healthy','release_id':release_id,'services':candidate['deploy_services']}))


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--infra-manifest-uri', required=True)
    p.add_argument('--core-run')
    p.add_argument('--satellite-run')
    a = p.parse_args()
    deploy(a.infra_manifest_uri, a.core_run, a.satellite_run)
