#!/usr/bin/env python3
"""앱 검증 입력과 플랫폼별 자동 게시 입력을 구분한다."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def runtime_input(path, platform):
    if not path.startswith('app/app-dev/'):
        return False
    relative = path.removeprefix('app/app-dev/')
    if (path.endswith(('.md', '.mdx', '.rst', '.txt'))
            or re.search(r'(^|/)(__tests__|__mocks__|tests|docs|\.docs)/|\.(test|spec)\.[^/]+$', relative)
            or re.search(r'(^|/)jest\.[^/]+$', relative)
            or re.search(r'android/(?:.*/)?src/(test|androidTest)/', relative)):
        return False
    other = 'ios' if platform == 'android' else 'android'
    if path == 'app/app-dev/ios/release-config.sh':
        return True
    if relative.startswith(other + '/') or re.search(r'/'+other+r'/', relative) or re.search(r'\.'+other+r'\.[^/]+$', relative):
        return False
    # 배포 도구 자체를 바꿔도 자동 게시하지 않는다. 수동 실행으로 검증 가능하다.
    if relative.startswith('ios/') and path.endswith(('.sh', '.rb')):
        return False
    return True


def plan(paths, platform):
    publish = any(runtime_input(path, platform) for path in paths)
    build = publish or any(path.startswith('.github/') for path in paths)
    if platform == 'ios':
        build = publish
    return {'build': build, 'publish': publish}


def changed_paths(event, event_name):
    if event_name == 'push':
        before, after = event['before'], event['after']
        separator = '..'
    elif event_name == 'pull_request':
        before, after = event['pull_request']['base']['sha'], event['pull_request']['head']['sha']
        separator = '...'
    else:
        raise ValueError('변경 범위를 확인할 수 없는 이벤트')
    if any(not re.fullmatch('[0-9a-f]{40}', sha) or sha == '0' * 40 for sha in (before, after)):
        raise ValueError('변경 범위 SHA 오류')
    return [path for path in subprocess.check_output([
        'git', 'diff', '--no-renames', '--name-only', '-z', before + separator + after, '--',
    ]).decode().split('\0') if path]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=['android', 'ios'], required=True)
    args = parser.parse_args()
    event_name = os.environ['GITHUB_EVENT_NAME']
    if event_name == 'workflow_dispatch':
        # CI 수동 검증도 자동 게시하지 않는다. CD의 명시적 수동 실행은 별도 허용한다.
        result = {'build': True, 'publish': False}
    else:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        result = plan(changed_paths(event, event_name), args.platform)
        if event_name == 'pull_request':
            result['publish'] = False
    print(json.dumps(result))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        for key, value in result.items():
            output.write(f'{key}={str(value).lower()}\n')


if __name__ == '__main__':
    main()
