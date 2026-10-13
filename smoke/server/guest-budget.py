#!/usr/bin/env python3
"""직렬화된 자동·수동 스모크 사이에 공개 게스트 생성 제한 창을 보존한다."""
import os
from pathlib import Path
import time

# 현재 GuestLoginRateLimiter 기본 창. 마지막 요청부터 한 창을 기다리므로
# 성공 흐름 4건·014 실패 뒤 015 대체 준비까지 최대 5건이 다음 실행과 겹치지 않는다.
WINDOW_SECONDS = 3601
MAX_WAIT_SECONDS = 4200


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
