#!/usr/bin/env python3
"""HTTP 두 여정과 WebSocket을 감독하고 실제 공통 측정 구간 및 중단 증거를 보존한다."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

from loadtest_evidence import atomic_json, recover_http, measurement_windows, assess_common_window


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def group_alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--run-id', default=str(uuid.uuid4()))
    parser.add_argument('--url', required=True)
    parser.add_argument('--ws-url', required=True)
    parser.add_argument('--users', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=Path('results/mixed'))
    parser.add_argument('--home-rate', type=int, default=5)
    parser.add_argument('--focus-rate', type=int, default=2)
    parser.add_argument('--chat-connections', type=int, default=100)
    parser.add_argument('--chat-frequency', type=float, default=.1)
    parser.add_argument('--common-seconds', type=int, required=True)
    parser.add_argument('--seconds', type=int, default=120)
    parser.add_argument('--chat-seconds', type=int, default=150)
    parser.add_argument('--runtime-seconds', type=int, default=240)
    parser.add_argument('--stop-grace-seconds', type=int, default=45)
    parser.add_argument('--cleanup-timeout-seconds', type=int, default=90)
    args = parser.parse_args()
    try:
        args.run_id = str(uuid.UUID(args.run_id))
    except ValueError:
        parser.error('run-id는 UUID여야 합니다')
    if min(args.common_seconds, args.home_rate, args.focus_rate, args.chat_connections, args.seconds, args.chat_seconds,
           args.runtime_seconds, args.stop_grace_seconds, args.cleanup_timeout_seconds) < 1:
        parser.error('모든 부하/시간 인자는 양수여야 합니다')
    if args.common_seconds > min(args.seconds, args.chat_seconds):
        parser.error('common-seconds는 HTTP/WS 각 실행시간 이하로 명시해야 합니다')
    if not math.isfinite(args.chat_frequency) or not .01 <= args.chat_frequency <= 10:
        parser.error('chat-frequency는0.01~10Hz 사이여야 합니다')
    if args.chat_connections * 25 + 12000 + args.chat_seconds * 1000 + 3000 + 2000 > args.runtime_seconds * 1000:
        parser.error('runtime-seconds가 chat 연결·준비·측정·drain 예산보다 작습니다')
    root = args.root.resolve()
    users_path = args.users if args.users.is_absolute() else root / args.users
    out = args.out if args.out.is_absolute() else root / args.out
    capacity_path = root / 'loadtest/scripts/aws-capacity.py'
    realtime_path = root / 'loadtest/scripts/aws-realtime.mjs'
    if not capacity_path.is_file() or not realtime_path.is_file():
        parser.error('기존 aws-capacity.py/aws-realtime.mjs가 root 아래에 필요합니다')
    users = json.loads(users_path.read_text())
    if len(users) < max(60, 300 + args.chat_connections):
        parser.error('첫60 집중 계정과 offset300 이후 chat 계정 fixture가 부족합니다')
    focus_ids = {user.get('userId') for user in users[:60]}
    chat_ids = {user.get('userId') for user in users[300:300 + args.chat_connections]}
    if None in focus_ids or None in chat_ids or len(focus_ids) != 60 or len(chat_ids) != args.chat_connections or focus_ids & chat_ids:
        parser.error('집중과 chat에는 중복 없는 서로 다른 전용 계정이 필요합니다')
    if out.exists() and any(out.iterdir()):
        parser.error('out은 비어 있는 새 디렉터리여야 합니다')
    os.umask(0o077)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'ws').mkdir()
    spec = importlib.util.spec_from_file_location('mixed_capacity_cleanup', capacity_path)
    capacity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capacity)

    def http_command(case, rate, directory, vus):
        return [sys.executable, str(capacity_path), '--run-id', args.run_id, '--url', args.url, '--users', str(users_path),
                '--out', str(out / directory), '--cases', case, '--rates', str(rate),
                '--seconds', str(args.seconds), '--max-vus', str(vus), '--pre-vus', str(vus),
                '--p95-limit', '500', '--journey-p95-limit', '1000']

    definitions = {
        'home': {'command': http_command('app_home_new_user', args.home_rate, 'home', 100),
                 'case': 'app_home_new_user', 'targetRate': args.home_rate, 'maxVus': 100},
        'focus': {'command': http_command('focus_lifecycle', args.focus_rate, 'focus', 60),
                  'case': 'focus_lifecycle', 'targetRate': args.focus_rate, 'maxVus': 60},
        'chat': {'command': ['node', str(realtime_path), '--run-id', args.run_id, '--url', args.ws_url, '--users', str(users_path),
                            '--out', str(out / 'ws/chat.json'), '--mode', 'chat', '--connections', str(args.chat_connections),
                            '--user-offset', '300', '--seconds', str(args.chat_seconds), '--frequency', str(args.chat_frequency),
                            '--runtime-seconds', str(args.runtime_seconds), '--p95-limit-ms', '500'],
                 'connections': args.chat_connections, 'userOffset': 300, 'frequency': args.chat_frequency},
    }
    meta = {'runId': args.run_id, 'startedAt': now(), 'status': 'running', 'commonMeasurementPlannedSeconds': args.common_seconds, 'httpSeconds': args.seconds, 'chatSeconds': args.chat_seconds,
            'runtimeSeconds': args.runtime_seconds, 'fixtureUsers': len(users),
            'fixtureSha256': hashlib.sha256(users_path.read_bytes()).hexdigest(),
            'harnessSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in (Path(__file__), Path(__file__).with_name('loadtest_evidence.py'),
                                           Path(__file__).with_name('loadtest_focus.py'))},
            'focusUserCount': 60, 'chatUserOffset': 300, 'processes': {}, 'signals': [],
            'notes': ['HTTP 두 여정은 각각120초 기본 계획이고 chat은150초 기본 계획입니다.',
                      '개별 runner의 사전정리·워밍업 시간이 달라 실제 공통 측정창은 별도로 계산합니다.',
                      'home 조회는 전체 fixture에서 사용자를 고르며, 상태를 쓰는 focus와 chat 계정 집합은 분리합니다.',
                      'HTTP SLO_LIMIT은 종료코드0일 수 있으므로 결과 verdict도 감시합니다.']}
    processes, logs = {}, {}
    cancelled = []

    def save():
        atomic_json(out / 'mixed-meta.json', meta)

    def received_signal(number, _frame):
        if not cancelled:
            cancelled.append(signal.Signals(number).name)

    signal.signal(signal.SIGINT, received_signal)
    signal.signal(signal.SIGTERM, received_signal)

    def refresh():
        for name, process in processes.items():
            code = process.poll()
            if code is not None and meta['processes'][name].get('endedAt') is None:
                meta['processes'][name].update(endedAt=now(), exitCode=code)

    def stop_all(reason):
        meta['stopReason'] = reason
        # 종료된 부모의 process group에도 신호를 보내 남은 k6 자식이 있으면 함께 멈춘다.
        for sig, grace in [(signal.SIGINT, args.stop_grace_seconds), (signal.SIGTERM, 10), (signal.SIGKILL, 5)]:
            live = [(name, process) for name, process in processes.items() if group_alive(process.pid)]
            if not live:
                break
            for name, process in live:
                try:
                    if sig == signal.SIGINT and process.poll() is None:
                        process.send_signal(sig)
                    else:
                        os.killpg(process.pid, sig)
                    meta['signals'].append({'at': now(), 'component': name, 'signal': sig.name})
                except ProcessLookupError:
                    pass
            save()
            deadline = time.monotonic() + grace
            while time.monotonic() < deadline:
                refresh()
                if not any(group_alive(process.pid) for process in processes.values()):
                    break
                time.sleep(.25)
        refresh()

    def result_failure():
        for name in ('home', 'focus'):
            rows = read_json(out / name / 'results.json')
            if isinstance(rows, list):
                for row in rows:
                    if row.get('verdict') and row['verdict'] != 'PASS':
                        return name + ':' + row['verdict']
        chat = read_json(out / 'ws/chat.json')
        if isinstance(chat, dict) and (not chat.get('valid') or not chat.get('sloPassed')):
            return 'chat:RESULT_FAILED'
        for name, process in processes.items():
            if process.poll() not in (None, 0):
                return name + ':EXIT_FAILED'
        return None

    def collect_windows():
        components = {name: recover_http(out / name, meta.get('stopReason')) for name in ('home', 'focus')}
        chat = read_json(out / 'ws/chat.json')
        if not chat:
            chat = {'runId': args.run_id, 'valid': False, 'sloPassed': False, 'aborted': meta.get('stopReason') or 'CHILD_EXIT_WITHOUT_RESULT',
                    'countsUnknown': True, 'measurementMs': None, 'eventWindowStart': None, 'eventWindowEnd': None}
            atomic_json(out / 'ws/chat.json', chat)
        meta.update(measurement_windows(components, chat))
        meta.update(assess_common_window(meta['commonMeasurementOverlapSeconds'], args.common_seconds, meta['status'] == 'complete'))
        if meta['status'] == 'complete' and not meta['mixedPassed']:
            meta['status'] = 'incomplete_window'
        meta['missingMeasurementComponents'] = [name for name, rows in components.items()
            if not any(row.get('phase') == 'measurement' for row in rows)]

    print(json.dumps({'runId': args.run_id, 'commonMeasurementPlannedSeconds': args.common_seconds,
                      'httpSeconds': args.seconds, 'chatSeconds': args.chat_seconds}), flush=True)
    save()
    began = time.monotonic()
    try:
        for name, definition in definitions.items():
            logs[name] = (out / (name + '.log')).open('w')
            process = subprocess.Popen(definition['command'], cwd=root, stdout=logs[name], stderr=subprocess.STDOUT,
                                       start_new_session=True)
            processes[name] = process
            meta['processes'][name] = {key: value for key, value in definition.items() if key != 'command'}
            meta['processes'][name].update(pid=process.pid, startedAt=now(), endedAt=None, exitCode=None)
            save()
        while True:
            refresh()
            reason = cancelled[0] if cancelled else result_failure()
            if not reason and time.monotonic() - began > args.runtime_seconds:
                reason = 'COORDINATOR_RUNTIME_LIMIT'
            if reason:
                meta['status'] = 'aborted'
                stop_all(reason)
                break
            if all(process.poll() is not None for process in processes.values()):
                valid = True
                for name in ('home', 'focus'):
                    run_meta = read_json(out / name / 'meta.json') or {}
                    rows = read_json(out / name / 'results.json') or []
                    measured = [row for row in rows if row.get('phase') == 'measurement']
                    valid = valid and run_meta.get('status') == 'complete' and len(measured) == 1 and measured[0].get('verdict') == 'PASS'
                chat = read_json(out / 'ws/chat.json') or {}
                valid = valid and chat.get('valid') is True and chat.get('sloPassed') is True and chat.get('measurementMs', 0) >= args.chat_seconds * 1000 - 100
                meta['status'] = 'complete' if valid else 'invalid'
                break
            time.sleep(.25)
    except BaseException as error:
        meta['status'] = 'failed'
        meta['errorType'] = type(error).__name__
        stop_all('COORDINATOR_EXCEPTION')
    finally:
        if any(group_alive(process.pid) for process in processes.values()):
            stop_all(meta.get('stopReason', 'FINAL_PROCESS_CLEANUP'))
        refresh()
        for log in logs.values():
            log.close()
        meta['cleanupStartedAt'] = now()
        save()

        class CleanupTimeout(BaseException):
            pass

        def cleanup_deadline(_number, _frame):
            # 기존 cleanup_focus의 except Exception을 통과하여 전체60계정 정리의 상한을 보장한다.
            raise CleanupTimeout()

        previous_alarm = signal.signal(signal.SIGALRM, cleanup_deadline)
        signal.setitimer(signal.ITIMER_REAL, args.cleanup_timeout_seconds)
        try:
            ledger = capacity.read_focus_ledger(out / 'focus', args.run_id)
            atomic_json(out / 'focus-ledger-final.json', ledger)
            cleanup = capacity.cleanup_focus(args.url.rstrip('/'), users, 60, args.run_id, ledger,
                checkpoint=lambda progress: atomic_json(out / 'focus-cleanup-final.json', progress))
        except CleanupTimeout:
            cleanup = read_json(out / 'focus-cleanup-final.json') or {'runId': args.run_id}
            cleanup.update(complete=False, errorType='CleanupTimeout')
        except Exception as error:
            cleanup = read_json(out / 'focus-cleanup-final.json') or {'runId': args.run_id}
            cleanup.update(complete=False, errorType=type(error).__name__)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_alarm)
        atomic_json(out / 'focus-cleanup-final.json', cleanup)
        atomic_json(out / 'focus-ledger-final.json', capacity.read_focus_ledger(out / 'focus', args.run_id,
            extra_cleanup_files=[out / 'focus-cleanup-final.json']))
        meta['cleanup'] = cleanup
        if cleanup.get('complete') is not True or cleanup.get('failed', 0):
            meta['statusBeforeCleanupFailure'] = meta['status']
            meta['status'] = 'cleanup_failed'
        try:
            collect_windows()
        except Exception as error:
            meta['status'] = 'invalid'
            meta['mixedPassed'] = False
            meta['commonWindowVerdict'] = 'UNKNOWN'
            meta['commonMeasurementOverlapSeconds'] = None
            meta['measurementWindowErrorType'] = type(error).__name__
        meta['endedAt'] = now()
        meta['elapsedSeconds'] = round(time.monotonic() - began, 3)
        save()
    print(json.dumps({'status': meta['status'], 'stopReason': meta.get('stopReason'),
                      'commonMeasurementOverlapSeconds': meta.get('commonMeasurementOverlapSeconds')}, ensure_ascii=False))
    return 0 if meta['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
