#!/usr/bin/env python3
"""스모크 TSV만 요약한다. API 토큰·응답 본문은 보고서에 포함하지 않는다."""
import csv
import datetime
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request


def api(method, path, payload=None):
    base = os.environ.get('GITHUB_API_URL', 'https://api.github.com')
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f'{base}/repos/{os.environ["GITHUB_REPOSITORY"]}{path}', data=data, method=method,
        headers={'Authorization': f'Bearer {os.environ["GH_TOKEN"]}',
                 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read()
        return json.loads(body) if body else None


def ignore_missing(method, path, payload=None):
    try:
        return api(method, path, payload)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise


def read_rows(directory):
    rows = []
    for filename in sorted(Path(directory).rglob('results.tsv')):
        with filename.open() as file:
            for row in csv.DictReader(file, delimiter='\t'):
                tc = row.get('id', row.get('tc_id', row.get('tc', '')))
                if tc.startswith('SMOKE-SERVER-'):
                    rows.append((tc, row.get('status', 'FAIL'), row.get('ms', ''),
                                 row.get('reason', row.get('detail', ''))))
    return rows


def report(directory):
    rows = read_rows(directory)
    jobs = [('external', os.environ['EXTERNAL_RESULT']),
            ('internal', os.environ['INTERNAL_RESULT'])]
    if os.environ.get('CORE_REQUESTED') == 'true':
        jobs.append(('core-flow', os.environ['CORE_RESULT']))
    failed = not rows or any(status != 'success' for _, status in jobs)
    failed = failed or any(status != 'PASS' for _, status, _, _ in rows)
    numbers = [*range(1, 11), 17, 18]
    if os.environ.get('CORE_REQUESTED') == 'true':
        numbers.extend([14, 15, 16])
    expected = {f'SMOKE-SERVER-{number:03}' for number in numbers}
    present = {tc for tc, _, _, _ in rows}
    missing = expected - present
    failed = failed or bool(missing)
    rows.extend((tc, 'FAIL', '', '실행 결과 누락') for tc in sorted(missing))
    table = ['| TC | 결과 | ms | 사유 |', '|---|---|---|---|']
    for row in rows:
        table.append('| ' + ' | '.join(value.replace('|', '\\|').replace('\n', ' ') for value in row) + ' |')
    summary = ('## dev 서버 스모크 ' + ('실패' if failed else '통과') + '\n\n'
               + ' · '.join(f'{job}: {result}' for job, result in jobs) + '\n\n'
               + '\n'.join(table) + '\n\n'
               + f'[실행 기록]({os.environ["RUN_URL"]})\n\n'
               + '재현: `BASE_URL=https://oneorthree.dev.mooo.com smoke/server/run.sh`\n')
    with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as file:
        file.write(summary)
    revision = os.environ.get('DEPLOY_REVISION', '')
    if revision:
        prs = api('GET', f'/commits/{revision}/pulls?per_page=100')
        pr = next((pr for pr in prs if pr.get('merged_at')), None)
        if pr:
            number = pr['number']
            label = 'smoke-failed:dev'
            if failed:
                if ignore_missing('GET', f'/labels/{label}') is None:
                    api('POST', '/labels', {'name': label, 'color': 'D93F0B',
                                          'description': 'dev 배포 후 스모크 테스트 실패'})
                api('POST', f'/issues/{number}/labels', {'labels': [label]})
                api('POST', f'/issues/{number}/comments', {'body': summary})
            else:
                ignore_missing('DELETE', f'/issues/{number}/labels/{label}')
    elif os.environ.get('SMOKE_EVENT') == 'schedule':
        # 전용 마커로 사람이 만든 다른 이슈와 구별하고 페이지 전체를 조회한다.
        marker = '<!-- gromo-dev-smoke -->'
        opened = []
        page = 1
        while True:
            items = api('GET', f'/issues?state=open&per_page=100&page={page}')
            opened.extend(issue for issue in items if not issue.get('pull_request')
                          and marker in (issue.get('body') or ''))
            if len(items) < 100:
                break
            page += 1
        if failed:
            body = marker + '\n' + summary
            if opened:
                api('POST', f'/issues/{opened[0]["number"]}/comments', {'body': body})
            else:
                day = (datetime.datetime.now(datetime.timezone.utc)
                       + datetime.timedelta(hours=9)).date().isoformat()
                api('POST', '/issues', {'title': f'[smoke] dev 실패 — {day}', 'body': body})
        else:
            for issue in opened:
                api('POST', f'/issues/{issue["number"]}/comments', {'body': summary})
                api('PATCH', f'/issues/{issue["number"]}', {'state': 'closed'})
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(report(sys.argv[1]))
