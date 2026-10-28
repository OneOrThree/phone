#!/usr/bin/env bash
# 공통 공개 HTTP 요청. 응답/자격은 권한 0700 임시 디렉터리에만 저장한다.
smoke_init() {
  umask 077
  SMOKE_TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/phone-smoke.XXXXXX")
  SMOKE_BODY_FILE="$SMOKE_TMP_DIR/body.json"
  SMOKE_HEADER_FILE="$SMOKE_TMP_DIR/headers"
  SMOKE_GUEST_STATE_DIR=${SMOKE_GUEST_STATE_DIR:-$SMOKE_TMP_DIR/guest-state}
  export SMOKE_GUEST_STATE_DIR
  RESULTS_FILE=${RESULTS_FILE:-results.tsv}
  export RESULTS_FILE
  mkdir -p "$(dirname "$RESULTS_FILE")"
  if [[ ! -s "$RESULTS_FILE" ]]; then printf 'id\tstatus\thttp_code\tms\treason\n' > "$RESULTS_FILE"; fi
}
smoke_uuid() { node -e 'process.stdout.write(require("node:crypto").randomUUID())'; }
smoke_json() { jq -er "$1" "$SMOKE_BODY_FILE"; }
smoke_record() {
  local reason=${5//$'\t'/ }
  reason=${reason//$'\n'/ }
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$reason" >> "$RESULTS_FILE"
  printf '%s %s %s\n' "$1" "$2" "$reason"
}
smoke_request() {
  local method=$1 path=$2 body=${3:-} token=${4:-${SMOKE_TOKEN:-}} device=${5:-}
  local cfg="$SMOKE_TMP_DIR/curl.cfg" output
  if [[ "$method" == POST && "$path" == /auth/sessions/guest && -n "${SMOKE_GUEST_LAST_REQUEST_FILE:-}" ]]; then
    # 성공·거절 모두 서버 카운터에 포함되므로 요청 직전에 기록한다. 자식 실행기도 공유한다.
    local marker
    marker=$(mktemp "${SMOKE_GUEST_LAST_REQUEST_FILE}.XXXXXX") || return 1
    date +%s > "$marker" && mv "$marker" "$SMOKE_GUEST_LAST_REQUEST_FILE" || { rm -f "$marker"; return 1; }
  fi
  # 비밀은 argv / stdout / curl 진단으로 노출하지 않는다.
  printf 'silent\nshow-error\n' > "$cfg"
  if [[ -n "$token" ]]; then printf 'header = "Authorization: Bearer %s"\n' "$token" >> "$cfg"; fi
  if [[ -n "$device" ]]; then printf 'header = "X-Device-Id: %s"\n' "$device" >> "$cfg"; fi
  local args=(-q --config "$cfg" --request "$method" --max-time "${SMOKE_HTTP_TIMEOUT:-10}" --connect-timeout "${SMOKE_CONNECT_TIMEOUT:-2}" --dump-header "$SMOKE_HEADER_FILE" --output "$SMOKE_BODY_FILE" --write-out '%{http_code} %{time_total}')
  if [[ "$method" != GET && "$method" != HEAD ]]; then args+=(-H "Idempotency-Key: $(smoke_uuid)"); fi
  if [[ -n "$body" ]]; then
    printf '%s' "$body" > "$SMOKE_TMP_DIR/request.json"
    args+=(-H 'Content-Type: application/json' --data-binary "@$SMOKE_TMP_DIR/request.json")
  fi
  : > "$SMOKE_BODY_FILE"; : > "$SMOKE_HEADER_FILE"
  output=$(curl "${args[@]}" "${BASE_URL%/}$path" 2> "$SMOKE_TMP_DIR/curl-error")
  local rc=$?
  SMOKE_HTTP_CODE=${output%% *}; SMOKE_HTTP_CODE=${SMOKE_HTTP_CODE:-000}
  SMOKE_HTTP_MS=$(awk -v s="${output#* }" 'BEGIN{printf "%.0f", s*1000}')
  return "$rc"
}
smoke_ok() { [[ "$SMOKE_HTTP_CODE" =~ ^2[0-9][0-9]$ ]] && jq -e 'has("data") and (.error? == null)' "$SMOKE_BODY_FILE" >/dev/null 2>&1; }
smoke_guest_login() {
  local device=$1 role=$2 script_dir rc=0
  script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  SMOKE_HTTP_CODE=000; SMOKE_HTTP_MS=0; SMOKE_AUTH_SUMMARY='attempts=0 retries=0'
  rm -f "$SMOKE_TMP_DIR/auth-result.json"
  : > "$SMOKE_BODY_FILE"; : > "$SMOKE_HEADER_FILE"
  SMOKE_GUEST_DEVICE_ID="$device" python3 "$script_dir/guest_login.py" \
    --directory "$SMOKE_TMP_DIR" --role "$role" || rc=$?
  if [[ -f "$SMOKE_TMP_DIR/auth-result.json" ]]; then
    SMOKE_HTTP_CODE=$(jq -r '.http_code' "$SMOKE_TMP_DIR/auth-result.json")
    SMOKE_HTTP_MS=$(jq -r '.elapsed_ms' "$SMOKE_TMP_DIR/auth-result.json")
    SMOKE_AUTH_SUMMARY=$(jq -r '"attempts=\(.attempts) retries=\(.retries) elapsed_ms=\(.elapsed_ms) first_error=\(.first_error) result=\(.result)"' "$SMOKE_TMP_DIR/auth-result.json")
  fi
  if [[ "$rc" != 0 ]]; then
    # 실패 응답 원문을 다른 TC의 일반 오류 출력으로 다시 노출하지 않는다.
    : > "$SMOKE_BODY_FILE"; : > "$SMOKE_HEADER_FILE"
  fi
  printf '게스트 로그인 %s %s\n' "$role" "$SMOKE_AUTH_SUMMARY"
  return "$rc"
}
smoke_finish() {
  local token=${1:-${SMOKE_TOKEN:-}} expected=${2:-}
  smoke_request GET /focus-sessions/current '' "$token" && smoke_ok || return 1
  if jq -e '.data == null' "$SMOKE_BODY_FILE" >/dev/null; then return 0; fi
  local id version
  id=$(smoke_json '.data.id'); version=$(smoke_json '.data.version') || return 1
  [[ -z "$expected" || "$id" == "$expected" ]] || return 1
  smoke_request POST "/focus-sessions/$id/finish" "{\"expectedVersion\":$version}" "$token" && smoke_ok || return 1
  smoke_request GET /focus-sessions/current '' "$token" && smoke_ok && jq -e '.data == null' "$SMOKE_BODY_FILE" >/dev/null
}
