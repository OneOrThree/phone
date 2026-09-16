#!/usr/bin/env bash
# GROMO-947 — 배포 전 E2E 일괄 실행 (로컬 전용, CI 아님)
# 빌드(dev URL 주입) → 번들 URL 검증 → 시뮬레이터 부팅/설치 → Maestro 전체 플로(01→02→03) → 결과 요약
#
# 사용법:  app/ 에서  ./scripts/e2e.sh
#   E2E_SIM_NAME=원하는 시뮬 이름, E2E_API_URL=서버 URL 로 재정의 가능.
#   빌드를 건너뛰려면  E2E_SKIP_BUILD=1 ./scripts/e2e.sh  (직전 빌드 재사용)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)" # app/
IOS_DIR="$APP_DIR/ios"
APP_BUNDLE="$IOS_DIR/build/e2e/Build/Products/Release-iphonesimulator/gromo.app"
SIM_NAME="${E2E_SIM_NAME:-iPhone 17}"
API_URL="${E2E_API_URL:-https://oneorthree.dev.mooo.com}"
# Maestro는 Java 위에서 돈다 — brew openjdk는 keg-only라 PATH에 없어서 직접 지정
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"

# 실행이 만든 게스트 계정 정리(dev 서버 누적 방지) — 게스트는 앱 UI에 탈퇴 경로가 없어서
# (계정 설정의 로그아웃·탈퇴는 소셜 유저 분기 전용) 시뮬레이터 앱 컨테이너의 AsyncStorage에서
# 토큰을 꺼내 탈퇴 API(DELETE /api/v1/users/me)를 직접 호출한다.
# 스위트가 중간에 실패해도 로그인까지 갔다면 정리된다. 정리 실패는 경고만(관문 판정과 무관).
cleanup_e2e_account() {
  local container manifest token code
  [ -n "${UDID:-}" ] || return 0
  container=$(xcrun simctl get_app_container "$UDID" com.oneorthree.gromo data 2>/dev/null) || return 0
  manifest="$container/Library/Application Support/com.oneorthree.gromo/RCTAsyncLocalStorage_V1/manifest.json"
  [ -f "$manifest" ] || return 0
  token=$(python3 -c "import json,sys; m=json.load(open(sys.argv[1])); t=m.get('gromo:accessToken'); print(t if t else '')" "$manifest" 2>/dev/null) || return 0
  [ -n "$token" ] || return 0
  code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE -H "Authorization: Bearer $token" "$API_URL/api/v1/users/me" || echo 000)
  if [ "$code" = "204" ] || [ "$code" = "200" ]; then
    echo "▶︎ [정리] E2E 게스트 계정 탈퇴 완료 (HTTP $code)"
  else
    echo "⚠️  [정리] E2E 계정 탈퇴 실패(HTTP $code) — dev 서버에 계정이 남았을 수 있음" >&2
  fi
}

if [ "${E2E_SKIP_BUILD:-0}" != "1" ]; then
  echo "▶︎ [1/4] Release 시뮬레이터 빌드 (API: $API_URL)"
  # Release는 .env.production(운영 URL)을 읽으므로, 셸 env가 .env 파일보다 우선하는 성질을
  # 의도적으로 써서 dev URL을 주입한다 (7/20 사고의 메커니즘을 역이용).
  # EXPO_PUBLIC_E2E=1 — App.tsx의 hot-updater OTA 게이트 우회 (스테일 번들 오염 방지).
  # APP_ENV=dev — Firebase plist 주입 페이즈가 읽는 값. e2e는 항상 dev 서버 대상이므로 dev 로 고정한다
  # (셸에 APP_ENV=prod 가 남아 있어도 e2e 빌드가 prod 파베로 넘어가지 않게).
  (cd "$IOS_DIR" && EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_E2E=1 APP_ENV=dev xcodebuild \
    -workspace gromo.xcworkspace -scheme gromo -configuration Release \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath build/e2e -quiet build)
else
  echo "▶︎ [1/4] 빌드 생략 (E2E_SKIP_BUILD=1) — 기존 빌드 재사용"
fi

echo "▶︎ [2/4] 번들에 박힌 API URL 검증 + 서명 보정"
[ -f "$APP_BUNDLE/main.jsbundle" ] || { echo "✗ main.jsbundle 없음 — 빌드 실패?" >&2; exit 1; }
# 증분 빌드가 간혹 메인 실행파일 서명을 빼먹는다 → 미서명이면 SpringBoard가 실행 거부
# (SBMainWorkspace denied). ad-hoc 재서명은 멱등이라 매번 보정한다.
if ! codesign -v "$APP_BUNDLE" 2>/dev/null; then
  echo "  · 미서명 감지 — ad-hoc 재서명"
  codesign --force --deep --sign - "$APP_BUNDLE"
fi
# grep -q 금지 — 첫 매치에서 조기 종료하면 strings가 SIGPIPE로 죽어 pipefail이 오탐한다
if ! strings "$APP_BUNDLE/main.jsbundle" | grep "$API_URL" >/dev/null; then
  echo "✗ 번들에 $API_URL 이 없음 — env 우선순위 사고 방지 차원에서 중단" >&2
  exit 1
fi
# 참고: 번들에 운영 URL(api.oneorthree.world)이 함께 보이는 건 datadog.ts의
# first-party hosts 매칭 문자열 — API baseURL과 무관하므로 검사하지 않는다.

echo "▶︎ [3/4] 시뮬레이터 준비 + 앱 설치 ($SIM_NAME)"
UDID=$(xcrun simctl list devices available | grep -m1 "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1)
[ -n "$UDID" ] || { echo "✗ 시뮬레이터 '$SIM_NAME' 없음 — xcrun simctl list devices 확인" >&2; exit 1; }
# 어떤 종료 경로든(성공·실패) 이 실행이 만든 계정을 정리한다
trap cleanup_e2e_account EXIT
xcrun simctl bootstatus "$UDID" -b # 부팅 대기 (이미 켜져 있으면 즉시 통과)
# 삭제 후 설치 — 시스템 권한 상태(clearState로 리셋 안 됨)와 이전 실행의 OTA 번들 잔재를
# 함께 제거해 매 실행을 같은 초기 상태에서 시작한다.
xcrun simctl uninstall "$UDID" com.oneorthree.gromo 2>/dev/null || true
xcrun simctl install "$UDID" "$APP_BUNDLE"

echo "▶︎ [4/4] Maestro 플로 실행 (01→02→03 순서 의존)"
mkdir -p "$APP_DIR/.maestro/report"
maestro --device "$UDID" test "$APP_DIR/.maestro" \
  --format junit --output "$APP_DIR/.maestro/report/e2e-report.xml"

echo "✓ 전체 플로 통과 — 리포트: app/.maestro/report/e2e-report.xml"
