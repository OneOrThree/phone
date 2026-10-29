#!/usr/bin/env python3
"""PR 대상과 실행 이벤트로 전체 기능 검사·운영 승격을 구분한다."""
import json
import os
from pathlib import Path


def policy(event_name, event, repository, ref):
    pr = event.get('pull_request', {})
    base = pr.get('base', {}).get('ref')
    head = pr.get('head', {})
    promotion = (event_name == 'pull_request' and base == 'release'
                 and head.get('ref') == 'main'
                 and head.get('repo', {}).get('full_name') == repository)
    labels = [label['name'] for label in pr.get('labels', [])
              if label.get('name', '').startswith('release:')]
    if promotion and (len(labels) > 1 or any(label not in {
            'release:major', 'release:minor', 'release:patch'} for label in labels)):
        raise ValueError('운영 승격 버전 라벨은 release:major|minor|patch 중 최대 하나다')
    checks = ((event_name == 'pull_request' and base in {'main', 'release'} and not promotion)
              or event_name == 'workflow_dispatch'
              or (event_name == 'push' and ref in {'refs/heads/main', 'refs/heads/release'}))
    return {'promotion': promotion, 'full-checks': checks,
            'version-bump': labels[0].split(':', 1)[1] if promotion and labels else 'patch'}


def main():
    result = policy(os.environ['GITHUB_EVENT_NAME'],
                    json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()),
                    os.environ['GITHUB_REPOSITORY'], os.environ.get('GITHUB_REF', ''))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        for key, value in result.items():
            output.write(f'{key}={str(value).lower()}\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
