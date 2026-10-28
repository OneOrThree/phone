#!/usr/bin/env python3
"""TSV 전체 15개를 판정한다. workflow exit 상태가 main 전용 Actions 배지가 된다."""
import csv
import json
import os
from pathlib import Path
import re
import sys

EXPECTED = {f'SMOKE-SERVER-{n:03}' for n in [*range(1, 11), *range(14, 19)]}


def login_summary(directory):
    """기기·토큰 없는 최종 진단만 표시한다. 중간 실패는 TC 최종 FAIL로 세지 않는다."""
    table = []
    for path in sorted(Path(directory).rglob('auth-attempts.jsonl')):
        for line in path.read_text().splitlines():
            row = json.loads(line)
            if row.get('kind') == 'attempt':
                continue
            if (row.get('kind') != 'result'
                    or row.get('role') not in {'main', 'friend-owner', 'friend-peer', 'core', 'statistics'}
                    or row.get('result') not in {'success', 'deadline', 'budget_exhausted', 'max_attempts', 'non_retryable'}
                    or any(type(row.get(key)) is not int or row[key] < 0
                           for key in ('attempts', 'retries', 'elapsed_ms'))
                    or row['attempts'] > 3 or row['retries'] != max(0, row['attempts'] - 1)
                    or not re.fullmatch(r'(?:|DEADLINE|HTTP_[0-9]{3}|CURL_-?[0-9]{1,3}|UPSTREAM_TIMEOUT|'
                                        r'SERVICE_UNAVAILABLE|UPSTREAM_AUTH_FAILED|UPSTREAM_CONTRACT_ERROR|'
                                        r'RATE_LIMITED|INVALID_REQUEST|UNAUTHORIZED|FORBIDDEN)', row.get('first_error', ''))):
                raise ValueError('로그인 진단 형식 오류')
            status = ('재시도 후 통과' if row['retries'] else '첫 요청 통과') if row['result'] == 'success' else '실패: ' + row['result']
            table.append(f"| {row['role']} | {status} | {row['attempts']} | {row['retries']} | "
                         f"{row['elapsed_ms']} | {row['first_error'] or '-'} |")
    if not table:
        return ''
    return ('### 게스트 로그인 시도\n\n| 용도 | 결과 | 요청 횟수 | 재시도 | 전체 ms | 최초 실패 |\n'
            '|---|---|---|---|---|---|\n' + '\n'.join(table) + '\n\n')


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
    if (os.environ.get('SMOKE_EVENT_NAME', 'push') == 'push'
            and os.environ.get('DEPLOY_WAIT_RESULT') == 'success'
            and (os.environ.get('SMOKE_NEEDED') == 'false'
                 or (os.environ.get('SMOKE_TARGET_STATE') == 'superseded'
                     and os.environ.get('SMOKE_RUN_RESULT') == 'success'))):
        reason = ('후속 SHA로 대상 대체됨' if os.environ.get('SMOKE_DISPOSITION') == 'superseded' or os.environ.get('SMOKE_TARGET_STATE') == 'superseded' else '서버 배포 대상 없음')
        with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as file:
            file.write('## 서버 스모크 미실행\n\n' + reason + ' — 기능 검사 통과 증거로 사용하지 않는다.\n')
        return 0
    rows = read_rows(directory)
    result = os.environ.get('SMOKE_RUN_RESULT', 'failure')
    wait = os.environ.get('DEPLOY_WAIT_RESULT', 'skipped')
    event = os.environ.get('SMOKE_EVENT_NAME', 'push')
    wait_ok = wait == 'success' or (event == 'workflow_dispatch' and wait == 'skipped')
    missing = EXPECTED - {tc for tc, _, _, _ in rows}
    failed = result != 'success' or not wait_ok or bool(missing)
    failed = failed or any(status != 'PASS' for _, status, _, _ in rows)
    try:
        auth_summary = login_summary(directory)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        failed, auth_summary = True, '로그인 진단을 읽지 못했습니다. 실행 기록을 확인하세요.\n\n'
    rows.extend((tc, 'FAIL', '', '배포 선행 실패 또는 실행 결과 누락') for tc in sorted(missing))
    table = ['| TC | 결과 | ms | 사유 |', '|---|---|---|---|']
    for row in rows:
        table.append('| ' + ' | '.join(value.replace('|', '\\|').replace('\n', ' ') for value in row) + ' |')
    summary = ('## 서버 스모크 ' + ('실패' if failed else '통과') + '\n\n'
               + f'배포 대기: {wait} · 실행: {result}\n\n' + '\n'.join(table) + '\n\n'
               + auth_summary + f'[실행 기록]({os.environ["RUN_URL"]})\n')
    with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as file:
        file.write(summary)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(report(sys.argv[1]))
