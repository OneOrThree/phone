#!/usr/bin/env python3
"""일회용 CI AAB는 경고 정책을 따르고, 로컬 운영 빌드는 출시 검사를 수행한다."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--signing-alias', required=True)
    args = parser.parse_args()
    if os.environ.get('GROMO_ANDROID_CI_ARTIFACT') == '1':
        # CI에는 업로드 키가 없다. GitHub 입력은 보안 인증이 아니라 로컬 오설정 방지다.
        # CD가 GitHub API로 원본 workflow·main SHA·attempt·AAB를 별도로 검증한다.
        expected = {'GITHUB_ACTIONS': 'true', 'GITHUB_WORKFLOW': 'Android CI',
                    'GITHUB_JOB': 'build', 'GITHUB_REPOSITORY': 'OneOrThree/phone'}
        valid = all(os.environ.get(key) == value for key, value in expected.items())
        valid = valid and all(re.fullmatch('[1-9][0-9]*', os.environ.get(key, ''))
                              for key in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'))
        valid = valid and re.fullmatch('[0-9a-f]{40}', os.environ.get('GITHUB_SHA', ''))
        if not valid or args.signing_alias != 'ci-throwaway':
            print('Android CI 산출물 설정 오류: 지정 CI build 잡과 일회용 서명만 허용합니다.', file=sys.stderr)
            return 1
        print('Android CI 일회용 AAB: 서버 검사는 별도 server-gate 잡의 경고로 기록합니다. '
              'Play internal 게시와 운영 트랙 승격은 별도입니다.')
        return 0
    return subprocess.run([sys.executable, str(ROOT / '.github/scripts/app-server-gate.py')]).returncode


if __name__ == '__main__':
    sys.exit(main())
