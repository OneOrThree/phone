#!/usr/bin/env python3
"""일회용 서명 AAB와 원본 CI 실행을 checksum 메타데이터로 연결한다."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import zipfile


def version_code(base, floor, run_number):
    values = [str(value) for value in (base or floor, floor, run_number)]
    if any(not re.fullmatch('[1-9][0-9]*', value) for value in values):
        raise ValueError('versionCode 기준값·run_number는 양의 정수여야 한다')
    code = max(int(values[0]), int(values[1])) + int(values[2])
    if code > 2100000000:
        raise ValueError('Android versionCode 상한 초과')
    return code


def checksum(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def identity():
    values = {'revision': os.environ['SOURCE_REVISION'], 'run_id': os.environ['SOURCE_RUN_ID'],
              'run_attempt': os.environ['SOURCE_ATTEMPT']}
    if not re.fullmatch('[0-9a-f]{40}', values['revision']) or any(
            not re.fullmatch('[1-9][0-9]*', values[key]) for key in ('run_id', 'run_attempt')):
        raise ValueError('원본 CI 실행 식별자 오류')
    return values


def verify(directory, expected):
    root = Path(directory)
    metadata = json.loads((root / 'metadata.json').read_text())
    keys = {'schema', 'revision', 'run_id', 'run_attempt', 'version_code', 'sha256', 'publish'}
    if set(metadata) != keys or metadata['schema'] != 2 or type(metadata.get('publish')) is not bool:
        raise ValueError('Android 산출물 메타데이터 형식 오류')
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError('Android 산출물의 원본 SHA·run·attempt 불일치')
    code = metadata['version_code']
    if type(code) is not int or not 0 < code <= 2100000000:
        raise ValueError('Android 산출물 versionCode 오류')
    if not re.fullmatch('[0-9a-f]{64}', metadata['sha256']) or checksum(root / 'app-release.aab') != metadata['sha256']:
        raise ValueError('Android AAB checksum 불일치')
    with zipfile.ZipFile(root / 'app-release.aab') as archive:
        if 'base/manifest/AndroidManifest.xml' not in archive.namelist() or 'BundleConfig.pb' not in archive.namelist():
            raise ValueError('Android App Bundle 구조 오류')
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['version', 'pack', 'verify'])
    parser.add_argument('--directory', type=Path, default=Path('android-ci-artifact'))
    parser.add_argument('--aab', type=Path)
    args = parser.parse_args()
    if args.operation == 'version':
        print(version_code(os.environ.get('ANDROID_VERSION_CODE_BASE'), os.environ['MIN_VERSION_CODE'], os.environ['GITHUB_RUN_NUMBER']))
        return
    expected = identity()
    if args.operation == 'pack':
        if not args.aab:
            parser.error('--aab 필요')
        args.directory.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.aab, args.directory / 'app-release.aab')
        metadata = {**expected, 'schema': 2, 'publish': os.environ.get('PUBLISH_ALLOWED') == 'true', 'version_code': int(os.environ['VERSION_CODE']),
                    'sha256': checksum(args.directory / 'app-release.aab')}
        (args.directory / 'metadata.json').write_text(json.dumps(metadata, sort_keys=True) + '\n')
    metadata = verify(args.directory, expected)
    output = os.environ.get('GITHUB_OUTPUT')
    if output:
        with open(output, 'a') as file:
            file.write(f'version-code={metadata["version_code"]}\n')
            file.write(f'publish={str(metadata["publish"]).lower()}\n')


if __name__ == '__main__':
    main()
