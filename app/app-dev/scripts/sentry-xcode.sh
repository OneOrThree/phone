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

# TestFlight 는 빌드 단계의 선택적 업로드와 별도로, 완성된 아카이브의 심볼을 검증한다.
require_release_upload() {
  if [[ "${SENTRY_DISABLE_AUTO_UPLOAD:-}" == "true" || "${SENTRY_DISABLE_XCODE_DEBUG_UPLOAD:-}" == "true" ]]; then
    echo "error: TestFlight 배포에서는 Sentry 심볼 업로드를 끌 수 없습니다." >&2
    exit 1
  fi
  if [[ -z "${SENTRY_AUTH_TOKEN:-}" && ! -f "$SENTRY_DOTENV_PATH" ]]; then
    echo "error: TestFlight 배포에 필요한 Sentry 토큰이 없습니다. SENTRY_AUTH_TOKEN 또는 SENTRY_DOTENV_PATH 를 설정하세요." >&2
    exit 1
  fi
  # dotenv 의 SENTRY_ALLOW_FAILURE=true 도 실패를 성공으로 바꾸지 못하게 한다.
  export SENTRY_ALLOW_FAILURE=false
  sentry_cli="${SENTRY_CLI_EXECUTABLE:-$APP_ROOT/node_modules/.bin/sentry-cli}"
}

binary_uuids() {
  xcrun dwarfdump --uuid "$1" | awk '/^UUID: / {print toupper($2)}' | sort -u
}

case "${1:-}" in
  check-release)
    require_release_upload
    "$sentry_cli" info --config-status-json | "${NODE_BINARY:-node}" -e '
      let data = "";
      process.stdin.on("data", chunk => data += chunk);
      process.stdin.on("end", () => {
        if (JSON.parse(data).auth?.successful !== true) {
          console.error("error: TestFlight 배포용 Sentry 인증에 실패했습니다.");
          process.exitCode = 1;
        }
      });'
    exit 0
    ;;
  archive)
    require_release_upload
    archive="${2:?사용법: sentry-xcode.sh archive <xcarchive>}"
    app_relative="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:ApplicationPath' "$archive/Info.plist")"
    app="$archive/Products/$app_relative"
    executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Info.plist")"
    main_dsym="$archive/dSYMs/$(basename "$app").dSYM"
    app_uuids="$(binary_uuids "$app/$executable")"
    dsym_uuids="$(binary_uuids "$main_dsym/Contents/Resources/DWARF/$executable")"
    if [[ -z "$app_uuids" || "$app_uuids" != "$dsym_uuids" ]]; then
      echo "error: TestFlight 아카이브 실행 파일과 dSYM UUID 가 다릅니다: $archive" >&2
      exit 1
    fi
    ids=()
    while IFS= read -r uuid; do ids+=(--id "$uuid"); done <<< "$app_uuids"
    # 메인 앱 심볼이 실제 포함됐는지, Sentry 서버에서 처리까지 성공했는지 확인한다.
    # SDK 래퍼는 실패를 로그에만 남길 수 있어 CLI 종료 코드를 직접 사용한다.
    "$sentry_cli" debug-files upload --org oneorthree --project cattus --wait --require-all "${ids[@]}" "$main_dsym"
    # 확장·프레임워크 심볼도 완성된 아카이브에서 함께 보관한다(이미 올라간 파일은 중복 업로드하지 않는다).
    "$sentry_cli" debug-files upload --org oneorthree --project cattus --wait "$archive/dSYMs"
    exit 0
    ;;
esac

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
  *) echo "사용법: sentry-xcode.sh bundle <RN 스크립트> | symbols | check-release | archive <xcarchive>" >&2; exit 2 ;;
esac
