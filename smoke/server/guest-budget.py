#!/usr/bin/env python3
"""한 번의 스모크 실행 안에서 공개 게스트 생성 요청 횟수 상한을 부모·자식 실행기가 공유한다."""
import os
import fcntl
import json
from pathlib import Path
import tempfile
import time


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
