#!/usr/bin/env python3
"""Play Console 에 이미 쓰인 가장 큰 versionCode + 1 을 출력한다 (GROMO-2223).

모든 트랙(내부·비공개·프로덕션 등)의 릴리스와, 릴리스에 붙지 않은 채 업로드만 된 번들까지 본다.
Play 는 한 번 업로드된 versionCode 를 다시 받지 않기 때문이다.

입력(환경변수)
  PLAY_SERVICE_ACCOUNT_FILE  서비스 계정 키 JSON 파일 경로 (Play Console 에서 이 앱의 릴리스 권한 필요)
                             (대신 PLAY_SERVICE_ACCOUNT_JSON 에 JSON 본문을 줘도 된다)
  PLAY_PACKAGE_NAME          예: com.oneorthree.gromo
  MIN_VERSION_CODE           하한(선택). 저장소의 versionCode 보다 작은 값이 나오지 않게 한다.

읽기만 한다. 조회용 edit 를 열었다가 커밋하지 않고 지운다.
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
