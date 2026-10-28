#!/usr/bin/env bash
# TC015 독립 초기 조건: 새로운 게스트·단독 섬·완공 도서관. 구매/집중 보상 준비와 분리한다.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$SCRIPT_DIR/lib.sh"
: "${BASE_URL:?BASE_URL이 필요합니다}"
: "${SMOKE_CORE_CONTEXT_FILE:?비공개 context 파일 경로가 필요합니다}"
smoke_init
SMOKE_TOKEN=''
trap 'rm -rf "$SMOKE_TMP_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
SMOKE_CORE_DEVICE_ID=$(smoke_uuid)
export SMOKE_CORE_DEVICE_ID
export SMOKE_CORE_FIXTURE_NAME="smoke-core-$SMOKE_CORE_DEVICE_ID"
smoke_guest_login "$SMOKE_CORE_DEVICE_ID" statistics || { echo "통계 전용 게스트 생성 실패 ($SMOKE_AUTH_SUMMARY)" >&2; exit 1; }
token=$(smoke_json '.data.accessToken')
SMOKE_CORE_USER_ID=$(smoke_json '.data.userId')
export SMOKE_CORE_USER_ID
SMOKE_CORE_SESSION_ID=$(printf '%s' "$token" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(Buffer.from(s.split(".")[1],"base64url")).sid)}catch{process.exit(1)}})')
export SMOKE_CORE_SESSION_ID
smoke_request POST /islands "{\"name\":\"$SMOKE_CORE_FIXTURE_NAME\",\"approvalRequired\":false}" "$token" && smoke_ok || { echo '통계 전용 섬 생성 실패' >&2; exit 1; }
SMOKE_CORE_ISLAND_ID=$(smoke_json '.data.id')
export SMOKE_CORE_ISLAND_ID
SMOKE_FIXTURE_MODE=statistics "$SCRIPT_DIR/seed-core-flow.sh" > "$SMOKE_TMP_DIR/policy.json" 2> "$SMOKE_TMP_DIR/seed-error" || {
  echo '통계 전용 DB 초기 준비 실패' >&2
  sed -n 's/.*ERROR:  /DB: /p' "$SMOKE_TMP_DIR/seed-error" | head -1 >&2
  exit 1
}
printf '%s' "$token" > "$SMOKE_TMP_DIR/token"
jq -n --rawfile accessToken "$SMOKE_TMP_DIR/token" --arg userId "$SMOKE_CORE_USER_ID" --arg islandId "$SMOKE_CORE_ISLAND_ID" --arg deviceId "$SMOKE_CORE_DEVICE_ID" \
  '{accessToken:$accessToken,userId:$userId,islandId:$islandId,deviceId:$deviceId}' > "$SMOKE_CORE_CONTEXT_FILE"
chmod 600 "$SMOKE_CORE_CONTEXT_FILE"
