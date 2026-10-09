#!/usr/bin/env python3
"""Play 에 이미 쓴 최대 versionCode + 1 출력 (GROMO-2223).

모든 트랙 릴리스 + 릴리스 안 붙은 업로드 번들·APK 까지 봄. Play 는 한 번 쓴 versionCode 재사용 불가.

입력(환경변수)
  PLAY_SERVICE_ACCOUNT_FILE  서비스 계정 키 JSON 파일 경로 (이 앱 릴리스 권한 필요)
  PLAY_PACKAGE_NAME          예: com.oneorthree.gromo
  MIN_VERSION_CODE           하한(선택). build.gradle versionCode 보다 작아지지 않게

읽기만 함. 조회용 edit 는 커밋 안 하고 지움. 표준 라이브러리만 씀 (play_api.py).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from play_api import Play  # noqa: E402


def main() -> int:
    floor = int(os.environ.get("MIN_VERSION_CODE") or "0")
    play = Play(os.environ["PLAY_SERVICE_ACCOUNT_FILE"], os.environ["PLAY_PACKAGE_NAME"])
    codes = []
    with play.read_edit() as eid:
        for track in play.call("GET", f"/edits/{eid}/tracks").get("tracks", []):
            for release in track.get("releases", []):
                codes += [int(c) for c in release.get("versionCodes", [])]
        codes += [int(b["versionCode"]) for b in play.call("GET", f"/edits/{eid}/bundles").get("bundles", [])]
        codes += [int(a["versionCode"]) for a in play.call("GET", f"/edits/{eid}/apks").get("apks", [])]
    latest = max(codes, default=0)
    print(f"Play 최대 versionCode={latest}, 하한={floor}", file=sys.stderr)
    print(max(latest, floor) + 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
