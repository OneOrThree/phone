#!/usr/bin/env bash
# Fishcat iOS → TestFlight 테스트 빌드 업로드
set -euo pipefail

cd "$(dirname "$0")"

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

for required in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do
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

if ! /opt/homebrew/bin/bundle check >/dev/null 2>&1; then
  echo "💎 Fastlane 설치 중..."
  /opt/homebrew/bin/bundle install
fi

echo "🚀 Fishcat → TestFlight 업로드..."
/opt/homebrew/bin/bundle exec fastlane beta
