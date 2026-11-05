#!/usr/bin/env python3
"""앱 버전 이름을 git 태그로 정한다(GROMO-2731).

게시한 빌드마다 `app-<버전>-<android|ios>-<빌드>` 태그가 붙는다(Android CD·fastlane beta).
다음 버전은 그 플랫폼 태그 중 최대 버전의 patch + 1 이고, 파일 값(build.gradle·pbxproj)은 하한이다.
minor·major 는 하한을 PR 로 올린다. 서버가 발행마다 catus-v*-V2 의 patch 를 올리는 것과 같은 방식이다.
"""
import argparse
import re
import subprocess
import sys

VERSION = re.compile(r'(\d+)\.(\d+)\.(\d+)')


def parse(value):
    match = VERSION.fullmatch(value or '')
    if not match:
        raise ValueError(f'버전 형식은 X.Y.Z 다: {value!r}')
    return tuple(int(part) for part in match.groups())


def text(version):
    return '.'.join(map(str, version))


def published(names, platform):
    """태그 이름에서 이 플랫폼의 (버전, 빌드) 를 뽑는다. 다른 플랫폼·1.x 태그는 건너뛴다."""
    pattern = re.compile(r'app-(\d+\.\d+\.\d+)-' + re.escape(platform) + r'-(\d+)')
    return {(parse(m.group(1)), int(m.group(2))) for m in map(pattern.fullmatch, names) if m}


def next_version(names, platform, floor):
    versions = [version for version, _ in published(names, platform)]
    candidate = parse(floor)
    if versions:
        top = max(versions)
        candidate = max((top[0], top[1], top[2] + 1), candidate)
    return text(candidate)


def check(names, platform, version, build):
    """게시 전 검사. 같은 버전·빌드 태그가 이미 있으면 재실행이라 통과, 아니면 직전 태그보다 커야 한다."""
    tags = published(names, platform)
    current = parse(version)
    if (current, int(build)) in tags:
        return
    if tags and current <= max(v for v, _ in tags):
        raise ValueError(f'버전 {version} 이 직전 앱 태그 {text(max(v for v, _ in tags))} 보다 크지 않다 — 게시하지 않는다')


def names_from_ls_remote(output):
    names = set()
    for line in output.splitlines():
        if 'refs/tags/' in line:
            names.add(line.split('refs/tags/', 1)[1].removesuffix('^{}'))
    return names


def remote_tags():
    # 얕은·희소 checkout 에도 태그가 다 보이도록 원격에서 읽는다.
    return names_from_ls_remote(subprocess.check_output(
        ['git', 'ls-remote', '--tags', 'origin', 'refs/tags/app-*'], text=True, timeout=60))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['next', 'check'])
    parser.add_argument('--platform', choices=['android', 'ios'], required=True)
    parser.add_argument('--floor', help='next: 파일에 적힌 하한 버전')
    parser.add_argument('--version', help='check: 게시할 버전 이름')
    parser.add_argument('--build', help='check: 게시할 빌드 번호(versionCode)')
    args = parser.parse_args()
    if args.operation == 'check' and not (args.version and args.build and args.build.isdigit()):
        parser.error('check 에는 --version 과 숫자 --build 가 필요하다')
    try:
        if args.operation == 'next':
            print(next_version(remote_tags(), args.platform, args.floor))
        else:
            check(remote_tags(), args.platform, args.version, args.build)
            print(f'버전 {args.version} — 직전 앱 태그보다 크다')
    except ValueError as error:
        # next 는 워크플로가 출력을 변수로 받으므로 오류는 stderr 로 낸다.
        print(f'::error::{error}', file=sys.stdout if args.operation == 'check' else sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
