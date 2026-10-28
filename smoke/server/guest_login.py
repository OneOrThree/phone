#!/usr/bin/env python3
"""게스트 로그인만 고정 5초 뒤 최대 두 번 재시도한다. 자격은 비공개 파일에만 둔다."""
import argparse
import fcntl
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import uuid

spec = importlib.util.spec_from_file_location('guest_budget', Path(__file__).with_name('guest-budget.py'))
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)

ROLES = {'main', 'friend-owner', 'friend-peer', 'core', 'statistics'}
RETRY_WAIT = 5
ERRORS = {'UPSTREAM_TIMEOUT', 'SERVICE_UNAVAILABLE', 'UPSTREAM_AUTH_FAILED',
          'UPSTREAM_CONTRACT_ERROR', 'RATE_LIMITED', 'INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN'}


def number(env, key, default, maximum):
    value = float(env.get(key, default))
    if not math.isfinite(value) or not 0 < value <= maximum:
        raise ValueError('로그인 시간 설정 범위 오류')
    return value


def settings(env):
    retries = env.get('SMOKE_AUTH_MAX_RETRIES', '2')
    if retries not in {'0', '1', '2'}:
        raise ValueError('로그인 재시도 횟수 설정 오류')
    roles = env.get('SMOKE_GUEST_ROLES', ','.join(sorted(ROLES))).split(',')
    if len(set(roles)) != len(roles) or not set(roles) <= ROLES:
        raise ValueError('게스트 로그인 역할 설정 오류')
    return {'retries': int(retries), 'roles': roles,
            'total': number(env, 'SMOKE_AUTH_TOTAL_TIMEOUT_SECONDS', '40', 40),
            'http': number(env, 'SMOKE_HTTP_TIMEOUT', '10', 1200),
            'connect': number(env, 'SMOKE_CONNECT_TIMEOUT', '2', 1200)}


def classify(code, rc, body):
    if rc:
        return False, rc in {7, 28, 52, 56}, 'CURL_' + str(rc)
    try:
        envelope = json.loads(body)
    except (ValueError, TypeError):
        envelope = None
    error, has_error = None, False
    if isinstance(envelope, dict):
        raw = envelope.get('error')
        error = raw.get('code') if isinstance(raw, dict) else envelope.get('code')
        has_error = raw is not None or 'code' in envelope
    if code == '201' and isinstance(envelope, dict) and envelope.get('error') is None:
        data = envelope.get('data')
        if (isinstance(data, dict) and isinstance(data.get('accessToken'), str) and data['accessToken']
                and isinstance(data.get('refreshToken'), str) and data['refreshToken']
                and isinstance(data.get('userId'), str)
                and re.fullmatch('[0-9a-fA-F-]{36}', data['userId'])
                and type(data.get('onboardingComplete')) is bool):
            return True, False, 'OK'
    # 앱 오류 봉투가 있으면 HTTP 502만 보고 재시도하지 않는다.
    if has_error:
        retry = isinstance(error, str) and (code, error) in {('504', 'UPSTREAM_TIMEOUT'), ('503', 'SERVICE_UNAVAILABLE')}
        return False, retry, error if isinstance(error, str) and error in ERRORS else 'HTTP_' + code
    return False, code in {'502', '503', '504'}, 'HTTP_' + code


def record_timestamp(path):
    if not path:
        return
    target = Path(path)
    # 기존 실행 간 제한 창은 실패·재시도까지 포함한 마지막 요청을 기준으로 한다.
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix=target.name + '.')
    try:
        with os.fdopen(fd, 'w') as file:
            file.write(str(int(time.time())))
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


class CurlRequest:
    def __init__(self, directory, env, device, config):
        self.directory, self.env, self.config = directory, env, config
        # X-Device-Id도 복구 창 안 자격이므로 argv와 진단에 넣지 않는다.
        (directory / 'guest-curl.cfg').write_text(
            'silent\nshow-error\nheader = "X-Device-Id: ' + device + '"\n')

    def __call__(self, remaining):
        directory, config = self.directory, self.config
        for name in ('body.json', 'headers'):
            (directory / name).write_text('')
        record_timestamp(self.env.get('SMOKE_GUEST_LAST_REQUEST_FILE'))
        args = ['curl', '-q', '--config', str(directory / 'guest-curl.cfg'), '--request', 'POST',
                '--max-time', str(min(config['http'], remaining)),
                '--connect-timeout', str(min(config['connect'], config['http'], remaining)),
                '--dump-header', str(directory / 'headers'), '--output', str(directory / 'body.json'),
                '--write-out', '%{http_code} %{time_total}',
                self.env['BASE_URL'].rstrip('/') + '/auth/sessions/guest']
        with (directory / 'curl-error').open('w') as error:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=error, text=True)
            try:
                output, _ = process.communicate(timeout=remaining)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                return '000', 28, ''
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        match = re.fullmatch(r'([0-9]{3}) [0-9.]+', output.strip())
        code = match[1] if match else '000'
        return code, process.returncode, (directory / 'body.json').read_text(errors='replace')


def run_login(role, config, request, claim, emit, clock=time.monotonic, sleep=time.sleep, available=lambda _role: True):
    started = clock()
    attempts, first_error, code, rc, waited_ms = 0, '', '000', 0, 0
    result, success = 'deadline', False
    while True:
        remaining = config['total'] - (clock() - started)
        if remaining <= 0:
            break
        if not claim(role):
            result = 'deadline' if clock() - started >= config['total'] else 'budget_exhausted'
            break
        # 예산 파일 잠금을 기다린 시간도 로그인 전체 제한에 포함한다.
        remaining = config['total'] - (clock() - started)
        if remaining <= 0:
            break
        attempts += 1
        attempt_started = clock()
        code, rc, body = request(remaining)
        success, retryable, error = classify(code, rc, body)
        if clock() - started >= config['total']:
            success, retryable, error = False, False, 'DEADLINE'
        if not success and not first_error:
            first_error = error
        elapsed = max(0, round((clock() - started) * 1000))
        emit({'kind': 'attempt', 'role': role, 'attempt': attempts, 'http_code': code,
              'curl_rc': rc, 'error_code': error, 'ms': max(0, round((clock() - attempt_started) * 1000)),
              'waited_ms': waited_ms, 'elapsed_ms': elapsed})
        if error == 'DEADLINE':
            break
        if success:
            result = 'success'
            break
        if not retryable:
            result = 'non_retryable'
            break
        if attempts > config['retries']:
            result = 'max_attempts'
            break
        if not available(role):
            result = 'deadline' if clock() - started >= config['total'] else 'budget_exhausted'
            break
        if clock() - started + RETRY_WAIT >= config['total']:
            break
        sleep(RETRY_WAIT)
        waited_ms = RETRY_WAIT * 1000
    final = {'kind': 'result', 'role': role, 'result': result, 'attempts': attempts,
             'retries': max(0, attempts - 1), 'elapsed_ms': max(0, round((clock() - started) * 1000)),
             'first_error': first_error, 'http_code': code, 'curl_rc': rc}
    emit(final)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--role', choices=sorted(ROLES), required=True)
    args = parser.parse_args()
    os.umask(0o077)
    # SIGTERM 중에도 curl을 정리하고 다음 로그인 요청을 보내지 않는다.
    def cancel(signum, _frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    try:
        config = settings(os.environ)
        device = os.environ['SMOKE_GUEST_DEVICE_ID']
        if str(uuid.UUID(device)) != device.lower() or args.role not in config['roles']:
            raise ValueError('게스트 로그인 입력 오류')
        state = Path(os.environ['SMOKE_GUEST_STATE_DIR']) / 'requests.json'
        requests = budget.RequestBudget(state, config['roles'], deadline=time.monotonic() + config['total'])
        diagnostic = Path(os.environ.get('SMOKE_AUTH_DIAGNOSTICS_FILE', args.directory / 'auth-attempts.jsonl'))
        diagnostic.parent.mkdir(parents=True, exist_ok=True)
        def emit(row):
            with diagnostic.open('a') as file:
                fcntl.flock(file, fcntl.LOCK_EX)
                file.write(json.dumps(row) + '\n')
        final = run_login(args.role, config, CurlRequest(args.directory, os.environ, device, config),
                          requests.claim, emit, available=requests.available)
        (args.directory / 'auth-result.json').write_text(json.dumps(final))
        return 0 if final['result'] == 'success' else 1
    except (OSError, ValueError, KeyError, TypeError):
        # 설정·예산 원문에는 자격이 섞일 수 있으므로 예외 메시지·traceback은 출력하지 않는다.
        print('게스트 로그인 설정·예산·진단 기록 실패', flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
