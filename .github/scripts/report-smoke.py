#!/usr/bin/env python3
"""TSV 전체 15개를 판정한다. workflow exit 상태가 main 전용 Actions 배지가 된다."""
import csv
import os
from pathlib import Path
import sys

EXPECTED = {f'SMOKE-SERVER-{n:03}' for n in [*range(1, 11), *range(14, 19)]}


def read_rows(directory):
    rows = []
    for filename in sorted(Path(directory).rglob('results.tsv')):
        with filename.open() as file:
            for row in csv.DictReader(file, delimiter='\t'):
                tc = row.get('id', '')
                if tc.startswith('SMOKE-SERVER-'):
                    rows.append((tc, row.get('status', 'FAIL'), row.get('ms', ''), row.get('reason', '')))
    return rows


def report(directory):
    rows = read_rows(directory)
    result = os.environ.get('SMOKE_RUN_RESULT', 'failure')
    wait = os.environ.get('DEPLOY_WAIT_RESULT', 'skipped')
    event = os.environ.get('SMOKE_EVENT_NAME', 'push')
    wait_ok = wait == 'success' or (event == 'workflow_dispatch' and wait == 'skipped')
    missing = EXPECTED - {tc for tc, _, _, _ in rows}
    failed = result != 'success' or not wait_ok or bool(missing)
    failed = failed or any(status != 'PASS' for _, status, _, _ in rows)
    rows.extend((tc, 'FAIL', '', '배포 선행 실패 또는 실행 결과 누락') for tc in sorted(missing))
    table = ['| TC | 결과 | ms | 사유 |', '|---|---|---|---|']
    for row in rows:
        table.append('| ' + ' | '.join(value.replace('|', '\\|').replace('\n', ' ') for value in row) + ' |')
    summary = ('## 서버 스모크 ' + ('실패' if failed else '통과') + '\n\n'
               + f'배포 대기: {wait} · 실행: {result}\n\n' + '\n'.join(table) + '\n\n'
               + f'[실행 기록]({os.environ["RUN_URL"]})\n')
    with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as file:
        file.write(summary)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(report(sys.argv[1]))
