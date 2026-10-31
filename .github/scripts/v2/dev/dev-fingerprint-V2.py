#!/usr/bin/env python3
"""고정된 Git 트리에서 dev V2 서비스별 빌드 입력 지문을 만든다."""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

SERVICES = ('data-api', 'realtime', 'business-api', 'notification')
SHARED = ('.dockerignore', '.github/actions/ci-jar', '.github/actions/gar-login', '.github/scripts/ci-jar.py',
          '.github/workflows/be-gradle.yml')
BUILD_INPUTS = {
    'data-api': ('.github/workflows/data-api-ci.dev-v2.yml', '.github/workflows/realtime-ci.dev-v2.yml'),
    'realtime': ('.github/workflows/data-api-ci.dev-v2.yml', '.github/workflows/realtime-ci.dev-v2.yml'),
    'business-api': ('.github/workflows/satellite-ci.dev-v2.yml', '.github/workflows/satellite-check.yml', '.github/scripts/satellite-ci-plan.py'),
    'notification': ('.github/workflows/satellite-ci.dev-v2.yml', '.github/workflows/satellite-check.yml', '.github/scripts/satellite-ci-plan.py'),
}


def fingerprint(revision):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('전체 Git 커밋 SHA가 필요합니다')
    # ls-tree records mode, object type, object SHA and path, so renames, executable
    # bits and deletions affect the digest as well as file contents.
    def tree(paths):
        return subprocess.run(['git', 'ls-tree', '-r', '-z', '--full-tree', revision, '--', *paths],
                              check=True, stdout=subprocess.PIPE).stdout
    shared = tree(SHARED)
    result = {}
    for service in SERVICES:
        own = tree((f'server/{service}',))
        if not own:
            raise ValueError(f'{service} 소스가 커밋에 없습니다')
        result[service] = hashlib.sha256(b'dev-v2-build-input-v2\0' + shared + tree(BUILD_INPUTS[service]) + own).hexdigest()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(fingerprint(args.revision), indent=2, sort_keys=True) + '\n')


if __name__ == '__main__':
    main()
