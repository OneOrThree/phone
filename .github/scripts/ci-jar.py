#!/usr/bin/env python3
"""같은 workflow 실행·리비전의 bootJar만 이미지에 전달한다."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

SERVICES = ('data-api', 'business-api', 'notification', 'realtime')
ROOT = Path(__file__).resolve().parents[2]


def identity(service, revision, run_id):
    return {'service': service, 'revision': revision, 'run_id': run_id}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pack(project, artifact, expected):
    jars = [p for p in (project / 'build/libs').glob('*.jar')
            if not p.name.endswith('-plain.jar')]
    if len(jars) != 1:
        raise ValueError('bootJar가 정확히 하나 있어야 합니다')
    with zipfile.ZipFile(jars[0]) as archive:
        if not any(n.startswith('BOOT-INF/classes/') for n in archive.namelist()):
            raise ValueError('Spring Boot 실행 JAR가 아닙니다')
    artifact.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(jars[0], artifact / 'app.jar')
    manifest = {**expected, 'sha256': digest(artifact / 'app.jar')}
    (artifact / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def verify(artifact, expected):
    manifest = json.loads((artifact / 'manifest.json').read_text())
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ValueError('JAR의 서비스·리비전·workflow 실행이 일치하지 않습니다')
    if manifest.get('sha256') != digest(artifact / 'app.jar'):
        raise ValueError('JAR SHA-256이 일치하지 않습니다')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('pack', 'verify'))
    parser.add_argument('--service', choices=SERVICES, required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    project = ROOT / 'server' / args.service
    artifact = project / 'ci-artifact'
    expected = identity(args.service, args.revision, args.run_id)
    manifest = (pack(project, artifact, expected) if args.command == 'pack'
                else verify(artifact, expected))
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    main()
