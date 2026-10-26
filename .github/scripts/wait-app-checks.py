#!/usr/bin/env python3
"""자동 업로드 전에 동일 main push SHA의 필수 앱 검사를 확인한다."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deploy_wait', Path(__file__).with_name('wait-smoke-deploy.py'))
github = importlib.util.module_from_spec(spec)
spec.loader.exec_module(github)


def required_workflows(platform, paths, native_patterns):
    required = {'app-lint.yml'}
    if platform == 'android' and github.matches_paths(paths, native_patterns):
        required.add('app-android-build.yml')
    return required


def checks_verdict(expected, runs, revision):
    current = {}
    for run in runs:
        name = run.get('path', '').split('@')[0].rsplit('/', 1)[-1]
        if name in expected and run.get('event') == 'push' and run.get('head_branch') == 'main' and run.get('head_sha') == revision:
            if name not in current or (run['id'], run.get('run_attempt', 1)) > (current[name]['id'], current[name].get('run_attempt', 1)):
                current[name] = run
    for name in sorted(expected):
        run = current.get(name)
        if not run or run['status'] != 'completed':
            return 'waiting', name
        if run['conclusion'] != 'success':
            return 'failure', name
    return 'success', ', '.join(sorted(expected))


def main():
    import yaml
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    revision = os.environ['GITHUB_SHA']
    if os.environ['GITHUB_EVENT_NAME'] != 'push' or event.get('after') != revision:
        raise ValueError('자동 앱 gate는 main push 전용이다. 수동 실행은 직접 검사한다.')
    paths = subprocess.check_output(['git', 'diff', '--no-renames', '--name-only', '-z', event['before'], revision, '--']).decode().split('\0')
    native = yaml.load((ROOT / '.github/workflows/app-android-build.yml').read_text(), Loader=yaml.BaseLoader)
    expected = required_workflows(os.environ['APP_PLATFORM'], paths, native['on']['push']['paths'])
    deadline = time.monotonic() + 2400
    while True:
        state, reason = checks_verdict(expected, github.pages('/actions/runs?head_sha=' + revision, 'workflow_runs'), revision)
        print(state + ': ' + reason, flush=True)
        if state == 'success':
            return 0
        if state == 'failure' or time.monotonic() >= deadline:
            return 1
        time.sleep(30)


if __name__ == '__main__':
    raise SystemExit(main())
