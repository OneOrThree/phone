#!/usr/bin/env python3
"""Secrets Manager JSON을 Docker Compose용 dotenv 파일로 원자적으로 쓴다."""

from __future__ import annotations

import argparse
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


def render(secret: dict[str, Any], app_image: str) -> str:
    missing = [key for key in REQUIRED_KEYS if key not in secret or secret[key] is None]
    if missing:
        raise ValueError(f"필수 시크릿 누락: {', '.join(missing)}")

    values: list[tuple[str, Any]] = [("APP_IMAGE", app_image)]
    values.extend((key, secret[key]) for key in REQUIRED_KEYS)
    values.extend(
        (
            ("GRAFANA_ADMIN_USER", secret.get("GRAFANA_ADMIN_USER", "admin")),
            ("GRAFANA_ADMIN_PASSWORD", secret.get("GRAFANA_ADMIN_PASSWORD", "admin")),
        )
    )
    return "".join(f"{key}={dotenv_quote(value)}\n" for key, value in values)


def write_atomic(output: Path, content: str) -> None:
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{output.name}.", dir=output.parent, text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
        os.chmod(output, 0o600)
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
    parser.add_argument("--app-image", required=True)
    args = parser.parse_args()

    secret = json.load(sys.stdin)
    if not isinstance(secret, dict):
        raise ValueError("SecretString은 JSON object여야 합니다")
    write_atomic(args.output, render(secret, args.app_image))


if __name__ == "__main__":
    main()
