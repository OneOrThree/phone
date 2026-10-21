#!/usr/bin/env bash
# 운영 앱(iOS·안드로이드)에 OTA(EAS Update) 발행 — 스토어 심사 없이 JS·src/assets/ota 수정을 내려보낸다.
#   ./scripts/ota-update.sh "수정 내용 한 줄"
# 앱은 켤 때 받아 두고 다음 실행부터 적용한다. dev 빌드(TestFlight·Play 내부 테스트)는 OTA 가 꺼져 있어 받지 않는다.
# 네이티브(라이브러리·Pods·Gradle·Info.plist·권한)를 바꿨으면 OTA 로 못 보낸다 — 스토어 빌드 + runtimeVersion 올리기.
# Expo 로그인: `npx eas-cli login`(oneorthree 조직 권한) 또는 EXPO_TOKEN 환경변수.
set -euo pipefail

cd "$(dirname "$0")/.."

EAS=(npx --yes eas-cli@24.12.1)

MESSAGE="${1:-}"
if [[ $# -ne 1 || -z "${MESSAGE//[[:space:]]/}" ]]; then
  echo "❌ 사용법: ./scripts/ota-update.sh \"수정 내용 한 줄\"" >&2
  exit 1
fi

# 커밋 안 된 수정은 리뷰·테스트를 거치지 않은 코드라 운영으로 내보내지 않는다
if [[ -n "$(git status --porcelain --untracked-files=no -- .)" ]]; then
  echo "❌ app/app-dev 에 커밋 안 된 변경이 있어요. 커밋하거나 되돌린 뒤 다시 실행하세요." >&2
  exit 1
fi

if ! "${EAS[@]}" whoami >/dev/null 2>&1; then
  echo "❌ Expo 로그인이 필요해요. npx eas-cli login 으로 로그인하거나 EXPO_TOKEN 을 설정하세요." >&2
  exit 1
fi

# 번들에 박히는 값은 운영값만 — 셸·.env 에 남은 dev 주소·미리보기 플래그가 운영 사용자 앱에 섞이지 않게 비우고 다시 넣는다.
# 값을 비우지 않으면 client.ts 가 기본값인 dev 서버 주소를 쓴다.
while IFS= read -r name; do unset "$name"; done < <(compgen -e | grep '^EXPO_PUBLIC_' || true)
export EXPO_NO_DOTENV=1
export EXPO_PUBLIC_API_URL="https://catus-api.oneorthree.world"
export EXPO_PUBLIC_APPLE_LOGIN_ENABLED=1
export EXPO_PUBLIC_ENV=prod
# 약관 버전·Datadog RUM 공개 설정 — 스토어 빌드(iOS testflight.sh·안드로이드 CI)와 같은 정본
# shellcheck disable=SC1091
source ios/release-config.sh

RUNTIME="$(node -p "require('./app.config.js').expo.runtimeVersion")"
COMMIT="$(git rev-parse --short HEAD)"
echo "채널 production · 런타임 ${RUNTIME} · $(git rev-parse --abbrev-ref HEAD)@${COMMIT} · iOS·안드로이드"
echo "런타임 ${RUNTIME} 운영 앱이 다음 실행부터 이 코드로 바뀝니다."
read -r -p "발행할까요? (y/N) " answer
if [[ "$answer" != "y" ]]; then
  echo "취소했어요."
  exit 1
fi

"${EAS[@]}" update \
  --channel production \
  --environment production \
  --platform all \
  --message "${MESSAGE} (${COMMIT})" \
  --non-interactive
