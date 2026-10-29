#!/usr/bin/env python3
"""기존 Business Redis 제거의 선행 조건만 검사한다. 컨테이너를 중지·삭제하지 않는다."""
import argparse
from datetime import datetime, timezone
import json
import subprocess


def check(app, now, max_marker_ttl):
    env = dict(item.split("=", 1) for item in app["Config"].get("Env", []) if "=" in item)
    if app["Config"].get("Labels", {}).get("com.oneorthree.redis-layout") != "shared-v1":
        raise ValueError("bridge 지원 Business 이미지가 아닙니다")
    if env.get("BUSINESS_REDIS_HOST") != "redis" or env.get("BUSINESS_REDIS_LEGACY_HOST") != "business-redis":
        raise ValueError("공유 Redis와 기존 Redis를 함께 사용하는 bridge 배포가 아닙니다")
    if app.get("State", {}).get("Health", {}).get("Status") != "healthy":
        raise ValueError("Business가 healthy 상태가 아닙니다")
    started = datetime.fromisoformat(app["State"]["StartedAt"].replace("Z", "+00:00"))
    # 탈퇴 표지는 2시간, AT 거부목록은 설정된 AT 수명+60초. 사용자 지정 값은 이전 배포까지 포함해야 한다.
    wait = max(7200, max_marker_ttl) + 60
    if (now - started).total_seconds() < wait:
        raise ValueError(f"현재 bridge 컨테이너 시작 뒤 최소 {wait}초가 필요합니다")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", choices=["phone", "catus"], required=True)
    parser.add_argument("--max-marker-ttl-seconds", type=int, required=True)
    args = parser.parse_args()
    result = subprocess.run(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={args.project}",
                             "--filter", "label=com.docker.compose.service=business-api"],
                            capture_output=True, text=True, check=True, timeout=15)
    ids = result.stdout.split()
    if len(ids) != 1:
        raise ValueError("단일 Business 컨테이너 전용 절차입니다")
    result = subprocess.run(["docker", "inspect", ids[0]], capture_output=True, text=True, check=True, timeout=15)
    check(json.loads(result.stdout)[0], datetime.now(timezone.utc), args.max_marker_ttl_seconds)
    print("제거 선행 조건 통과. Business 요청을 중지한 뒤 기존 Redis 제거·legacy 설정 해제·Business 재기동 순서를 따르세요.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print("제거 검사 실패: " + (str(error) if isinstance(error, ValueError) else type(error).__name__))
        raise SystemExit(1)
