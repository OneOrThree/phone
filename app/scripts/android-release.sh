#!/usr/bin/env bash
# GROMO-993 — 안드로이드 릴리즈 빌드 (Sentry·Datadog 키 주입 포함, iOS testflight.sh 대응물)
# 사용법:
#   ./scripts/android-release.sh                         # prod 서버·prod 자격으로 .aab 빌드 — 기본
#   APP_ENV=dev ./scripts/android-release.sh             # dev 자격(서명·Firebase)으로 빌드
#   ANDROID_RELEASE_API_URL=https://oneorthree.dev.mooo.com ./scripts/android-release.sh   # dev 서버 대상
#
# 하는 일:
#   1) API URL·ENV 태그·Datadog 키를 셸 export 로 릴리즈 번들에 인라인
#      (Expo 는 셸에 export 된 EXPO_PUBLIC_* 가 .env/.env.production 보다 우선 적용됨.
#       나머지 키(Facebook 등)는 expo export:embed 가 .env.production/.env 에서 그대로 읽는다)
#   2) android/sentry.properties 없으면 Sentry 소스맵 업로드는 빠진다
#      (build.gradle 이 파일 있을 때만 업로드 훅을 걸음 — iOS 빌드 페이즈 가드와 동일 효과)
#   3) ./gradlew bundleRelease → .aab 생성 후 번들에 박힌 API URL·Datadog 키 검증
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)" # app/
ANDROID_DIR="$APP_DIR/android"

# node 가 PATH 에 없으면 보강 — gradle 의 react 플러그인이 node 로 expo export:embed 를 돌린다
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/Cellar/node@24/24.17.0/bin:$PATH"

# JAVA_HOME 미설정이면 Android Studio JBR 로 보강 (시스템 java 없는 맥 대비)
if [[ -z "${JAVA_HOME:-}" && -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi

# 릴리즈는 항상 프로덕션 서버로 — 로컬 .env(개발용 로컬 백엔드)를 덮어쓴다.
# dev 서버 대상 빌드가 필요할 때만 ANDROID_RELEASE_API_URL 로 재정의.
export EXPO_PUBLIC_API_URL="${ANDROID_RELEASE_API_URL:-https://api.oneorthree.world}"
echo "🌐 API 서버: $EXPO_PUBLIC_API_URL"

# 환경 태그(EXPO_PUBLIC_ENV)도 API 대상에 맞춰 강제 — 로컬 .env 의 dev 값이 릴리즈 번들에
# 인라인되면 Sentry·GA4·Datadog 태그가 전부 dev 로 오염된다 (iOS testflight.sh 와 동일 규칙).
if [[ "$EXPO_PUBLIC_API_URL" == "https://api.oneorthree.world" ]]; then
  export EXPO_PUBLIC_ENV="prod"
else
  export EXPO_PUBLIC_ENV="dev"
fi
echo "🏷️  ENV 태그: $EXPO_PUBLIC_ENV"

# Datadog RUM 키(GROMO-928) — 전송 주소 성격이라 비밀값 아님. dev/prod 는 RUM env 태그로 구분되므로
# 단일 RUM 앱(gromo-app) 값을 로컬 .env 상태와 무관하게 항상 빌드에 인라인한다 (testflight.sh 와 동일 값).
export EXPO_PUBLIC_DATADOG_APPLICATION_ID="44a4f021-ed4d-4134-b59d-63a40e37c2ff"
export EXPO_PUBLIC_DATADOG_CLIENT_TOKEN="pub851a727c3f95bc795ae8f9a15f5326d4"

# 서명·Firebase 자격 선택 — build.gradle 이 android/credentials/<APP_ENV>/ 를 읽는다. 릴리즈 기본 prod.
export APP_ENV="${APP_ENV:-prod}"
echo "🔑 자격(APP_ENV): $APP_ENV → android/credentials/$APP_ENV"

# Sentry 소스맵 업로드 안내 — 토큰 파일이 없으면 업로드만 빠지고 빌드는 정상 진행된다.
if [[ ! -f "$ANDROID_DIR/sentry.properties" ]]; then
  echo "⚠️  android/sentry.properties 없음 — Sentry 소스맵 업로드 건너뜀 (android/sentry.properties.example 참고)"
fi

echo "🚀 gradlew bundleRelease..."
(cd "$ANDROID_DIR" && ./gradlew bundleRelease)

# 번들 검증 — 셸 env 우선순위로 잘못된 값이 인라인되는 사고(7/20 iOS) 재발 방지:
# .aab 안 JS 번들(Hermes 바이트코드 — 문자열 리터럴은 그대로 남음)에 의도한 값이 박혔는지 확인.
AAB="$ANDROID_DIR/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$AAB" ]] || { echo "✗ $AAB 없음 — 빌드 실패?" >&2; exit 1; }
BUNDLE_STRINGS="$(mktemp)"
trap 'rm -f "$BUNDLE_STRINGS"' EXIT
if ! unzip -p "$AAB" base/assets/index.android.bundle | strings >"$BUNDLE_STRINGS"; then
  echo "✗ .aab 안에 base/assets/index.android.bundle 없음 — 번들 누락?" >&2
  exit 1
fi
if ! grep -F "$EXPO_PUBLIC_API_URL" "$BUNDLE_STRINGS" >/dev/null; then
  echo "✗ 번들에 $EXPO_PUBLIC_API_URL 이 없음 — env 우선순위 사고 방지 차원에서 중단" >&2
  exit 1
fi
if ! grep -F "$EXPO_PUBLIC_DATADOG_APPLICATION_ID" "$BUNDLE_STRINGS" >/dev/null; then
  echo "✗ 번들에 Datadog applicationId 가 없음 — 키 주입 실패" >&2
  exit 1
fi
echo "✅ 릴리즈 빌드 완료: $AAB (API URL·Datadog 키 인라인 확인됨)"
