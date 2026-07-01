#!/usr/bin/env bash
# gromo iOS → TestFlight 한 방 배포
# 사용법: ./testflight.sh   (또는 alias 로 등록해서 어디서든 `testflight`)
#
# 하는 일:
#   1) Pods 가 Podfile.lock 과 어긋났을 때만 pod install (평소엔 건너뜀)
#   2) fastlane beta 로 빌드 → 서명 → TestFlight 업로드
set -euo pipefail

# 스크립트 위치(app/ios)로 이동 → 어디서 실행해도 동작
cd "$(dirname "$0")"

# node 가 PATH 에 없으면 보강(일부 셸 환경 대비)
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/Cellar/node@24/24.17.0/bin:$PATH"

# 릴리즈(TestFlight)는 항상 팀/프로덕션 서버로 — 로컬 .env(개발용 로컬 백엔드)를 덮어쓴다.
# (Expo 는 셸에 export 된 EXPO_PUBLIC_* 가 .env 보다 우선 적용됨)
export EXPO_PUBLIC_API_URL="${TESTFLIGHT_API_URL:-https://oneorthree.mooo.com}"
echo "🌐 API 서버: $EXPO_PUBLIC_API_URL"

# Pods 동기화: lock 이 어긋날 때만 pod install
if diff -q Podfile.lock Pods/Manifest.lock >/dev/null 2>&1; then
  echo "✅ Pods 동기화됨 — pod install 건너뜀"
else
  echo "📦 Pods 변경 감지 → pod install 실행"
  pod install
fi

echo "🚀 fastlane beta → TestFlight 업로드..."
bundle exec fastlane beta
