#!/usr/bin/env python3
"""Secrets Manager JSON을 Docker Compose용 dotenv 파일로 원자적으로 쓴다."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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

# legacy(dev-cd 가 쓰는 공유 dev.env)가 «있으면 옮기는» 값. 이 파일은 컨테이너 env_file 이 아니라 compose 보간
# 입력이라 compose 가 ${...} 로 참조하는 키만 컨테이너에 닿는다(dev.yml·realtime.yml). 비어 있을 때의 동작은
# server/scripts/README.md 「시크릿·스위치」 표. 필수로 올리지 않는 이유: 넣기 전 배포가 막히면 안 된다.
LEGACY_OPTIONAL_KEYS = (
    "FOCUS_PRESENCE_ENABLED", "FOCUS_SESSION_START_ENABLED", "FOCUS_REWARD_ACCRUAL_ENABLED",
    # docker-compose.realtime.yml — GROMO-1954 Data 사건 수신 · GROMO-1775 우체통 · R-1 Kafka 입구
    "SVC_TOKEN_DATA_TO_REALTIME", "SVC_TOKEN_BIZ_TO_REALTIME", "CHAT_WS_ALLOWED_ORIGINS",
    "REALTIME_EVENTS_KAFKA_ENABLED", "KAFKA_BOOTSTRAP_SERVERS", "CHAT_POSTGRES_DB",
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
        # GROMO-1775 우체통 — 실시간 서버 주소·전용 토큰(A22 ㊀: Data·알림·링크 토큰과 분리). 빠지면
        # InternalHttpClient 가 부팅에서 fail-fast 하므로 env 생성 단계가 먼저 막는다.
        "REALTIME_BASE_URL", "SVC_TOKEN_BIZ_TO_REALTIME",
        # GROMO-1908 로그인 시도 자격 digest 비밀. JWT_SECRET 과 «다른 값»(계정 LLD §3).
        # 없으면 Business 가 부팅에서 fail-fast 한다(CredentialDigest).
        "LOGIN_ATTEMPT_DIGEST_SECRET",
        # GROMO-1759 목록 커서 서명. «필수» 인 이유: 없으면 컨테이너는 정상 부팅하고 GET /islands ·
        # /islands/discover 만 첫 요청에서 503 이 된다 — 부팅 로그·헬스체크가 조용해 배포 뒤에야 드러난다.
        # 여기서 막으면 배포 «전에» 실패한다(application-{dev,prod}.yml 의 자리표시자는 그래서 기본값이 없다).
        "BUSINESS_CURSOR_ENABLED", "BUSINESS_CURSOR_KEY_V1",
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
        "BATCH_ADMIN_KEY", "LINK_IP_SALT", "FOCUS_PRESENCE_ENABLED", "FOCUS_SESSION_START_ENABLED",
        "FOCUS_REWARD_ACCRUAL_ENABLED",
        "REDIS_HOST", "REDIS_PORT",
        "NOTIFICATION_BASE_URL", "LINK_BASE_URL", "KAFKA_BOOTSTRAP_SERVERS",
        "INTERNAL_API_ENABLED", "OUTBOX_RELAY_ENABLED", "OUTBOX_RELAY_BATCH_SIZE",
        "OUTBOX_RELAY_LEASE_DURATION", "OUTBOX_RELAY_POLL_INTERVAL", "OUTBOX_RELAY_INITIAL_BACKOFF",
        "OUTBOX_RELAY_MAX_BACKOFF", "OUTBOX_RELAY_WARNING_ATTEMPTS", "NOTIFICATION_DISPATCH_MODE",
        # GROMO-1954 REALTIME 전달(HTTP 기본 · Kafka 선택). relay 를 켜면 필수다 — 비면 OutboxRelayProperties 가
        # 기동을 거부한다. relay 가 꺼진 지금 필수로 올리면 비밀을 넣기 전 배포가 막혀 선택으로 둔다.
        "REALTIME_BASE_URL", "SVC_TOKEN_DATA_TO_REALTIME", "OUTBOX_RELAY_REALTIME_KAFKA_ENABLED",
    ),
    "business-api": (
        "DATA_API_BASE_URL", "NOTIFICATION_BASE_URL", "LINK_BASE_URL",
        "GOOGLE_CLIENT_ID", "APPLE_CLIENT_ID", "LINK_IP_SALT", "LINK_PROXY_SECRET",
        "LINK_TRUSTED_IP_HEADERS", "COMPAT_MATCH_HANDLER_ENABLED", "COMPAT_IMPORT_CONTRACT_READY",
        "COMPAT_MIGRATION_ID", "BUSINESS_COMPAT_CLAIM_QUEUE_REPLAY_ENABLED",
        "GOOGLE_DRIVE_API_KEY",
        # 커서 서명키 회전용 — 비우면 yml 기본값 v1. keys.v2 를 더한 뒤 이 값을 옮긴다(GROMO-1759).
        "BUSINESS_CURSOR_ACTIVE_KEY",
    ),
    "notification": (
        "NOTIFICATION_SCHEDULING_ENABLED", "NOTIFICATION_KAFKA_ENABLED", "NOTIFICATION_GENERATION_REQUIRED",
        "NOTIFICATION_LEGACY_DEVICE_REGISTRATION",
    ),
}
IMAGE_KEYS = {
    "data-api": "APP_IMAGE", "business-api": "BUSINESS_API_IMAGE", "notification": "NOTIFICATION_IMAGE",
}

# ServiceAuth의 String.trim()/isBlank()와 같은 집합이다. Python strip/isspace는 NBSP 등도 포함한다.
JAVA_TRIM_CHARACTERS = "".join(chr(code) for code in range(33))
JAVA_WHITESPACE = frozenset("\t\n\v\f\r\x1c\x1d\x1e\x1f \u1680\u2000\u2001\u2002\u2003"
                            "\u2004\u2005\u2006\u2008\u2009\u200a\u2028\u2029\u205f\u3000")


def validate_notification_tokens(secret: dict[str, Any]) -> None:
    """ServiceAuth와 같은 콘솔 파싱·caller 중복 검사. 검증만 하고 출력할 원문은 바꾸지 않는다."""
    console_key = "SVC_TOKEN_CONSOLE_TO_NOTI"
    business_key, data_key = "SVC_TOKEN_BIZ_TO_NOTI", "SVC_TOKEN_DATA_TO_NOTI"
    for key in (console_key, business_key, data_key):
        if not isinstance(secret[key], str) or "${" in secret[key]:
            raise ValueError(f"서비스 토큰 형식 오류: {key}")
    console_tokens: set[str] = set()
    for entry in secret[console_key].split(","):
        pair = entry.strip(JAVA_TRIM_CHARACTERS)
        if not pair:
            continue
        actor, separator, token = pair.partition(":")
        actor, token = actor.strip(JAVA_TRIM_CHARACTERS), token.strip(JAVA_TRIM_CHARACTERS)
        if not separator or not re.fullmatch(r"member-[1-3]", actor) or all(c in JAVA_WHITESPACE for c in token):
            raise ValueError(f"{console_key}는 member-1~3:토큰 목록이어야 합니다")
        if token in console_tokens:
            raise ValueError(f"{console_key}의 토큰은 서로 달라야 합니다")
        console_tokens.add(token)
    if not console_tokens:
        raise ValueError(f"필수 시크릿 누락: {console_key}")
    business, data = secret[business_key], secret[data_key]
    if business == data or business in console_tokens or data in console_tokens:
        raise ValueError("알림 caller 토큰은 서로 달라야 합니다: " + ", ".join((console_key, business_key, data_key)))


def validate_realtime_tokens(secret: dict[str, Any]) -> None:
    """Realtime 의 두 caller 토큰은 달라야 한다. 같으면 Data 자격으로 Business 전용 /internal/*(우체통)을
    X-User-Id 와 함께 부를 수 있다(A22 ㊀). 둘 다 있을 때만 비교하고 값은 출력하지 않는다."""
    data, business = secret.get("SVC_TOKEN_DATA_TO_REALTIME"), secret.get("SVC_TOKEN_BIZ_TO_REALTIME")
    if data and business and data == business:
        raise ValueError("Realtime caller 토큰은 서로 달라야 합니다: SVC_TOKEN_DATA_TO_REALTIME, SVC_TOKEN_BIZ_TO_REALTIME")


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
           phase: str = "transition", environment: str = "dev", *, data_profiles: str | None = None) -> str:
    validate_realtime_tokens(secret)
    if service != "legacy":
        return render_service(secret, app_image, service, phase, environment, data_profiles=data_profiles)
    if data_profiles is not None:
        raise ValueError("Data 프로파일은 data-api에만 지정할 수 있습니다")
    require(secret, REQUIRED_KEYS)

    values: list[tuple[str, Any]] = [("APP_IMAGE", app_image)]
    values.extend((key, secret[key]) for key in REQUIRED_KEYS)
    values.extend(
        (
            ("GRAFANA_ADMIN_USER", secret.get("GRAFANA_ADMIN_USER", "admin")),
            ("GRAFANA_ADMIN_PASSWORD", secret.get("GRAFANA_ADMIN_PASSWORD", "admin")),
        )
    )
    values.extend((key, secret[key]) for key in LEGACY_OPTIONAL_KEYS if secret.get(key) is not None)
    return "".join(f"{key}={dotenv_quote(value)}\n" for key, value in values)


def render_service(secret: dict[str, Any], image: str, service: str,
                   phase: str, environment: str, *, data_profiles: str | None = None) -> str:
    if service not in SERVICE_REQUIRED_KEYS:
        raise ValueError("알 수 없는 서비스")
    if phase not in ("transition", "final") or environment not in ("dev", "prod"):
        raise ValueError("지원하지 않는 배포 단계 또는 환경")
    if not image.strip():
        raise ValueError("서비스 이미지가 필요합니다")
    profiles = environment
    if service == "data-api":
        profiles = data_profiles if data_profiles is not None else f"{environment},satellites"
        if "satellites" not in {profile.strip() for profile in profiles.split(",")}:
            raise ValueError("Data 프로파일에 satellites 항목이 필요합니다")
    elif data_profiles is not None:
        raise ValueError("Data 프로파일은 data-api에만 지정할 수 있습니다")
    required = SERVICE_REQUIRED_KEYS[service]
    if service == "data-api" and phase == "transition":
        required += TRANSITION_KEYS
    if service == "business-api" and environment == "prod":
        required += ("LINK_PROXY_SECRET",)
    require(secret, required)
    if service == "notification":
        validate_notification_tokens(secret)
    values: list[tuple[str, Any]] = [
        (IMAGE_KEYS[service], image), ("SPRING_PROFILES_ACTIVE", profiles),
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
            "+get +set +incrby +expire +eval +evalsha +script|load +scan +del "
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
