#!/usr/bin/env python3
"""Catus 릴리스 PR 라벨로 버전을 정한다. Gromo v* 태그는 참조하지 않는다."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

VERSION = re.compile(r'^catus-v(\d+)\.(\d+)\.(\d+)$')


def next_version(tags, labels, previous=None, published_tags=()):
    bumps = set(labels) & {'release:major', 'release:minor', 'release:patch'}
    if len(bumps) > 1:
        raise ValueError('릴리스 버전 라벨은 하나만 선택한다')
    tags = list(tags)
    if previous is not None:
        if previous.get('product') != 'catus' or not VERSION.fullmatch(previous.get('version', '')):
            raise ValueError('Catus prod 기준 버전 오류')
        tags.append(previous['version'])
    published = [tuple(map(int, match.groups())) for tag in published_tags
                 if (match := VERSION.fullmatch(tag))]
    if published:
        return 'catus-v' + '.'.join(map(str, max(published)))
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True)
    parser.add_argument('--plan-file', type=Path, required=True)
    parser.add_argument("--bump", choices=["major", "minor", "patch"])
    args = parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}', args.revision):
        raise ValueError('SHA 형식 오류')
    tags = subprocess.check_output(['git', 'tag', '-l', 'catus-v*'], text=True).splitlines()
    published = subprocess.check_output(['git', 'tag', '--points-at', args.revision, '-l', 'catus-v*'], text=True).splitlines()
    # 조회 실패를 patch로 숨기지 않는다. 머지된 릴리스 PR만 버전 라벨을 공급한다.
    response = subprocess.check_output(['gh', 'api', '--paginate', '--slurp',
        f'repos/{os.environ["GITHUB_REPOSITORY"]}/commits/{args.revision}/pulls'], text=True)
    prs = [pr for page in json.loads(response) for pr in page if pr.get('merged_at') and
           pr['base']['ref'] == 'release' and pr.get('merge_commit_sha') == args.revision]
    labels = [label['name'] for pr in prs for label in pr['labels']]
    previous = json.loads(args.plan_file.read_text())['previous']
    print(next_version(tags, ["release:" + args.bump] if args.bump else labels, previous, published))


if __name__ == '__main__':
    main()
