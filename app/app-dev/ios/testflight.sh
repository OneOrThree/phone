#!/usr/bin/env bash
# Fishcat iOS → TestFlight 테스트 빌드 업로드
#   ./testflight.sh        운영 서버 빌드 (fastlane beta)
#   ./testflight.sh --dev  팀 dev 서버 빌드 (fastlane beta_dev) — main 머지 자동 빌드도 이 경로를 쓴다
set -euo pipefail

cd "$(dirname "$0")"

AUDIENCE="prod"
if [[ "${1:-}" == "--dev" ]]; then
  AUDIENCE="dev"
fi

if [[ "$AUDIENCE" == "prod" ]]; then
  if [[ "${EXPO_PUBLIC_API_URL:-}" != "https://api.oneorthree.world" ]]; then
    echo "❌ iOS release/TestFlight 차단: EXPO_PUBLIC_API_URL을 운영 주소 https://api.oneorthree.world 로 설정하세요." >&2
    exit 1
  fi
  if [[ "${EXPO_PUBLIC_APPLE_LOGIN_ENABLED:-}" != "1" ]]; then
    echo "❌ iOS release/TestFlight 차단: 서버가 Apple의 gromo·focuscat 이중 audience를 검증할 준비가 되기 전에는 기존 Apple-only 계정이 재진입할 수 없습니다." >&2
    echo "   서버 dual-audience 배포와 검증을 마친 뒤 EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1 로 실행하세요." >&2
    exit 1
  fi
else
  # dev 빌드는 서버 주소를 여기서 고정한다 — 운영 주소를 실수로 넘겨도 dev lane 이 다시 덮어쓴다
  export EXPO_PUBLIC_API_URL="https://oneorthree.dev.mooo.com"
  export GROMO_IOS_AUDIENCE="dev"
fi
export EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1

# 공개 릴리스 설정(약관 버전·Datadog RUM) — 2.0 전용 파일. 환경변수로 먼저 들어온 값은 그대로 둔다.
# shellcheck disable=SC1091
source ./release-config.sh
# dev 빌드는 RUM 에서도 dev 환경으로 구분한다
export EXPO_PUBLIC_ENV="$AUDIENCE"

# 약관 문서 버전과 Apple-only 계정 재진입 준비가 모두 확인되어야 한다.
# set -u 에서 미설정 변수를 바로 확장하면 안내 문구 대신 unbound variable 로 죽으므로 기본값을 둔다.
TERMS_VERSION_RAW="${EXPO_PUBLIC_TERMS_VERSION:-}"
if [[ -z "${TERMS_VERSION_RAW//[[:space:]]/}" ]]; then
  echo "❌ iOS release/TestFlight 차단: 실제 약관 문서 버전 EXPO_PUBLIC_TERMS_VERSION을 설정하세요." >&2
  exit 1
fi
# 서버는 앞뒤 공백이 있는 약관 버전을 400으로 거절한다. 값 그대로가 정본이어야 한다.
if [[ "$TERMS_VERSION_RAW" =~ ^[[:space:]] || "$TERMS_VERSION_RAW" =~ [[:space:]]$ ]]; then
  echo "❌ iOS release/TestFlight 차단: EXPO_PUBLIC_TERMS_VERSION 앞뒤에 공백이 있습니다. 공백 없이 실제 약관 문서 버전만 설정하세요." >&2
  exit 1
fi
# App Store Connect API 키(비밀값): 이미 환경변수로 들어와 있으면(CI 러너의 .env) 그대로 쓰고,
# 없을 때만 fastlane/.env 를 읽는다. 양식은 fastlane/.env.example.
if [[ -z "${ASC_KEY_ID:-}" || -z "${ASC_ISSUER_ID:-}" || -z "${ASC_KEY_PATH:-}" ]]; then
  if [[ ! -f "fastlane/.env" ]]; then
    echo "❌ App Store Connect 인증 설정이 없어요. fastlane/.env.example 을 fastlane/.env 로 복사해 채우거나," >&2
    echo "   ASC_KEY_ID · ASC_ISSUER_ID · ASC_KEY_PATH 를 환경변수로 주세요." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source "fastlane/.env"
  set +a
fi

for required in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH EXPO_PUBLIC_DATADOG_APPLICATION_ID EXPO_PUBLIC_DATADOG_CLIENT_TOKEN; do
  if [[ -z "${!required:-}" ]]; then
    echo "❌ $required 값이 비어 있어요." >&2
    exit 1
  fi
done
if [[ ! -f "$ASC_KEY_PATH" ]]; then
  echo "❌ App Store Connect API 키 파일을 찾지 못했어요." >&2
  exit 1
fi

if diff -q Podfile.lock Pods/Manifest.lock >/dev/null 2>&1; then
  echo "✅ Pods 동기화됨 — pod install 건너뜀"
else
  echo "📦 Pods 변경 감지 → pod install 실행"
  pod install
fi

if [[ -x /opt/homebrew/opt/ruby/bin/bundle ]]; then
  export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
  BUNDLE_BIN=/opt/homebrew/opt/ruby/bin/bundle
else
  BUNDLE_BIN="$(command -v bundle)"
fi

if ! "$BUNDLE_BIN" check >/dev/null 2>&1; then
  echo "💎 Fastlane 설치 중..."
  "$BUNDLE_BIN" install
fi

if [[ "$AUDIENCE" == "dev" ]]; then
  echo "🚀 Fishcat → TestFlight 업로드 (dev 서버)..."
  "$BUNDLE_BIN" exec fastlane beta_dev
else
  echo "🚀 Fishcat → TestFlight 업로드..."
  "$BUNDLE_BIN" exec fastlane beta
fi
