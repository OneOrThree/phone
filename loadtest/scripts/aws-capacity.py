#!/usr/bin/env python3
"""명시한 운영 대상/전용 fixture로 단계 부하를 실행하고 비밀 없는 원시 증거를 저장한다."""
import argparse
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import signal
import ssl
import subprocess
import time
import urllib.parse
import urllib.request
import uuid

from loadtest_evidence import atomic_json, normalize_stage, read_json

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'k6/scenarios/aws_capacity.js'


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


write_json = atomic_json

class StopController:
    def __init__(self):
        self.reason = None

    def receive(self, number, _frame):
        self.reason = self.reason or signal.Signals(number).name

    def wait(self, seconds):
        deadline = time.monotonic() + seconds
        while not self.reason and time.monotonic() < deadline:
            time.sleep(min(.1, max(0, deadline - time.monotonic())))


def cleanup_focus(base, users, limit):
    """전용 fixture의 열린 세션만 종료. 장애 중 재시도 폭주를 막기 위해 3회 연속 오류 시 중단."""
    result = {'checked': 0, 'finished': 0, 'failed': 0, 'complete': True}
    cafile = os.environ.get('SSL_CERT_FILE')
    if not cafile and Path('/etc/ssl/cert.pem').is_file():
        cafile = '/etc/ssl/cert.pem'
    context = ssl.create_default_context(cafile=cafile)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
    consecutive_errors = 0
    for user in users[:limit]:
        try:
            headers = {'Authorization': 'Bearer ' + user['token'], 'Content-Type': 'application/json',
                       'User-Agent': 'catus-loadtest/aws-capacity'}
            request = urllib.request.Request(base + '/focus-sessions/current', headers=headers)
            with opener.open(request, timeout=5) as response:
                current = json.load(response).get('data')
            result['checked'] += 1
            if current and current.get('id'):
                headers['Idempotency-Key'] = str(uuid.uuid4())
                request = urllib.request.Request(
                    base + '/focus-sessions/' + current['id'] + '/finish', headers=headers,
                    data=json.dumps({'expectedVersion': current['version']}).encode(), method='POST')
                with opener.open(request, timeout=5) as response:
                    response.read()
                result['finished'] += 1
            consecutive_errors = 0
        except Exception as error:
            result['failed'] += 1
            result['lastErrorType'] = type(error).__name__
            consecutive_errors += 1
            if consecutive_errors >= 3:
                result['complete'] = False
                break
    return result


def stage(args, case, rate, seconds, key, out, warmup=False):
    summary_path = out / (key + '.json')
    diagnostics_path = out / (key + '-http-diagnostics.jsonl')
    env = {key: value for key, value in os.environ.items() if not key.startswith('K6_')}
    env.update(BASE_URL=args.url, USERS_FILE=str(args.users), RATE=str(rate), SECONDS=str(seconds),
               PRE_VUS=str(min(args.pre_vus, args.max_vus)), MAX_VUS=str(args.max_vus),
               CASE=case['id'], SUMMARY_PATH=str(summary_path), RUN_ID=args.run_id)
    config_path = out / 'k6-config.json'
    write_json(config_path, {})
    checkpoint = {'runId': args.run_id, 'case': case['id'], 'kind': case['kind'], 'key': key,
                  'phase': 'warmup' if warmup else 'measurement', 'targetRate': rate,
                  'plannedSeconds': seconds, 'maxVusConfigured': args.max_vus, 'startedAt': now(),
                  'latencyLimitMs': args.journey_p95_limit if case['kind'] in ('journey', 'write_journey') else args.p95_limit,
                  'rawFile': summary_path.name, 'diagnosticsFile': diagnostics_path.name}
    write_json(out / (key + '-checkpoint.json'), checkpoint)
    start = time.monotonic()
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    status = {'stopReason': None, 'timedOut': False}
    process = None
    print(f'[RUN] {key}: {rate} arrivals/s, {seconds}s', flush=True)
    try:
        process = subprocess.Popen(['k6', 'run', '--config', str(config_path), '--quiet', '--no-usage-report',
                                    '--log-format', 'raw', '--console-output', str(diagnostics_path), str(SCRIPT)],
                                   env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        while process.poll() is None:
            if args.stop.reason or time.monotonic() - start > seconds + 30:
                status['stopReason'] = args.stop.reason or 'STAGE_RUNTIME_LIMIT'
                status['timedOut'] = not bool(args.stop.reason)
                for sig, grace in ((signal.SIGINT, 8), (signal.SIGTERM, 2), (signal.SIGKILL, 2)):
                    if process.poll() is not None:
                        break
                    process.send_signal(sig)
                    try:
                        process.wait(timeout=grace)
                    except subprocess.TimeoutExpired:
                        pass
                break
            time.sleep(.05)
        status['exitCode'] = process.wait(timeout=2)
    except OSError as error:
        status.update(exitCode=-1, launchErrorType=type(error).__name__)
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
        after = resource.getrusage(resource.RUSAGE_CHILDREN)
        wall = time.monotonic() - start
        cpu = after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime
        status.update(endedAt=now(), stopReason=status['stopReason'] or args.stop.reason,
                      summaryExists=summary_path.is_file(), loadgenWallSeconds=round(wall, 3),
                      loadgenCpuSeconds=round(cpu, 3), loadgenCpuCores=round(cpu / wall, 4))
        row = normalize_stage(checkpoint, read_json(summary_path, {}), status)
        write_json(out / (key + '-status.json'), row)
    print(f'[{row["verdict"]}] {key}: RPS={row["actualRps"]}, TPS={row["completedTps"]}', flush=True)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', default=str(uuid.uuid4()))
    parser.add_argument('--url', required=True)
    parser.add_argument('--users', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--cases', default='account,screen_library,app_home_visit,focus_lifecycle')
    parser.add_argument('--rates', default='1,2,5,10,20,40,80,120')
    parser.add_argument('--seconds', type=int, default=20)
    parser.add_argument('--max-vus', type=int, default=100)
    parser.add_argument('--pre-vus', type=int, default=20)
    parser.add_argument('--cooldown', type=int, default=10)
    parser.add_argument('--p95-limit', type=float, default=200)
    parser.add_argument('--journey-p95-limit', type=float, default=500)
    args = parser.parse_args()
    try:
        args.run_id = str(uuid.UUID(args.run_id))
    except ValueError:
        parser.error('run-id는 UUID여야 합니다')
    args.stop = StopController()
    signal.signal(signal.SIGINT, args.stop.receive)
    signal.signal(signal.SIGTERM, args.stop.receive)
    parsed_url = urllib.parse.urlsplit(args.url)
    if parsed_url.scheme not in ('http', 'https') or not parsed_url.netloc or parsed_url.username or parsed_url.query or parsed_url.fragment:
        parser.error('--url에는 인증정보/쿼리 없는 HTTP(S) origin을 지정하세요')
    args.url = args.url.rstrip('/')
    args.users = args.users.resolve()
    args.out = args.out.resolve()
    rates = [int(rate) for rate in args.rates.split(',')]
    if (args.seconds < 1 or args.max_vus < 1 or args.pre_vus < 1 or args.pre_vus > args.max_vus
            or args.cooldown < 10 or any(rate < 1 for rate in rates) or rates != sorted(set(rates))
            or args.p95_limit <= 0 or args.journey_p95_limit <= 0):
        parser.error('양수 시간/VU/지연, 중복 없는 오름차순 rate, cooldown >=10, pre-vus <= max-vus가 필요합니다')
    catalog = {case['id']: case for case in json.loads((ROOT / 'k6/cases/public.json').read_text())}
    ids = args.cases.split(',')
    if any(case not in catalog for case in ids) or len(ids) != len(set(ids)):
        parser.error('--cases는 public.json의 중복 없는 id 목록이어야 합니다')
    selected = [catalog[case] for case in ids]
    users = json.loads(args.users.read_text())
    if not isinstance(users, list) or not users or any(not user.get('token') for user in users):
        parser.error('유효한 전용 사용자 token fixture가 필요합니다')
    if 'focus_lifecycle' in ids and (len(users) < args.max_vus or any(not u.get('islandId') for u in users[:args.max_vus])):
        parser.error('focus_lifecycle에는 max-vus 이상의 전용 사용자/islandId가 필요합니다')
    for case in selected:
        pool = [user for user in users if not case.get('role') or user.get('role') == case['role']]
        if not pool or (any('{islandId}' in path for path in case['paths']) and any(not u.get('islandId') for u in pool)):
            parser.error(f'{case["id"]}: 필요한 역할/islandId fixture가 없습니다')
    if args.out.exists() and any(args.out.iterdir()):
        parser.error('--out은 비어 있는 새 디렉터리여야 합니다')
    args.out.mkdir(parents=True, exist_ok=True)
    try:
        git = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT.parent, capture_output=True, text=True)
        git_sha = git.stdout.strip() if git.returncode == 0 else None
    except OSError:
        git_sha = None
    meta = {'runId': args.run_id, 'startedAt': now(), 'target': args.url, 'cases': ids, 'rates': rates,
            'gitSha': git_sha,
            'seconds': args.seconds, 'maxVus': args.max_vus, 'preVus': args.pre_vus,
            'cooldownSeconds': args.cooldown, 'fixtureUsers': len(users),
            'fixtureSha256': hashlib.sha256(args.users.read_bytes()).hexdigest(),
            'host': platform.platform(), 'status': 'running',
            'slo': {'httpErrorRate': .01, 'apiErrorRate': .01, 'droppedRate': .01,
                    'apiP95ms': args.p95_limit, 'journeyP95ms': args.journey_p95_limit},
            'abort': {'httpErrorRate': .05, 'apiErrorRate': .05, 'httpP95ms': 2000,
                      'droppedCount': 'max(2, ceil(rate * seconds * 0.05))', 'delaySeconds': 10},
            'notes': ['도착률은 작업 시작/초, 실제 RPS는 HTTP 요청/초, TPS는 성공한 작업 완료/초입니다.',
                      'VU는 생성기의 병렬 작업 슬롯이며 실제 동시 접속자 수와 같지 않습니다.',
                      '집중 수명주기는 0.2초 대기 후 pause/resume/finish하는 고밀도 쓰기입니다.',
                      '전체 k6 실행시간(마지막 요청 drain 포함)으로 RPS/TPS를 계산합니다.',
                      '워밍업은 1 arrival/s 3초이며 결과에서 측정 단계와 구분합니다.'],
            'harnessSha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in [Path(__file__).resolve(), SCRIPT, ROOT / 'k6/cases/public.json',
                                           ROOT / 'k6/lib/auth.js', ROOT / 'k6/lib/summary.js',
                                           Path(__file__).with_name('loadtest_evidence.py')]}}
    rows = []

    def save():
        write_json(args.out / 'meta.json', meta)
        write_json(args.out / 'results.json', rows)
        if rows:
            with (args.out / 'results.csv').open('w', newline='') as handle:
                writer = csv.DictWriter(handle, fieldnames=list(dict.fromkeys(key for row in rows for key in row)))
                writer.writeheader()
                writer.writerows(rows)

    save()
    try:
        for case in selected:
            if args.stop.reason:
                break
            if case['id'] == 'focus_lifecycle':
                cleanup = cleanup_focus(args.url, users, args.max_vus)
                write_json(args.out / 'focus-cleanup-before.json', cleanup)
                if cleanup['failed']:
                    meta['status'] = 'cleanup_failed'
                    break
            try:
                warmup = stage(args, case, 1, 3, case['id'] + '-warmup', args.out, warmup=True)
                rows.append(warmup)
                save()
                if warmup['verdict'] != 'PASS':
                    meta['status'] = 'preflight_failed'
                    break
                args.stop.wait(args.cooldown)
                for rate in rates:
                    if args.stop.reason:
                        break
                    row = stage(args, case, rate, args.seconds, f'{case["id"]}-{rate}rps', args.out)
                    rows.append(row)
                    save()
                    args.stop.wait(args.cooldown)
                    if row['verdict'] in ('ABORT', 'INVALID', 'PARTIAL'):
                        meta['status'] = 'aborted'
                        break
                    if row['verdict'] != 'PASS':
                        break
            finally:
                if case['id'] == 'focus_lifecycle':
                    args.stop.wait(args.cooldown)
                    cleanup = cleanup_focus(args.url, users, args.max_vus)
                    write_json(args.out / 'focus-cleanup-after.json', cleanup)
                    if cleanup['failed']:
                        meta['status'] = 'cleanup_failed'
            if meta['status'] != 'running':
                break
        if args.stop.reason:
            meta['status'] = 'interrupted'
            meta['stopReason'] = args.stop.reason
        if meta['status'] == 'running':
            meta['status'] = 'complete'
    except BaseException as error:
        meta['status'] = 'interrupted' if isinstance(error, KeyboardInterrupt) else 'failed'
        meta['errorType'] = type(error).__name__
        raise
    finally:
        meta['endedAt'] = now()
        save()
    print(f'결과: {args.out}', flush=True)
    return 0 if meta['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
