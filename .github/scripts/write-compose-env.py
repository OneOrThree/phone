#!/usr/bin/env python3
"""Secrets Manager JSON을 Docker Compose용 dotenv 파일로 원자적으로 쓴다."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any


REQUIRED_KEYS = (
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "JWT_SECRET",
    "GOOGLE_CLIENT_ID",
    "APPLE_CLIENT_ID",
    "FCM_PROJECT_ID",
    "FCM_SERVICE_ACCOUNT_JSON",
    "OPENAI_API_KEY",
)

# legacy는 현재 dev-cd 호출과 호환된다. 신규 서비스는 공유 SecretString을 받아도
# 자기 허용목록만 내보낸다. prod의 전체 env_file 주입을 새 서비스에 복제하지 않는다.
SERVICE_REQUIRED_KEYS = {
    "data-api": (
        "API_DB_URL", "API_DB_USERNAME", "API_DB_PASSWORD", "OPENAI_API_KEY",
        "SVC_TOKEN_BIZ_TO_DATA", "SVC_TOKEN_NOTI_TO_DATA",
        "SVC_TOKEN_DATA_TO_NOTI", "SVC_TOKEN_DATA_TO_LINK", "LINK_CAPABILITY_KEY",
        "LINK_IP_SALT", "LINK_BASE_URL", "NOTIFICATION_BASE_URL", "KAFKA_BOOTSTRAP_SERVERS",
    ),
    "business-api": (
        "JWT_SECRET", "SVC_TOKEN_BIZ_TO_DATA", "SVC_TOKEN_BIZ_TO_NOTI", "SVC_TOKEN_BIZ_TO_LINK",
        "LINK_IP_SALT", "DATA_API_BASE_URL", "NOTIFICATION_BASE_URL", "LINK_BASE_URL",
        "BUSINESS_REDIS_PASSWORD",
    ),
    "notification": (
        "NOTI_DB_URL", "NOTI_DB_USERNAME", "NOTI_DB_PASSWORD",
        "FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT_JSON", "SVC_TOKEN_BIZ_TO_NOTI",
        "SVC_TOKEN_DATA_TO_NOTI", "SVC_TOKEN_CONSOLE_TO_NOTI", "SVC_TOKEN_NOTI_TO_DATA",
        "DATA_API_BASE_URL", "KAFKA_BOOTSTRAP_SERVERS",
    ),
}
TRANSITION_KEYS = (
    "JWT_SECRET", "GOOGLE_CLIENT_ID", "APPLE_CLIENT_ID", "FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT_JSON",
)
ANALYTICS_KEYS = (
    "GA4_FIREBASE_APP_ID", "GA4_APP_API_SECRET", "GA4_WEB_MEASUREMENT_ID", "GA4_WEB_API_SECRET",
)
OBSERVABILITY_KEYS = (
    "DD_AGENT_HOST", "DD_ENV", "DD_SERVICE", "DD_VERSION", "DD_TRACE_SAMPLE_RATE",
    "DD_LOGS_INJECTION", "DD_RUNTIME_METRICS_ENABLED",
)
SERVICE_OPTIONAL_KEYS = {
    "data-api": ANALYTICS_KEYS + (
        "BATCH_ADMIN_KEY", "LINK_IP_SALT", "FOCUS_PRESENCE_ENABLED", "REDIS_HOST", "REDIS_PORT",
        "NOTIFICATION_BASE_URL", "LINK_BASE_URL", "KAFKA_BOOTSTRAP_SERVERS",
        "INTERNAL_API_ENABLED", "OUTBOX_RELAY_ENABLED", "OUTBOX_RELAY_BATCH_SIZE",
        "OUTBOX_RELAY_LEASE_DURATION", "OUTBOX_RELAY_POLL_INTERVAL", "OUTBOX_RELAY_INITIAL_BACKOFF",
        "OUTBOX_RELAY_MAX_BACKOFF", "OUTBOX_RELAY_WARNING_ATTEMPTS", "NOTIFICATION_DISPATCH_MODE",
    ),
    "business-api": (
        "DATA_API_BASE_URL", "NOTIFICATION_BASE_URL", "LINK_BASE_URL",
        "GOOGLE_CLIENT_ID", "APPLE_CLIENT_ID", "LINK_IP_SALT", "LINK_PROXY_SECRET",
        "LINK_TRUSTED_IP_HEADERS", "COMPAT_MATCH_HANDLER_ENABLED", "COMPAT_IMPORT_CONTRACT_READY",
        "COMPAT_MIGRATION_ID", "BUSINESS_COMPAT_CLAIM_QUEUE_REPLAY_ENABLED",
        "GOOGLE_DRIVE_API_KEY",
    ),
    "notification": (
        "NOTIFICATION_SCHEDULING_ENABLED", "NOTIFICATION_KAFKA_ENABLED", "NOTIFICATION_GENERATION_REQUIRED",
    ),
}
IMAGE_KEYS = {
    "data-api": "APP_IMAGE", "business-api": "BUSINESS_API_IMAGE", "notification": "NOTIFICATION_IMAGE",
}


def require(secret: dict[str, Any], keys: tuple[str, ...]) -> None:
    """누락·null·빈 문자열을 값 노출 없이 실패시킨다."""
    missing = [key for key in keys if secret.get(key) is None or secret.get(key) == ""
               or isinstance(secret.get(key), str) and not secret[key].strip()]
    if missing:
        raise ValueError(f"필수 시크릿 누락: {', '.join(missing)}")


def dotenv_quote(value: Any) -> str:
    """Compose가 보간하지 않는 single-quoted dotenv 값으로 직렬화한다."""
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    elif isinstance(value, str):
        text = value
    elif value is None:
        raise ValueError("null 값은 dotenv로 직렬화할 수 없습니다")
    else:
        text = str(value)
    if "\0" in text:
        raise ValueError("NUL 문자는 환경 변수에 사용할 수 없습니다")
    # Compose dotenv의 single quote는 $, #, 공백, 실제 줄바꿈을 literal로 유지한다.
    return "'" + text.replace("'", "\\'") + "'"


def render(secret: dict[str, Any], app_image: str, service: str = "legacy",
           phase: str = "transition", environment: str = "dev") -> str:
    if service != "legacy":
        return render_service(secret, app_image, service, phase, environment)
    require(secret, REQUIRED_KEYS)

    values: list[tuple[str, Any]] = [("APP_IMAGE", app_image)]
    values.extend((key, secret[key]) for key in REQUIRED_KEYS)
    values.extend(
        (
            ("GRAFANA_ADMIN_USER", secret.get("GRAFANA_ADMIN_USER", "admin")),
            ("GRAFANA_ADMIN_PASSWORD", secret.get("GRAFANA_ADMIN_PASSWORD", "admin")),
        )
    )
    return "".join(f"{key}={dotenv_quote(value)}\n" for key, value in values)


def render_service(secret: dict[str, Any], image: str, service: str,
                   phase: str, environment: str) -> str:
    if service not in SERVICE_REQUIRED_KEYS:
        raise ValueError("알 수 없는 서비스")
    if phase not in ("transition", "final") or environment not in ("dev", "prod"):
        raise ValueError("지원하지 않는 배포 단계 또는 환경")
    if not image.strip():
        raise ValueError("서비스 이미지가 필요합니다")
    required = SERVICE_REQUIRED_KEYS[service]
    if service == "data-api" and phase == "transition":
        required += TRANSITION_KEYS
    require(secret, required)
    values: list[tuple[str, Any]] = [
        (IMAGE_KEYS[service], image), ("SPRING_PROFILES_ACTIVE", environment + ",satellites" if service == "data-api" else environment),
    ]
    values.extend((key, secret[key]) for key in required)
    optional = SERVICE_OPTIONAL_KEYS[service] + OBSERVABILITY_KEYS
    values.extend((key, secret[key]) for key in optional if key not in required and key in secret and secret[key] is not None)
    return "".join(f"{key}={dotenv_quote(value)}\n" for key, value in values)


def business_redis_acl(secret: dict[str, Any]) -> str:
    """Business 캐시만 허용한다. 비밀번호 원문은 Redis 설정·인자에 넣지 않는다."""
    require(secret, ("BUSINESS_REDIS_PASSWORD",))
    password = secret["BUSINESS_REDIS_PASSWORD"]
    if not isinstance(password, str):
        raise ValueError("BUSINESS_REDIS_PASSWORD는 문자열이어야 합니다")
    digest = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return ("user default off\n"
            "user health on nopass +ping\n"
            f"user business on #{digest} ~cache:business:* "
            "+get +set +incrby +expire +eval +evalsha +script|load "
            "+ping +hello +info +select +client|setinfo +client|setname\n")


def write_atomic(output: Path, content: str, mode: int = 0o600) -> None:
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent, text=True)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        os.chmod(output, mode)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--app-image", "--image", dest="app_image", required=True)
    parser.add_argument("--service", choices=("legacy", *SERVICE_REQUIRED_KEYS), default="legacy")
    parser.add_argument("--phase", choices=("transition", "final"), default="transition")
    parser.add_argument("--environment", choices=("dev", "prod"), default="dev")
    parser.add_argument("--redis-acl-output", type=Path)
    args = parser.parse_args()

    secret = json.load(sys.stdin)
    if not isinstance(secret, dict):
        raise ValueError("SecretString은 JSON object여야 합니다")
    rendered = render(secret, args.app_image, args.service, args.phase, args.environment)
    if args.redis_acl_output:
        if args.service != "business-api" or args.redis_acl_output.resolve() == args.output.resolve():
            raise ValueError("Redis ACL은 business-api env와 다른 파일로 작성해야 합니다")
        acl = business_redis_acl(secret)
        # 부모 디렉터리는 0700. 컨테이너의 redis uid가 읽을 수 있게 해시 ACL 파일만 0644다.
        write_atomic(args.redis_acl_output, acl, mode=0o644)
    write_atomic(args.output, rendered)


if __name__ == "__main__":
    main()
