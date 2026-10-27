#!/usr/bin/env python3
"""재실행 요청 접수와 새 attempt의 실제 배포 job 완료를 구분한다."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', 'repos/' + os.environ['GH_REPO'] + path]))


def outcome(jobs, job_name):
    matches = [job for job in jobs if job.get('name') == job_name]
    if not matches or any(job.get('status') != 'completed' for job in matches):
        return 'waiting'
    return 'success' if all(job.get('conclusion') == 'success' for job in matches) else 'failure'


def wait(run_id, previous_attempt, job_name, read=api):
    deadline = time.monotonic() + 2400
    while time.monotonic() < deadline:
        run = read(f'/actions/runs/{run_id}')
        attempt = run.get('run_attempt', 1)
        if attempt > previous_attempt:
            jobs = []
            try:
                for page in range(1, 101):
                    batch = read(f'/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page={page}')['jobs']
                    jobs.extend(batch)
                    if len(batch) < 100:
                        break
                else:
                    raise RuntimeError('재배포 job 페이지 상한 초과')
            except subprocess.CalledProcessError:
                # attempt가 증가한 직후 job 목록 등록이 늦을 수 있다. 성공으로 추정하지 않는다.
                time.sleep(15)
                continue
            state = outcome(jobs, job_name)
            print(f'재배포 run {run_id}/{attempt}: {state}', flush=True)
            if state != 'waiting':
                return state, attempt
        time.sleep(15)
    return 'timeout', None


def main():
    run_id, previous, job_name = sys.argv[1:]
    if not run_id.isdigit() or not previous.isdigit():
        raise ValueError('재배포 실행 식별자 오류')
    state, attempt = wait(run_id, int(previous), job_name)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with Path(summary).open('a') as file:
            file.write(f'\n- 실제 배포 결과: **{state}** · run {run_id} / attempt {attempt or "확인 불가"}\n')
    return 0 if state == 'success' else 1


if __name__ == '__main__':
    raise SystemExit(main())
