#!/usr/bin/env python3
"""Catus 릴리스 PR 라벨로 버전을 정한다. Gromo v* 태그는 참조하지 않는다."""
import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

VERSION = re.compile(r'^catus-v(\d+)\.(\d+)\.(\d+)$')
BUMP_ORDER = {'release:patch': 1, 'release:minor': 2, 'release:major': 3}


def reserved_versions(bucket):
    if not re.fullmatch(r'catus-prod-deploy-artifacts-[a-z0-9-]+', bucket):
        raise ValueError('Catus 버전 버킷 오류')
    response = subprocess.check_output(['aws', '--region', 'ap-northeast-2', 's3api', 'list-objects-v2',
        '--bucket', bucket, '--prefix', 'versions/', '--query', 'Contents[].Key', '--output', 'json'], text=True)
    keys = json.loads(response) or []
    if not isinstance(keys, list) or any(not isinstance(key, str) for key in keys):
        raise ValueError('S3 버전 목록 형식 오류')
    tags = [key[len('versions/'):-len('.json')] for key in keys
            if re.fullmatch(r'versions/catus-v[0-9]+\.[0-9]+\.[0-9]+\.json', key)]
    if not tags:
        return []
    latest = max(tags, key=lambda tag: tuple(map(int, VERSION.fullmatch(tag).groups())))
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory, 'version.json')
        subprocess.run(['aws', '--region', 'ap-northeast-2', 's3api', 'get-object', '--bucket', bucket,
            '--key', f'versions/{latest}.json', str(path)], check=True, stdout=subprocess.DEVNULL)
        envelope = json.loads(path.read_text())
    if envelope.get('version') != latest or not re.fullmatch('[0-9a-f]{40}', envelope.get('source_revision', '')):
        raise ValueError('S3 예약 버전 메타데이터 오류')
    if not re.fullmatch(envelope['source_revision'] + '-[0-9]+-[0-9]+', envelope.get('release_id', '')):
        raise ValueError('S3 예약 릴리스 ID 오류')
    return [envelope]


def validate_order(tags, revision, reservations=(), previous=None):
    versions = [(tuple(map(int, match.groups())), tag) for tag in tags if (match := VERSION.fullmatch(tag))]
    references = [max(versions)[1] + '^{commit}'] if versions else []
    for reservation in reservations:
        # Git 태그 없이 운영자 전환한 성공 기준은 소스가 squash merge되기 전 SHA일 수 있다.
        if reservation['release_id'] != (previous or {}).get('release_id'):
            references.append(reservation['source_revision'])
    for reference in references:
        try:
            subprocess.check_output(['git', 'merge-base', '--is-ancestor', reference, revision], text=True)
        except subprocess.CalledProcessError as error:
            raise ValueError('최신 Catus 발행보다 오래되거나 분기된 소스는 발행할 수 없다') from error


def next_version(tags, labels, previous=None):
    bumps = set(labels) & {'release:major', 'release:minor', 'release:patch'}
    if len(bumps) > 1:
        raise ValueError('릴리스 버전 라벨은 하나만 선택한다')
    tags = list(tags)
    if previous is not None:
        if previous.get('product') != 'catus' or not VERSION.fullmatch(previous.get('version', '')):
            raise ValueError('Catus prod 기준 버전 오류')
        tags.append(previous['version'])
    versions = [tuple(map(int, match.groups())) for tag in tags if (match := VERSION.fullmatch(tag))]
    if not versions:
        return 'catus-v2.0.0'
    major, minor, patch = max(versions)
    bump = next(iter(bumps), 'release:patch')
    if bump == 'release:major':
        major, minor, patch = major + 1, 0, 0
    elif bump == 'release:minor':
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return f'catus-v{major}.{minor}.{patch}'


def published_base(tags, reservations, previous):
    candidates = []
    if previous and VERSION.fullmatch(previous.get('version', '')):
        candidates.append((previous['version'], 0, previous.get('source_revision')))
    candidates += [(item['version'], 1, item['source_revision']) for item in reservations]
    candidates += [(tag, 2, tag + '^{commit}') for tag in tags if VERSION.fullmatch(tag)]
    if not candidates:
        return None
    _, kind, reference = max(candidates, key=lambda item: (tuple(map(int, VERSION.fullmatch(item[0]).groups())), item[1]))
    return subprocess.check_output(['git', 'rev-parse', reference], text=True).strip() if kind == 2 else reference


def release_labels(revision, base_revision):
    def candidates():
        command = ['git', 'rev-list', '--reverse', '--first-parent', revision]
        descendants = None
        if base_revision:
            # 수동 전환의 PR 검증 SHA가 squash된 경우 실제 통합 이력의 공통 조상을 기준으로 한다.
            boundary = subprocess.check_output(['git', 'merge-base', base_revision, revision], text=True).strip()
            command.append('^' + boundary)
            # first-parent만 보면 기준 이전 Gromo의 별도 release 이력이 다시 포함된다.
            # 실제 후손 집합은 양쪽 부모를 따라 구하고, 릴리스 라벨은 첫 부모 경로에서만 읽는다.
            descendants = set(subprocess.check_output(
                ['git', 'rev-list', '--ancestry-path', revision, '^' + boundary], text=True).splitlines())
        revisions = subprocess.check_output(command, text=True).splitlines()
        return revisions if descendants is None else [sha for sha in revisions if sha in descendants]
    try:
        revisions = candidates()
    except subprocess.CalledProcessError:
        if not base_revision:
            raise
        # 운영자 전환의 원본 SHA가 squash merge 뒤 브랜치 삭제로 로컬에 없을 수 있다.
        subprocess.check_output(['git', 'fetch', '--no-tags', 'origin', base_revision], text=True)
        revisions = candidates()
    labels = []
    for sha in revisions:
        response = subprocess.check_output(['gh', 'api', '--paginate', '--slurp',
            f'repos/{os.environ["GITHUB_REPOSITORY"]}/commits/{sha}/pulls'], text=True)
        for page in json.loads(response):
            for pr in page:
                if not pr.get('merged_at') or pr['base']['ref'] != 'release' or pr.get('merge_commit_sha') != sha:
                    continue
                selected = {label['name'] for label in pr['labels']} & BUMP_ORDER.keys()
                if len(selected) > 1:
                    raise ValueError('릴리스 PR의 버전 라벨은 하나만 선택한다')
                labels.extend(selected)
    return [max(labels, key=BUMP_ORDER.get)] if labels else []


def validate_fixed(version, tags, reservations, previous, revision, infra_revision, run_id):
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('고정 버전 형식 오류')
    known = list(tags) + [item['version'] for item in reservations]
    if previous:
        known.append(previous['version'])
    versions = [tuple(map(int, match.groups())) for tag in known if (match := VERSION.fullmatch(tag))]
    fixed = tuple(map(int, VERSION.fullmatch(version).groups()))
    if not versions or fixed > max(versions):
        return
    if fixed == max(versions) and any(item['version'] == version and item['source_revision'] == revision
            and item.get('infra_revision') == infra_revision and item['release_id'].split('-')[1] == run_id
            for item in reservations):
        return
    raise ValueError('고정 버전이 최신 버전보다 크지 않거나 다른 실행에 예약됨 — 새 발행 실행 필요')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True)
    parser.add_argument('--plan-file', type=Path, required=True)
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--check-order-only', action='store_true')
    parser.add_argument('--fixed-version')
    parser.add_argument('--run-id')
    parser.add_argument('--infra-revision')
    parser.add_argument("--bump", choices=["major", "minor", "patch"])
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.revision):
        raise ValueError('SHA 형식 오류')
    tags = subprocess.check_output(['git', 'tag', '-l', 'catus-v*'], text=True).splitlines()
    validate_order(tags, args.revision)
    previous = json.loads(args.plan_file.read_text())['previous']
    reservations = reserved_versions(args.bucket)
    validate_order(tags, args.revision, reservations, previous)
    if args.check_order_only:
        if args.fixed_version:
            validate_fixed(args.fixed_version, tags, reservations, previous, args.revision, args.infra_revision, args.run_id)
        return
    # 이전 실행이 예약 전에 실패해도 릴리스 PR의 버전 증가 의도를 잃지 않는다.
    labels = release_labels(args.revision, published_base(tags, reservations, previous))
    if args.bump:
        labels.append('release:' + args.bump)
    labels = [max(labels, key=BUMP_ORDER.get)] if labels else []
    tags += [item['version'] for item in reservations]
    print(next_version(tags, labels, previous))


if __name__ == '__main__':
    main()
