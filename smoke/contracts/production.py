#!/usr/bin/env python3
"""실행 전용 게스트·단독 섬으로 검사하고 finally에서 섬 폐쇄·계정 탈퇴한다."""
import argparse
from contextlib import contextmanager
import fcntl
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import os
from pathlib import Path
import signal
import stat
import time
import urllib.request
import urllib.error
import uuid
from response_contract import check as contract

BASE = 'https://catus-api-v2.oneorthree.world'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(method, path, token='', body=None, headers=None):
    sent = {'Accept': 'application/json', 'User-Agent': 'phone-release-smoke', **(headers or {})}
    if token:
        sent['Authorization'] = 'Bearer ' + token
    if body is not None:
        sent['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + path, method=method, headers=sent,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        response = urllib.request.build_opener(NoRedirect).open(req, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    except (OSError, ValueError):
        raise ValueError('운영 연결 실패') from None
    with response:
        status, raw = response.code, response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('운영 응답 크기 초과')
    try:
        return status, json.loads(raw)
    except ValueError:
        raise ValueError('운영 JSON 응답 오류') from None


def result(response, statuses=(200,)):
    status, payload = response
    if (status not in statuses or not isinstance(payload, dict) or
            payload.get('error') is not None or not isinstance(payload.get('data'), dict)):
        raise ValueError('운영 준비·정리 응답 확인 실패')
    return payload['data']


def state_directory(env):
    try:
        directory = Path(env['APP_PROD_SMOKE_STATE_DIR']).expanduser().absolute()
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise ValueError('정리 기록 디렉터리는 본인 소유·권한 0700이어야 합니다')
        return directory
    except (KeyError, OSError):
        raise ValueError('APP_PROD_SMOKE_STATE_DIR에 보호된 정리 기록 경로가 필요합니다') from None


def save(path, state):
    # 자격이 포함되므로 파일을 처음 만들 때부터 0600으로 제한한다.
    temp = path.with_suffix('.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(state, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def login(state, path, send):
    # 응답 유실 복구는 동일 기기 UUID의 서버 복구 창 안에서만 시도한다.
    if time.time() - state['created_at'] > 240:
        raise ValueError('게스트 복구 창 경과 — 정리 기록을 운영자가 확인해야 합니다')
    data = result(send('POST', '/auth/sessions/guest', headers={'X-Device-Id': state['device_id']}), (201,))
    token = data.get('accessToken')
    if not isinstance(token, str) or not token or any(c.isspace() for c in token):
        raise ValueError('임시 계정 인증 정보 확인 실패')
    state['access_token'] = token
    state['user_id'] = data.get('userId')
    save(path, state)


def cleanup(state, path, send):
    errors = []
    if not state.get('access_token'):
        login(state, path, send)
    token = state['access_token']
    # 응답을 잃은 섬 생성도 새 계정의 실제 소속 목록을 재조회해 찾는다.
    try:
        data = result(send('GET', '/me/islands', token))
        items = data.get('items')
        if not isinstance(items, list):
            raise ValueError('소속 목록 불명확')
        for item in items:
            if not isinstance(item, dict) or item.get('name') != state['island_name']:
                raise ValueError('이 실행 소유로 확인되지 않은 섬 — 자동 정리 중단')
            island = str(uuid.UUID(item['id']))
            detail = result(send('GET', '/islands/' + island, token))
            if detail.get('role') != 'host' or detail.get('memberCount') != 1 or detail.get('name') != state['island_name']:
                raise ValueError('정리 대상 소유권·단독 섬 확인 실패')
            left = result(send('DELETE', '/islands/' + island + '/memberships/me', token,
                               headers={'Idempotency-Key': state['leave_key']}))
            if left.get('left') is not True:
                raise ValueError('섬 폐쇄 응답 불일치')
            closed_status, _ = send('GET', '/islands/' + island, token)
            if closed_status != 404:
                raise ValueError('정리한 섬이 여전히 조회됩니다')
        remaining = result(send('GET', '/me/islands', token))
        if remaining.get('items') != [] or remaining.get('currentIslandId') is not None:
            raise ValueError('섬 정리 후 소속 잔존')
    except (ValueError, OSError, KeyError, TypeError):
        errors.append('섬 정리 실패')
    # 섬 정리가 실패해도 계정 탈퇴를 시도한다. 방장 위임 조건 등은 서버가 검증한다.
    try:
        state['withdraw_pending'] = True
        try:
            save(path, state)
        except OSError:
            errors.append('정리 상태 저장 실패')
        deleted = result(send('DELETE', '/me', token, {'confirmation': 'DELETE'},
                              {'Idempotency-Key': state['withdraw_key']}))
        if deleted.get('deleted') is not True:
            raise ValueError('계정 탈퇴 응답 불일치')
        state['account_deleted'] = True
        save(path, state)
    except (ValueError, OSError, KeyError, TypeError):
        errors.append('계정 탈퇴 실패')
    if errors:
        raise ValueError(' / '.join(errors) + ' — 출시 차단, 보호된 정리 기록의 수동 확인 필요')
    path.unlink()


def run_checks(state, send):
    token, user = state['access_token'], state['user_id']
    for path in ['/me', '/me/islands', '/me/telescope', '/screens/home']:
        actual = path
        if path == '/screens/home':
            actual += '?date=' + datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat() + '&timezone=Asia/Seoul'
        status, payload = send('GET', actual, token)
        if status != 200:
            raise ValueError('운영 핵심 조회 실패')
        contract('GET', path, payload, required=True)
        if path == '/me' and payload['data']['id'] != user:
            raise ValueError('임시 계정 불일치')
    status, payload = send('POST', '/islands/not-a-uuid/intro-arrivals', token,
                           headers={'Idempotency-Key': str(uuid.uuid4())})
    error = payload.get('error', {}) if isinstance(payload, dict) else {}
    if status != 400 or error.get('code') != 'INVALID_PARAMETER' or error.get('field') != 'islandId':
        raise ValueError('운영 intro 경로·검증 계약 확인 실패')


@contextmanager
def locked(directory):
    fd = os.open(directory / 'lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('다른 운영 검사·정리가 실행 중입니다') from None
        yield
    finally:
        os.close(fd)


def check(env=None, send=request):
    directory = state_directory(os.environ if env is None else env)
    with locked(directory):
        return check_locked(directory, send)


def check_locked(directory, send):
    if list(directory.glob('*.json')) or list(directory.glob('*.tmp')):
        raise ValueError('미정리 실행 기록이 있어 새 검사와 출시를 차단합니다')
    nonce = uuid.uuid4().hex
    path = directory / (nonce + '.json')
    state = {'purpose': 'phone-production-smoke-run', 'created_at': time.time(),
             'device_id': str(uuid.uuid4()), 'island_name': 'smoke-prod-' + nonce[:8],
             'create_key': str(uuid.uuid4()), 'leave_key': str(uuid.uuid4()),
             'withdraw_key': str(uuid.uuid4())}
    save(path, state)
    previous = signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError('검사 중단')))
    try:
        login(state, path, send)
        initial = result(send('GET', '/me/islands', state['access_token']))
        if initial.get('items') != [] or initial.get('currentIslandId') is not None:
            raise ValueError('새 게스트의 무소속 초기 상태 불일치')
        created = result(send('POST', '/islands', state['access_token'],
                              {'name': state['island_name'], 'approvalRequired': True, 'maxMembers': 1},
                              {'Idempotency-Key': state['create_key']}), (201,))
        state['island_id'] = str(uuid.UUID(created['id']))
        save(path, state)
        run_checks(state, send)
    finally:
        try:
            cleanup(state, path, send)
        finally:
            signal.signal(signal.SIGTERM, previous)
    return {'checks': 5, 'cleanup': '섬 폐쇄·계정 탈퇴 확인 완료'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cleanup', type=Path, help='보호된 미정리 실행 기록의 정리만 재시도')
    args = parser.parse_args()
    try:
        if args.cleanup:
            directory = state_directory(os.environ)
            path = args.cleanup.absolute()
            info = path.lstat()
            if path.parent != directory or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise ValueError('정리 기록 경로·권한 불일치')
            state = json.loads(path.read_text())
            if state.get('purpose') != 'phone-production-smoke-run' or state.get('account_deleted'):
                raise ValueError('정리 기록의 수동 확인 필요')
            with locked(directory):
                cleanup(state, path, request)
        else:
            check()
        print('운영 검사·정리 완료')
    except (ValueError, KeyError, TypeError, OSError):
        print('운영 검사 또는 정리 실패 — 출시 차단. 보호된 실행 기록 확인 필요')
        raise SystemExit(1)
