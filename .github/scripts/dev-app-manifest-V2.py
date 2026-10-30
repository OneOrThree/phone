#!/usr/bin/env python3
"""검증된 CI 이미지와 마지막 성공 상태로 dev V2 앱 후보를 만든다."""
import argparse
import importlib.util
import json
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('dev_plan_v2', Path(__file__).with_name('dev-plan-V2.py'))
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


def candidate(source, previous, revision, infra_revision, artifacts, release_id):
    if not re.fullmatch(re.escape(revision) + r'-[0-9]+-[0-9]+', release_id):
        raise ValueError('릴리스 ID가 소스 SHA 및 실행 번호와 다릅니다')
    result = planner.plan(source, previous, revision, infra_revision)
    expected = set(result['build_services'])
    if set(artifacts) != expected:
        raise ValueError('빌드된 이미지 증거가 필요한 서비스 목록과 다릅니다')
    images = dict(previous['images']) if previous else {}
    for service, artifact in artifacts.items():
        if artifact.get('service') != service or artifact.get('revision') != revision:
            raise ValueError('CI 이미지의 서비스 또는 소스 SHA가 다릅니다')
        image = artifact.get('image', '')
        match = planner.DIGEST.fullmatch(image)
        if not match or match.group(1) != service:
            raise ValueError('CI 이미지의 저장소 또는 digest가 다릅니다')
        images[service] = image
    if set(images) != planner.SERVICES:
        raise ValueError('네 서비스의 이미지가 필요합니다')
    result.update(project='oneorthree2', release_id=release_id, images=images)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--previous', type=Path)
    parser.add_argument('--artifacts', required=True, type=Path,
                        help='서비스 이름을 키로 하는 CI 이미지 정보 JSON')
    parser.add_argument('--revision', required=True)
    parser.add_argument('--infra-revision', required=True)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    previous = json.loads(args.previous.read_text()) if args.previous else None
    result = candidate(json.loads(args.source.read_text()), previous, args.revision,
                       args.infra_revision, json.loads(args.artifacts.read_text()), args.release_id)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()
