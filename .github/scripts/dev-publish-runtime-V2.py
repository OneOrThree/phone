#!/usr/bin/env python3
"""main의 dev V2 런타임 설정을 덮어쓸 수 없는 GCS 산출물로 발행한다."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BUCKET = 'gs://catus-dev-v2-deploy-263851348176'


def publish(role):
    if role not in {'kafka', 'redis', 'postgres'} or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('main의 dev V2 런타임만 발행할 수 있습니다')
    revision = os.environ['GITHUB_SHA']
    run, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    if not re.fullmatch('[0-9a-f]{40}', revision) or not run.isdigit() or not attempt.isdigit():
        raise ValueError('릴리스 식별자가 올바르지 않습니다')
    files = subprocess.check_output(['git', 'ls-files', '-z', '--',
                                     f'server/scripts/runtime-dev-V2/{role}/',
                                     'server/scripts/runtime-dev-V2/common/',
                                     '.github/scripts/dev-publish-runtime-V2.py'], cwd=ROOT).split(b'\0')
    names = sorted(x.decode() for x in files if x)
    if not names or not any(n.startswith(f'server/scripts/runtime-dev-V2/{role}/') for n in names):
        raise ValueError('런타임 구성 파일이 없습니다')
    with tempfile.TemporaryDirectory(prefix='dev-v2-publish-') as directory:
        archive, manifest = Path(directory)/'runtime.tar', Path(directory)/'manifest.json'
        hashes = {}
        with tarfile.open(archive, 'w') as tar:
            for name in names:
                path = ROOT/name
                if path.is_symlink() or not path.is_file():
                    raise ValueError('일반 파일만 발행할 수 있습니다')
                data = path.read_bytes()
                hashes[name] = hashlib.sha256(data).hexdigest()
                info = tar.gettarinfo(str(path), arcname=name)
                info.uid = info.gid = 0
                info.uname = info.gname = 'root'
                info.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
                with path.open('rb') as source:
                    tar.addfile(info, source)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        release = f'{revision}-{run}-{attempt}'
        uri = f'{BUCKET}/releases/{role}/{release}'
        body = {'environment':'dev-v2','project':'oneorthree2','role':role,'revision':revision,
                'release_id':release,'archive_sha256':digest,'files':hashes,'archive_uri':uri+'/runtime.tar'}
        manifest.write_text(json.dumps(body, sort_keys=True)+'\n')
        for file, name in ((archive, 'runtime.tar'), (manifest, 'manifest.json')):
            result = subprocess.run(['gcloud','storage','cp','--quiet','--if-generation-match=0',str(file),uri+'/'+name],
                                    capture_output=True,text=True,check=False)
            if result.returncode:
                raise RuntimeError(f'{role} 산출물 업로드 실패: {name}')
        print(json.dumps({'release_id':release,'manifest_uri':uri+'/manifest.json','archive_sha256':digest}))


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('role',choices=['kafka','redis','postgres'])
    publish(parser.parse_args().role)
