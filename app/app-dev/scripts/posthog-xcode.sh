#!/bin/bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
posthog_default_env="$APP_ROOT/.env.posthog"
if [[ ! -f "$posthog_default_env" ]]; then
  posthog_default_env="$HOME/.config/posthog/catus.env"
fi
export POSTHOG_CLI_DOTENV_FILE="${POSTHOG_CLI_DOTENV_FILE:-$posthog_default_env}"
export PATH="$APP_ROOT/node_modules/.bin:$PATH"
export POSTHOG_SKIP_ON_CONFLICT=1

# 토큰은 CLI가 직접 읽는다. 셸 source/set -x로 비밀값을 빌드 로그에 남기지 않는다.
upload_enabled=1
if [[ "${CONFIGURATION:-Debug}" == *Debug* || "${EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN-unset}" == "" ]]; then
  upload_enabled=0
elif [[ -z "${POSTHOG_CLI_API_KEY:-}" && ! -f "$POSTHOG_CLI_DOTENV_FILE" ]]; then
  echo "warning: PostHog 업로드 인증이 없어 소스맵·심볼 업로드를 건너뜁니다. .env.posthog 또는 POSTHOG_CLI_API_KEY를 설정하세요."
  upload_enabled=0
fi

case "${1:-}" in
  bundle)
    shift
    if [[ "$upload_enabled" == 1 ]]; then
      exec "$APP_ROOT/node_modules/posthog-react-native/tooling/posthog-xcode.sh" "$@"
    fi
    exec "$@"
    ;;
  symbols)
    if [[ "$upload_enabled" == 1 ]]; then
      exec "${PODS_ROOT:?}/PostHog/build-tools/upload-symbols.sh"
    fi
    ;;
  *) echo "사용법: posthog-xcode.sh bundle <RN 스크립트> | symbols" >&2; exit 2 ;;
esac
