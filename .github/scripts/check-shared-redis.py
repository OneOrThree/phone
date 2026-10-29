#!/usr/bin/env python3
"""일반 dev CD의 공유 Redis 전환 검사. 상태·자격을 바꾸거나 값을 출력하지 않는다."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=15).stdout


def check(secret, expected, inspect, legacy_ids):
    config = inspect["Config"]
    env = dict(item.split("=", 1) for item in config.get("Env", []) if "=" in item)
    if env.get("ACL_REVISION") != hashlib.sha256(expected).hexdigest():
        raise ValueError("공유 Redis ACL bootstrap이 필요합니다")
    command = config.get("Cmd", [])
    for flag, value in [("--maxmemory", "384mb"), ("--maxmemory-policy", "noeviction"),
                        ("--appendonly", "yes"), ("--appendfsync", "everysec")]:
        if flag not in command or command[command.index(flag) + 1] != value:
            raise ValueError("공유 Redis 실행 정책 bootstrap이 필요합니다")
    if inspect.get("State", {}).get("Health", {}).get("Status") != "healthy":
        raise ValueError("공유 Redis가 healthy 상태가 아닙니다")
    if legacy_ids and secret.get("BUSINESS_REDIS_LEGACY_HOST") != "business-redis":
        raise ValueError("기존 Business Redis가 있습니다. bridge 기간을 마치고 제거하는 절차가 필요합니다")
    if secret.get("BUSINESS_REDIS_LEGACY_HOST") and not secret.get("BUSINESS_REDIS_LEGACY_PASSWORD"):
        raise ValueError("기존 Business Redis의 bridge 비밀번호가 필요합니다")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-acl", type=Path, required=True)
    args = parser.parse_args()
    secret = json.load(sys.stdin)
    expected = args.expected_acl.read_bytes()
    persistent = Path("/var/lib/gromo/runtime/shared-redis.acl")
    if not persistent.is_file() or persistent.read_bytes() != expected:
        raise ValueError("docs/architecture/shared-redis.md의 최초 bootstrap 절차가 필요합니다")
    inspect = json.loads(run("docker", "inspect", "phone-redis"))[0]
    legacy = run("docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=phone",
                 "--filter", "label=com.docker.compose.service=business-redis").strip()
    check(secret, expected, inspect, legacy)
    print("공유 Redis ACL·영속화·bridge 검사 통과", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else type(error).__name__
        print("공유 Redis 검사 실패: " + message, file=sys.stderr)
        sys.exit(1)
