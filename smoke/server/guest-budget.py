#!/usr/bin/env python3
"""직렬화된 자동·수동 스모크 사이에 공개 게스트 생성 제한 창을 보존한다."""
import os
import fcntl
import json
from pathlib import Path
import tempfile
import time

# 현재 GuestLoginRateLimiter 기본 창. 마지막 요청부터 한 창을 기다리므로
# 최대 5곳의 로그인·재시도를 합친 최대 10회 요청이 다음 실행과 겹치지 않는다.
WINDOW_SECONDS = 3601
MAX_WAIT_SECONDS = 4200


class RequestBudget:
    """자식 실행기와 요청 상한을 공유하고 미시작 로그인의 첫 요청 몫을 남긴다."""

    def __init__(self, path, roles, limit=10, deadline=None):
        self.path = Path(path)
        self.roles = sorted(roles)
        self.limit = limit
        self.deadline = deadline

    def claim(self, role):
        return self._access(role, True)

    def available(self, role):
        return self._access(role, False)

    def _access(self, role, consume):
        if role not in self.roles:
            raise ValueError('알 수 없는 게스트 로그인 역할')
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # 잠금 파일은 유지하고 기록만 원자적으로 교체한다. 쓰기 중단으로
        # 기존 요청 횟수가 사라져 상한이 초기화되는 것을 막는다.
        lock_path = self.path.with_name(self.path.name + '.lock')
        with lock_path.open('a+') as lock:
            os.chmod(lock_path, 0o600)
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if self.deadline is not None:
                        remaining = self.deadline - time.monotonic()
                        if remaining <= 0:
                            return False
                        time.sleep(min(.05, remaining))
                    else:
                        time.sleep(.01)
            try:
                state = json.loads(self.path.read_text())
            except FileNotFoundError:
                state = {'roles': self.roles, 'limit': self.limit, 'counts': {}}
            counts = state['counts']
            if (state['roles'] != self.roles or state['limit'] != self.limit
                    or not isinstance(counts, dict) or not set(counts) <= set(self.roles)
                    or any(type(n) is not int or not 1 <= n <= 3 for n in counts.values())
                    or sum(counts.values()) > self.limit):
                raise ValueError('게스트 요청 예산 기록 불일치')
            remaining_firsts = len(set(self.roles) - set(counts) - {role})
            if counts.get(role, 0) >= 3 or sum(counts.values()) + 1 + remaining_firsts > self.limit:
                return False
            if not consume:
                return True
            counts[role] = counts.get(role, 0) + 1
            fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=self.path.name + '.')
            try:
                with os.fdopen(fd, 'w') as file:
                    json.dump(state, file)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary, self.path)
            finally:
                Path(temporary).unlink(missing_ok=True)
            return True


def remaining(path, now):
    if not path.exists():
        return 0
    stamp = path.read_text().strip()
    if not stamp.isdecimal():
        raise RuntimeError('게스트 요청 시각 기록 형식 오류')
    return max(0, int(stamp) + WINDOW_SECONDS - now)


def wait_for_budget(path, clock=time.time, sleep=time.sleep):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    started = clock()
    announced = False
    while True:
        now = clock()
        seconds = remaining(path, now)
        if seconds == 0:
            print('게스트 생성 제한 창 대기 완료', flush=True)
            return 0
        if now - started >= MAX_WAIT_SECONDS:
            raise RuntimeError('게스트 생성 제한 창 대기 시간 초과')
        if not announced:
            print(f'이전 스모크 게스트 요청 창: 최대 {int(seconds) + 1}초 대기 (배포 잠금 없음)', flush=True)
            announced = True
        sleep(min(30, seconds))


if __name__ == '__main__':
    raise SystemExit(wait_for_budget(Path(os.environ['SMOKE_GUEST_LAST_REQUEST_FILE'])))
