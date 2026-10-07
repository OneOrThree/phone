#!/usr/bin/env python3
"""Play 에 이미 쓴 최대 versionCode + 1 출력 (GROMO-2223).

모든 트랙 릴리스 + 릴리스 안 붙은 업로드 번들·APK 까지 봄. Play 는 한 번 쓴 versionCode 재사용 불가.

입력(환경변수)
  PLAY_SERVICE_ACCOUNT_FILE  서비스 계정 키 JSON 파일 경로 (이 앱 릴리스 권한 필요)
                             또는 PLAY_SERVICE_ACCOUNT_JSON 에 JSON 본문
  PLAY_PACKAGE_NAME          예: com.oneorthree.gromo
  MIN_VERSION_CODE           하한(선택). build.gradle versionCode 보다 작아지지 않게

읽기만 함. 조회용 edit 는 커밋 안 하고 지움.
"""
import json
import os
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"


def main() -> int:
    package = os.environ["PLAY_PACKAGE_NAME"]
    floor = int(os.environ.get("MIN_VERSION_CODE") or "0")
    path = os.environ.get("PLAY_SERVICE_ACCOUNT_FILE")
    if path:
        with open(path, encoding="utf-8") as f:
            info = json.load(f)
    else:
        info = json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"])
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/androidpublisher"]
    )
    session = AuthorizedSession(creds)

    resp = session.post(f"{API}/{package}/edits", json={})
    if resp.status_code != 200:
        print(f"::error::Play edit 생성 실패 {resp.status_code}: {resp.text[:300]}", file=sys.stderr)
        return 1
    edit_id = resp.json()["id"]
    codes = []
    try:
        tracks = session.get(f"{API}/{package}/edits/{edit_id}/tracks")
        tracks.raise_for_status()
        for track in tracks.json().get("tracks", []):
            for release in track.get("releases", []):
                codes += [int(c) for c in release.get("versionCodes", [])]
        bundles = session.get(f"{API}/{package}/edits/{edit_id}/bundles")
        bundles.raise_for_status()
        codes += [int(b["versionCode"]) for b in bundles.json().get("bundles", [])]
        apks = session.get(f"{API}/{package}/edits/{edit_id}/apks")
        apks.raise_for_status()
        codes += [int(a["versionCode"]) for a in apks.json().get("apks", [])]
    finally:
        session.delete(f"{API}/{package}/edits/{edit_id}")

    latest = max(codes, default=0)
    print(f"Play 최대 versionCode={latest}, 하한={floor}", file=sys.stderr)
    print(max(latest, floor) + 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
