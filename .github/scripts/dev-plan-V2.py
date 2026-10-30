#!/usr/bin/env python3
"""dev V2 마지막 성공 상태와 서비스별 소스 지문으로 배포 대상을 선택한다."""
import json
import re

SERVICES = frozenset({'data-api', 'realtime', 'business-api', 'notification'})
CORE = frozenset({'data-api', 'realtime'})
SHA = re.compile(r'[0-9a-f]{40}\Z')
DIGEST = re.compile(r'asia-northeast3-docker\.pkg\.dev/oneorthree2/([^/]+)/\1@sha256:[0-9a-f]{64}\Z')


def plan(source, previous, revision, infra_revision):
    if not SHA.fullmatch(revision) or not SHA.fullmatch(infra_revision):
        raise ValueError('소스 및 Infra SHA가 필요합니다')
    if set(source) != SERVICES or any(not re.fullmatch(r'[0-9a-f]{64}', value) for value in source.values()):
        raise ValueError('네 서비스의 유효한 소스 지문이 필요합니다')
    if previous is not None:
        if previous.get('environment') != 'dev-v2' or set(previous.get('images', {})) != SERVICES:
            raise ValueError('dev V2의 네 이미지 성공 상태가 필요합니다')
        if not previous.get('release_id') or set(previous.get('source_fingerprints', {})) != SERVICES:
            raise ValueError('기준 릴리스와 네 서비스 지문이 필요합니다')
        for service, image in previous['images'].items():
            match = DIGEST.fullmatch(image)
            if match is None or match.group(1) != service:
                raise ValueError('dev GAR 이미지 digest가 올바르지 않습니다')
    changed = {s for s in SERVICES if previous is None or previous['source_fingerprints'][s] != source[s]}
    if changed & CORE:
        changed |= CORE
    deploy = SERVICES if previous is None or previous.get('infra_revision') != infra_revision else changed
    return {'environment': 'dev-v2', 'revision': revision, 'infra_revision': infra_revision,
            'base_release_id': previous['release_id'] if previous else None,
            'build_services': sorted(changed), 'deploy_services': sorted(deploy),
            'source_fingerprints': source}


def main():
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--previous', type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--infra-revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.source.read_text())
    previous = json.loads(args.previous.read_text()) if args.previous else None
    args.output.write_text(json.dumps(plan(source, previous, args.revision, args.infra_revision), indent=2) + '\n')


if __name__ == '__main__':
    main()
