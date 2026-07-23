#!/usr/bin/env bash
# gromo iOS → TestFlight 한 방 배포
# 사용법:
#   ./testflight.sh           테스트 업로드 (fastlane beta, 태그 없음) — 기본
#   ./testflight.sh release   심사 제출용 (fastlane release, 빌드번호 커밋·태그·푸시, arelease/* 에서만)
# (alias 로 등록하면 어디서든 `testflight` / `testflight release`)
#
# 하는 일:
#   1) Pods 가 Podfile.lock 과 어긋났을 때만 pod install (평소엔 건너뜀)
#   2) fastlane <레인> 으로 빌드 → 서명 → TestFlight 업로드
set -euo pipefail

# 레인 선택 (기본 beta). beta/release 만 허용.
LANE="${1:-beta}"
if [[ "$LANE" != "beta" && "$LANE" != "release" ]]; then
  echo "❌ 알 수 없는 레인: $LANE (beta 또는 release 만 가능)" >&2
  exit 1
fi

# 스크립트 위치(app/ios)로 이동 → 어디서 실행해도 동작
cd "$(dirname "$0")"

# node 가 PATH 에 없으면 보강(일부 셸 환경 대비)
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/Cellar/node@24/24.17.0/bin:$PATH"

# 릴리즈(TestFlight)는 항상 프로덕션 서버로 — 로컬 .env(개발용 로컬 백엔드)를 덮어쓴다.
# (Expo 는 셸에 export 된 EXPO_PUBLIC_* 가 .env/.env.production 보다 우선 적용됨)
# dev 서버로 올려야 할 때만 TESTFLIGHT_API_URL=https://oneorthree.dev.mooo.com ./testflight.sh
export EXPO_PUBLIC_API_URL="${TESTFLIGHT_API_URL:-https://api.oneorthree.world}"
echo "🌐 API 서버: $EXPO_PUBLIC_API_URL"

# Datadog RUM 키(GROMO-928) — 전송 주소 성격이라 비밀값 아님. dev/prod 는 RUM env 태그로 구분되므로
# 단일 RUM 앱(gromo-app) 값을 로컬 .env 상태와 무관하게 항상 빌드에 인라인한다.
export EXPO_PUBLIC_DATADOG_APPLICATION_ID="44a4f021-ed4d-4134-b59d-63a40e37c2ff"
export EXPO_PUBLIC_DATADOG_CLIENT_TOKEN="pub851a727c3f95bc795ae8f9a15f5326d4"

# Pods 동기화: lock 이 어긋날 때만 pod install
if diff -q Podfile.lock Pods/Manifest.lock >/dev/null 2>&1; then
  echo "✅ Pods 동기화됨 — pod install 건너뜀"
else
  echo "📦 Pods 변경 감지 → pod install 실행"
  pod install
fi

echo "🚀 fastlane $LANE → TestFlight 업로드..."
bundle exec fastlane "$LANE"
