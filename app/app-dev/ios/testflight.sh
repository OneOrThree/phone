#!/usr/bin/env bash
# Fishcat iOS → TestFlight 테스트 빌드 업로드
set -euo pipefail

cd "$(dirname "$0")"

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
if [[ "${EXPO_PUBLIC_API_URL:-}" != "https://api.oneorthree.world" ]]; then
  echo "❌ iOS release/TestFlight 차단: EXPO_PUBLIC_API_URL을 운영 주소 https://api.oneorthree.world 로 설정하세요." >&2
  exit 1
fi
if [[ "${EXPO_PUBLIC_APPLE_LOGIN_ENABLED:-}" != "1" ]]; then
  echo "❌ iOS release/TestFlight 차단: 서버가 Apple의 gromo·focuscat 이중 audience를 검증할 준비가 되기 전에는 기존 Apple-only 계정이 재진입할 수 없습니다." >&2
  echo "   서버 dual-audience 배포와 검증을 마친 뒤 EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1 로 실행하세요." >&2
  exit 1
fi
export EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1

# Fishcat 전용 값을 우선하고, 아직 분리하지 않았다면 기존 Gromo 로컬 API 키 설정을 재사용한다.
if [[ -f "fastlane/.env" ]]; then
  CREDENTIALS_ENV="fastlane/.env"
else
  CREDENTIALS_ENV="../../legacy/app-dev/ios/fastlane/.env"
fi
if [[ ! -f "$CREDENTIALS_ENV" ]]; then
  echo "❌ App Store Connect 인증 설정을 찾지 못했어요: $CREDENTIALS_ENV" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$CREDENTIALS_ENV"
set +a
export EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1

# Datadog RUM 공개 설정은 기존 앱과 같은 RUM application을 사용한다. 값의 정본을 아직
# 별도 파일로 분리하지 않았으므로, 저장소에 이미 추적 중인 legacy 릴리즈 설정에서 허용한
# 두 export만 읽는다. 임의의 shell 코드는 실행하지 않는다.
DATADOG_ENV_SOURCE="../../legacy/app-dev/ios/testflight.sh"
while IFS= read -r line; do
  case "$line" in
    'export EXPO_PUBLIC_DATADOG_APPLICATION_ID='*)
      value="${line#*=}"
      value="${value#\"}"
      export EXPO_PUBLIC_DATADOG_APPLICATION_ID="${value%\"}"
      ;;
    'export EXPO_PUBLIC_DATADOG_CLIENT_TOKEN='*)
      value="${line#*=}"
      value="${value#\"}"
      export EXPO_PUBLIC_DATADOG_CLIENT_TOKEN="${value%\"}"
      ;;
  esac
done < "$DATADOG_ENV_SOURCE"
export EXPO_PUBLIC_ENV="prod"

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

echo "🚀 Fishcat → TestFlight 업로드..."
"$BUNDLE_BIN" exec fastlane beta
