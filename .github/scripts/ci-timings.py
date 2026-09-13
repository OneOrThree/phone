#!/usr/bin/env python3
"""Actions 실행 기록에서 러너 대기와 실행 시간을 분리해 JSON으로 보관한다."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess


def seconds(start, end):
    return (datetime.fromisoformat(end.replace('Z', '+00:00'))
            - datetime.fromisoformat(start.replace('Z', '+00:00'))).total_seconds()


def job_record(job):
    fields = ('id', 'name', 'status', 'conclusion', 'created_at', 'started_at',
              'completed_at', 'runner_name', 'html_url')
    record = {key: job.get(key) for key in fields}
    # queued인데 started_at=created_at으로 채워지는 API 응답을 0초 대기로 오독하지 않는다.
    started = bool(job.get('runner_name')) and job['status'] != 'queued'
    record['queue_seconds'] = (seconds(job['created_at'], job['started_at'])
                               if started and job.get('started_at') else None)
    record['execution_seconds'] = (seconds(job['started_at'], job['completed_at'])
                                   if started and job.get('completed_at') else None)
    record['steps'] = [{key: step.get(key) for key in
                        ('name', 'status', 'conclusion', 'started_at', 'completed_at')}
                       for step in job.get('steps', [])]
    return record


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def collect(repo, run_id):
    prefix = f'repos/{repo}/actions/runs/{run_id}'
    run = api(prefix)
    result = {key: run.get(key) for key in
              ('id', 'name', 'head_sha', 'event', 'run_attempt', 'status', 'conclusion',
               'created_at', 'updated_at', 'html_url')}
    result['collected_at'] = datetime.now(timezone.utc).isoformat()
    result['jobs'] = []
    page = 1
    while True:
        batch = api(f'{prefix}/attempts/{run["run_attempt"]}/jobs?per_page=100&page={page}')
        result['jobs'].extend(job_record(job) for job in batch['jobs'])
        if len(batch['jobs']) < 100:
            break
        page += 1
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='OneOrThree/phone')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('run_ids', type=int, nargs='+')
    args = parser.parse_args()
    records = [collect(args.repo, run_id) for run_id in args.run_ids]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
    print(args.output)


if __name__ == '__main__':
    main()
