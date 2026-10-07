#!/usr/bin/env python3
"""업로드 뒤 트랙 재조회 — VERSION_CODE 가 EXPECTED_STATUS 로 들어갔는지 (GROMO-2223).

입력: PLAY_SERVICE_ACCOUNT_FILE · PLAY_PACKAGE_NAME · TRACK · VERSION_CODE · EXPECTED_STATUS
읽기만 함. 표준 라이브러리만 씀 (play_api.py).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from play_api import Play  # noqa: E402


def main() -> int:
    play = Play(os.environ["PLAY_SERVICE_ACCOUNT_FILE"], os.environ["PLAY_PACKAGE_NAME"])
    track, want, status = os.environ["TRACK"], os.environ["VERSION_CODE"], os.environ["EXPECTED_STATUS"]
    with play.read_edit() as eid:
        releases = play.call("GET", f"/edits/{eid}/tracks/{track}").get("releases", [])
    print(f"{track} 트랙: {[(r.get('status'), r.get('versionCodes')) for r in releases]}")
    hit = [r for r in releases if want in r.get("versionCodes", [])]
    if not hit or hit[0].get("status") != status:
        print(f"::error::{track} 트랙에 versionCode {want} 가 {status} 상태로 없다")
        return 1
    print(f"확인: versionCode {want} → {track} ({status})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
