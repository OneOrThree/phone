#!/usr/bin/env python3
"""Android 시크릿의 공개 PostHog SDK 설정만 GitHub job output으로 변환한다."""

import json
import re
import sys


def sdk_outputs(secret):
    if not isinstance(secret, dict):
        raise ValueError("Android 시크릿은 JSON 객체여야 합니다")
    token = secret.get("POSTHOG_PROJECT_TOKEN")
    if not isinstance(token, str) or not re.fullmatch(r"phc_[A-Za-z0-9_-]+", token):
        raise ValueError("POSTHOG_PROJECT_TOKEN에 유효한 프로젝트 토큰이 필요합니다")

    region = secret.get("POSTHOG_REGION")
    if not isinstance(region, str):
        raise ValueError("POSTHOG_REGION에 US/EU Cloud 또는 PostHog 주소가 필요합니다")
    region = region.strip().lower().rstrip("/")
    clouds = {
        alias: cloud
        for cloud in ("us", "eu")
        for alias in (
            cloud, f"{cloud} cloud", f"https://{cloud}.i.posthog.com",
            f"https://{cloud}.posthog.com",
        )
    }
    if region not in clouds:
        raise ValueError("POSTHOG_REGION은 US/EU Cloud 또는 해당 PostHog 주소여야 합니다")
    cloud = clouds[region]
    # 프로젝트 토큰은 앱에 포함되는 공개값이다. 개인 API 키·Play 키는 전달하지 않는다.
    return {
        "posthog-project-token": token,
        "posthog-host": f"https://{cloud}.i.posthog.com",
        "posthog-cli-host": f"https://{cloud}.posthog.com",
    }


if __name__ == "__main__":
    try:
        outputs = sdk_outputs(json.load(sys.stdin))
    except (ValueError, TypeError) as error:
        # JSON 파싱 오류의 원문에는 시크릿이 포함될 수 있어 출력하지 않는다.
        message = "Android 시크릿 JSON을 읽지 못했습니다" if isinstance(error, json.JSONDecodeError) else str(error)
        print(f"::error::{message}", file=sys.stderr)
        sys.exit(1)
    for name, value in outputs.items():
        print(f"{name}={value}")
