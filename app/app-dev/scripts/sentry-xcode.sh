#!/bin/bash
# GROMO-2739 — iOS Release 빌드가 Sentry(cattus)에 JS 소스맵·dSYM 을 올린다.
#   bundle <RN 스크립트…>  「Bundle React Native code and images」 단계에서 RN 번들 스크립트를 감싼다(소스맵)
#   symbols                「Upload Debug Symbols to Sentry」 단계에서 dSYM 을 올린다
# 체크인된 네이티브 프로젝트라 app.config.js 의 Sentry config plugin 은 Xcode 단계를 넣지 않는다 — 이 스크립트가 정본이다.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SENTRY_RN="$APP_ROOT/node_modules/@sentry/react-native/scripts"

# 조직·프로젝트는 Android 업로드(android/app/build.gradle)와 같은 파일을 읽는다.
export SENTRY_PROPERTIES="$APP_ROOT/sentry.cattus.properties"
# 로컬 빌드는 토큰을 dotenv 로 받는다(PostHog 의 ~/.config/posthog/catus.env 와 같은 방식). sentry-cli 가 직접 읽으므로
# 셸 source/set -x 로 비밀값이 빌드 로그에 남지 않는다.
sentry_default_env="$APP_ROOT/.env.sentry-build-plugin"
if [[ ! -f "$sentry_default_env" ]]; then
  sentry_default_env="$HOME/.config/sentry/cattus.env"
fi
export SENTRY_DOTENV_PATH="${SENTRY_DOTENV_PATH:-$sentry_default_env}"

# 토큰이 없는 팀원/PR 빌드는 그대로 두고, 토큰이 있는 빌드는 업로드 실패를 숨기지 않는다.
upload_enabled=1
if [[ "${CONFIGURATION:-Debug}" == *Debug* || "${SENTRY_DISABLE_AUTO_UPLOAD:-}" == "true" ]]; then
  upload_enabled=0
elif [[ -z "${SENTRY_AUTH_TOKEN:-}" && ! -f "$SENTRY_DOTENV_PATH" ]]; then
  echo "warning: Sentry 업로드 토큰이 없어 소스맵·dSYM 업로드를 건너뜁니다. SENTRY_AUTH_TOKEN 또는 ~/.config/sentry/cattus.env 를 설정하세요."
  upload_enabled=0
fi

case "${1:-}" in
  bundle)
    shift
    if [[ "$upload_enabled" == 1 ]]; then
      exec /bin/sh "$SENTRY_RN/sentry-xcode.sh" "$@"
    fi
    exec "$@"
    ;;
  symbols)
    if [[ "$upload_enabled" == 1 ]]; then
      # Xcode 가 dsymutil 이 끝나기 전에 이 단계를 시작할 수 있다. dSYM 을 입력으로 걸면 확장 타깃 때문에 의존 순환이 생겨
      # (PostHog upload-symbols.sh 와 같은 이유) 앱 dSYM 이 이번 실행 파일과 같은 UUID 가 될 때까지 최대 60초 기다린다.
      main_dwarf="${DWARF_DSYM_FOLDER_PATH:-}/${DWARF_DSYM_FILE_NAME:-}/Contents/Resources/DWARF/${EXECUTABLE_NAME:-}"
      app_binary="${TARGET_BUILD_DIR:-}/${EXECUTABLE_PATH:-}"
      for _ in $(seq 1 60); do
        dsym_uuids="$(xcrun dwarfdump --uuid "$main_dwarf" 2>/dev/null | awk '/^UUID: / {print $2}' | sort || true)"
        app_uuids="$(xcrun dwarfdump --uuid "$app_binary" 2>/dev/null | awk '/^UUID: / {print $2}' | sort || true)"
        [[ -n "$dsym_uuids" && "$dsym_uuids" == "$app_uuids" ]] && break
        sleep 1
      done
      if [[ -z "$dsym_uuids" || "$dsym_uuids" != "$app_uuids" ]]; then
        echo "error: Sentry — 60초 안에 이번 빌드의 dSYM 이 준비되지 않았습니다: $main_dwarf"
        exit 1
      fi
      # Sentry 스크립트는 업로드 실패를 error: 줄로만 알리고 0 으로 끝난다. 실패를 숨기지 않게 출력에서 error: 를 보고 막는다.
      output="$(/bin/sh "$SENTRY_RN/sentry-xcode-debug-files.sh" 2>&1)" || { echo "$output"; exit 1; }
      echo "$output"
      if grep -q '^error: sentry-cli' <<< "$output"; then
        exit 1
      fi
    fi
    ;;
  *) echo "사용법: sentry-xcode.sh bundle <RN 스크립트> | symbols" >&2; exit 2 ;;
esac
