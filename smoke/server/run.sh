#!/usr/bin/env bash
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/lib.sh"
: "${BASE_URL:?BASE_URL is required}"
# BASE_URL만 주면 공개 기본 검사. 내부 DB 설정이 있으면 전체 API 흐름을 실행한다.
if [[ -z "${SMOKE_BASIC_ONLY+x}" ]]; then
  if [[ -n "${SMOKE_DB_CONTAINER:-}${SMOKE_DATABASE_URL:-}" || "${SMOKE_CORE_ENABLED:-0}" == 1 ]]; then
    export SMOKE_BASIC_ONLY=0
    export SMOKE_CORE_ENABLED=${SMOKE_CORE_ENABLED:-1}
  else
    export SMOKE_BASIC_ONLY=1
  fi
fi
for tool in curl jq node awk; do command -v "$tool" >/dev/null || { printf 'Missing %s\n' "$tool" >&2; exit 2; }; done
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)' || { echo 'Node >=22 required' >&2; exit 2; }
RESULTS_FILE=${RESULTS_FILE:-results.tsv}
mkdir -p "$(dirname "$RESULTS_FILE")"
if [[ "${SMOKE_APPEND_RESULTS:-0}" != 1 ]]; then : > "$RESULTS_FILE"; fi
smoke_init
TOKEN='' USER_ID='' ISLAND_ID='' SESSION_ID='' PEER_TOKEN='' PEER_ID='' PEER_JOINED=0 FRIEND_CREATED=0 FRIEND_REQUEST_ID='' WS_PID=''
record() {
  local detail=''
  if [[ "$2" == FAIL && -f "$SMOKE_BODY_FILE" ]]; then
    detail=$(jq -r '(.error.code // .code // "") | select(type=="string" and test("^[A-Z][A-Z0-9_]{0,79}$"))' "$SMOKE_BODY_FILE" 2>/dev/null || true)
  fi
  smoke_record "SMOKE-SERVER-$1" "$2" "${SMOKE_HTTP_CODE:-000}" "${SMOKE_HTTP_MS:-0}" "$3${detail:+ [$detail]}"; }
req() { smoke_request "$@" && smoke_ok; }
cleanup() {
  [[ -z "$WS_PID" ]] || kill "$WS_PID" 2>/dev/null || true
  if [[ -n "$TOKEN" && -n "$SESSION_ID" ]]; then smoke_finish "$TOKEN" "$SESSION_ID" || record 006 FAIL '집중 종료 정리 실패'; fi
  if [[ -n "$PEER_TOKEN" ]]; then
    if [[ "$FRIEND_CREATED" != 1 && -n "$FRIEND_REQUEST_ID" ]]; then req POST "/friends/requests/$FRIEND_REQUEST_ID/cancel" '' "$TOKEN" || record 016 FAIL '친구 요청 정리 실패'; fi
    if [[ "$FRIEND_CREATED" == 1 ]]; then req DELETE "/friends/$PEER_ID" '' "$TOKEN" || record 016 FAIL '친구 정리 실패'; fi
    if [[ "$PEER_JOINED" == 1 ]]; then req DELETE "/islands/$ISLAND_ID/memberships/me" '' "$PEER_TOKEN" || record 016 FAIL '주민 정리 실패'; fi
  fi
  rm -rf "$SMOKE_TMP_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
main() {
  local device=${SMOKE_DEVICE_ID:-$(smoke_uuid)} today body version bootstrap
  today=$(TZ=Asia/Seoul date +%F)
  if ! smoke_request GET /health '' '' || [[ "$SMOKE_HTTP_CODE" != 200 || "$SMOKE_HTTP_MS" -gt "${SMOKE_HEALTH_TIMEOUT_MS:-2000}" ]]; then
    record 001 FAIL 'health HTTP/시간 제한'; for id in 002 003 004 005 006 007 009 010; do record "$id" SKIP '공개 API 선행 실패'; done; return
  fi
  record 001 PASS '공개 health'
  if ! req POST /auth/sessions/guest '' '' "$device" || [[ "$SMOKE_HTTP_CODE" != 201 ]] || ! jq -e '.data | (.accessToken|type)=="string" and (.refreshToken|type)=="string" and (.userId|test("^[0-9a-fA-F-]{36}$")) and (.onboardingComplete|type)=="boolean"' "$SMOKE_BODY_FILE" >/dev/null; then
    record 002 FAIL '게스트 발급 계약 실패'; for id in 003 004 005 006 007 009 010; do record "$id" SKIP '인증 선행 실패'; done; return
  fi
  TOKEN=$(smoke_json '.data.accessToken'); USER_ID=$(smoke_json '.data.userId')
  bootstrap=$(awk 'tolower($1)=="x-device-bootstrap:" {gsub("\r", "", $2); print $2}' "$SMOKE_HEADER_FILE")
  record 002 PASS '게스트 세션 발급 (고정 기기 UUID는 복구 창 내에서만 재사용)'
  if req GET /me '' "$TOKEN" && jq -e --arg id "$USER_ID" '.data.id==$id' "$SMOKE_BODY_FILE" >/dev/null; then record 003 PASS '계정 동일'
  else
    record 003 FAIL '계정 조회/동일성'
    for id in 004 005 006 007 009 010; do record "$id" SKIP '계정 선행 실패'; done
    return
  fi
  if req GET /me/islands '' "$TOKEN"; then
    ISLAND_ID=$(jq -r '.data.currentIslandId // .data.items[0].id // empty' "$SMOKE_BODY_FILE")
    if [[ -z "$ISLAND_ID" ]]; then
      req POST /islands '{"name":"smoke-island","approvalRequired":false}' "$TOKEN" && req GET /me/islands '' "$TOKEN" && ISLAND_ID=$(jq -r '.data.currentIslandId // .data.items[0].id // empty' "$SMOKE_BODY_FILE")
    fi
  fi
  if [[ -z "$ISLAND_ID" ]]; then record 004 FAIL '섬 생성/조회'; for id in 005 006 007 010; do record "$id" SKIP '섬 선행 실패'; done
  else
    record 004 PASS '섬 확보'
    if req GET "/screens/home?date=$today&timezone=Asia/Seoul" '' "$TOKEN" && jq -e '.data | (.buildings|type)=="array" and (.members.items|type)=="array" and (.wallets|has("fish") and has("villagePoints")) and ((.missingFragments // [])|length)==0' "$SMOKE_BODY_FILE" >/dev/null; then record 005 PASS '홈 조각 완전'; else record 005 FAIL '홈 계약/필수 조각'; fi
    focus_and_event
    if [[ "${SMOKE_BASIC_ONLY:-0}" != 1 ]]; then residents_and_friends "$today"; fi
  fi
  if [[ -z "$bootstrap" ]]; then record 009 FAIL '로그인 X-Device-Bootstrap 없음'
  else
    printf '%s' "$bootstrap" > "$SMOKE_TMP_DIR/bootstrap-secret"
    body=$(jq -nc --arg t "smoke-$USER_ID" --rawfile b "$SMOKE_TMP_DIR/bootstrap-secret" '{deviceToken:$t,deviceBootstrap:$b}')
    if smoke_request PUT /api/v1/users/me/device-token "$body" "$TOKEN" && [[ "$SMOKE_HTTP_CODE" == 200 ]] && jq -e '.ownershipToken | type=="string" and test("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")' "$SMOKE_BODY_FILE" >/dev/null; then record 009 PASS '가짜 기기 토큰 등록·소유권 UUID'; else record 009 FAIL '기기 등록/소유권 UUID 계약 실패'; fi
  fi
  if [[ "${SMOKE_BASIC_ONLY:-0}" != 1 ]]; then
    if [[ "${SMOKE_CORE_ENABLED:-0}" == 1 ]]; then
      export SMOKE_CORE_CONTEXT_FILE="$SMOKE_TMP_DIR/core-context.json"
      "$HERE/core-flow.sh" || true
    fi
    screen_time
  fi
}
focus_and_event() {
  local connected=0 events="$SMOKE_TMP_DIR/ws.jsonl" control="$SMOKE_TMP_DIR/ws.fifo" wsurl
  if ! smoke_finish "$TOKEN"; then record 006 FAIL '기존 집중 정리 실패'; record 007 SKIP '집중 초기 조건 실패'; record 010 SKIP '집중 초기 조건 실패'; return; fi
  # native WebSocket은 Origin을 보내지 않는다. 앱과 같은 Origin으로 Upgrade도 별도 확인한다.
  local origin handshake key
  origin=$(node -e 'process.stdout.write(new URL(process.argv[1]).origin)' "$BASE_URL")
  key=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("base64"))')
  handshake=$(curl -q --silent --max-time 2 --output /dev/null --write-out '%{http_code}' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H "Origin: $origin" \
    -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $key" \
    "${BASE_URL%/}/ws/realtime" 2> "$SMOKE_TMP_DIR/handshake-error") || true
  if [[ "$handshake" != 101 ]]; then
    record 007 FAIL '앱 Origin WebSocket Upgrade 실패'
    record 006 SKIP '웹소켓 선행 실패'; record 010 SKIP '웹소켓 선행 실패'; return
  fi
  mkfifo "$control"
  node "$HERE/stomp-connect.mjs" < "$control" > "$events" 2> "$SMOKE_TMP_DIR/ws-error" & WS_PID=$!
  exec 3> "$control"
  wsurl=${SMOKE_WS_URL:-$(node -e 'const u=new URL(process.argv[1]);u.protocol=u.protocol==="https:"?"wss:":"ws:";u.pathname="/ws/realtime";u.search="";console.log(u.href)' "$BASE_URL")}
  printf '%s' "$TOKEN" > "$SMOKE_TMP_DIR/ws-token"
  jq -nc --rawfile token "$SMOKE_TMP_DIR/ws-token" --arg url "$wsurl" --arg user "$USER_ID" --arg island "$ISLAND_ID" --argjson timeout "${SMOKE_WS_CONNECT_TIMEOUT_MS:-5000}" --argjson settle "${SMOKE_SUBSCRIBE_SETTLE_MS:-500}" '{kind:"connect",token:$token,url:$url,userId:$user,islandId:$island,connectTimeoutMs:$timeout,subscribeSettleMs:$settle}' >&3
  for ((i=0;i<${SMOKE_WS_CONNECT_TIMEOUT_MS:-5000}/100+10;i++)); do
    if jq -se 'any(.[]; .kind=="ready")' "$events" >/dev/null 2>&1; then connected=1; break; fi
    kill -0 "$WS_PID" 2>/dev/null || break; sleep .1
  done
  if [[ "$connected" == 1 ]]; then record 007 PASS 'STOMP 연결·구독 선발송 후 안정화'; else
    local wsreason
    wsreason=$(jq -sr '[.[] | select(.kind=="error") | .reason][0] // "WebSocket readiness timeout"' "$events" 2>/dev/null || printf 'WebSocket readiness timeout')
    record 007 FAIL "STOMP 연결/구독 실패: $wsreason"
  fi
  if req POST /focus-sessions "{\"islandId\":\"$ISLAND_ID\",\"subject\":\"smoke\",\"targetMinutes\":1}" "$TOKEN"; then SESSION_ID=$(smoke_json '.data.id'); fi
  if [[ -z "$SESSION_ID" ]] || ! req GET /focus-sessions/current '' "$TOKEN" || ! jq -e --arg id "$SESSION_ID" '.data.id==$id and .data.status=="active" and (.data.version|type)=="number"' "$SMOKE_BODY_FILE" >/dev/null; then
    record 006 FAIL '집중 시작/현재 조회 실패'; record 010 SKIP '집중 시작 실패'
  else
    if [[ "$connected" == 1 ]]; then
      jq -nc --arg id "$SESSION_ID" --argjson timeout "${SMOKE_EVENT_TIMEOUT_MS:-3000}" '{kind:"expect",sessionId:$id,eventTimeoutMs:$timeout}' >&3
      for ((i=0;i<${SMOKE_EVENT_TIMEOUT_MS:-3000}/100+10;i++)); do
        jq -se 'any(.[]; .kind=="event")' "$events" >/dev/null 2>&1 && break
        kill -0 "$WS_PID" 2>/dev/null || break; sleep .1
      done
      if jq -se 'any(.[]; .kind=="event")' "$events" >/dev/null 2>&1; then record 010 PASS 'active 집중 사건 사용자·세션 동일'; else record 010 FAIL '집중 사건 미수신'; fi
    else record 010 SKIP '웹소켓 선행 실패'; fi
    if smoke_finish "$TOKEN" "$SESSION_ID"; then SESSION_ID=''; record 006 PASS '집중 저장·종료·current null'; else record 006 FAIL '집중 종료 실패'; fi
  fi
  exec 3>&-
  kill "$WS_PID" 2>/dev/null || true; wait "$WS_PID" 2>/dev/null || true; WS_PID=''
}
residents_and_friends() (
  local today=$1 device peer_device name context
  # 관계 준비는 기본 검사 계정/014와 격리한 두 신규 게스트·전용 섬에서만 수행한다.
  TOKEN='' USER_ID='' ISLAND_ID='' SESSION_ID='' PEER_TOKEN='' PEER_ID=''
  PEER_JOINED=0 FRIEND_CREATED=0
  friend_cleanup() {
    [[ -z "$SESSION_ID" ]] || smoke_finish "$TOKEN" "$SESSION_ID" || record 016 FAIL '친구 흐름 집중 정리 실패'
    if [[ "$FRIEND_CREATED" == 1 ]]; then req DELETE "/friends/$PEER_ID" '' "$TOKEN" || record 016 FAIL '친구 정리 실패'; fi
    if [[ "$PEER_JOINED" == 1 ]]; then req DELETE "/islands/$ISLAND_ID/memberships/me" '' "$PEER_TOKEN" || record 016 FAIL '주민 정리 실패'; fi
  }
  trap friend_cleanup EXIT
  device=$(smoke_uuid); name="smoke-friends-$(smoke_uuid)"
  if ! req POST /auth/sessions/guest '' '' "$device"; then record 016 FAIL '전용 집중 사용자 준비'; return; fi
  TOKEN=$(smoke_json '.data.accessToken'); USER_ID=$(smoke_json '.data.userId')
  if ! req POST /islands "{\"name\":\"$name\",\"approvalRequired\":false}" "$TOKEN"; then record 016 FAIL '전용 주민 섬 준비'; return; fi
  ISLAND_ID=$(smoke_json '.data.id')
  peer_device=$(smoke_uuid)
  if ! req POST /auth/sessions/guest '' '' "$peer_device"; then record 016 FAIL '전용 주민 게스트 준비'; return; fi
  PEER_TOKEN=$(smoke_json '.data.accessToken'); PEER_ID=$(smoke_json '.data.userId')
  if ! req POST "/islands/$ISLAND_ID/memberships" '{}' "$PEER_TOKEN" || ! jq -e '.data.status=="active"' "$SMOKE_BODY_FILE" >/dev/null; then record 016 FAIL '같은 섬 주민 가입'; return; fi
  PEER_JOINED=1
  context="$SMOKE_TMP_DIR/friend-context.json"
  # jq 자격은 파일 입력만 사용한다; argv에는 토큰을 넣지 않는다.
  printf '%s' "$TOKEN" > "$SMOKE_TMP_DIR/friend-owner-token"
  printf '%s' "$PEER_TOKEN" > "$SMOKE_TMP_DIR/friend-peer-token"
  jq -nc --rawfile accessToken "$SMOKE_TMP_DIR/friend-owner-token" --rawfile peerAccessToken "$SMOKE_TMP_DIR/friend-peer-token" --arg userId "$USER_ID" --arg peerUserId "$PEER_ID" --arg islandId "$ISLAND_ID" '{accessToken:$accessToken,peerAccessToken:$peerAccessToken,userId:$userId,peerUserId:$peerUserId,islandId:$islandId}' > "$context"
  if ! SMOKE_FRIEND_CONTEXT_FILE="$context" "$HERE/prepare-friendship.sh"; then record 016 FAIL '게스트 친구 추가는 소셜 로그인 필요: internal 관계 fixture 준비 실패'; return; fi
  FRIEND_CREATED=1
  if ! req POST /focus-sessions "{\"islandId\":\"$ISLAND_ID\",\"subject\":\"smoke-friends\"}" "$TOKEN"; then record 016 FAIL '집중 시작'; return; fi
  SESSION_ID=$(smoke_json '.data.id')
  if req GET "/islands/$ISLAND_ID/members" '' "$TOKEN" && jq -e --arg id "$PEER_ID" 'any(.data.items[]; .id==$id)' "$SMOKE_BODY_FILE" >/dev/null && req GET "/islands/$ISLAND_ID/focus-members" '' "$PEER_TOKEN" && jq -e --arg user "$USER_ID" --arg session "$SESSION_ID" 'any(.data.items[]; .userId==$user and .sessionId==$session and .status=="active")' "$SMOKE_BODY_FILE" >/dev/null && req GET "/friends?date=$today" '' "$PEER_TOKEN" && jq -e --arg id "$USER_ID" 'any(.data[]; .userId==$id and .isFocusing==true and (.focusStartedAt|type)=="string")' "$SMOKE_BODY_FILE" >/dev/null && smoke_finish "$TOKEN" "$SESSION_ID"; then SESSION_ID=''; record 016 PASS '같은 섬 주민·친구의 실제 집중 상태 조회'; else record 016 FAIL '주민/친구/집중 상태 계약 또는 종료'; fi
)

screen_time() {
  local context=${SMOKE_CORE_CONTEXT_FILE:-} token island sid today measured body
  if [[ -z "$context" || ! -s "$context" ]]; then
    if [[ "${SMOKE_CORE_ENABLED:-0}" == 1 ]]; then
      context="$SMOKE_TMP_DIR/statistics-context.json"
      if ! SMOKE_CORE_CONTEXT_FILE="$context" "$HERE/prepare-statistics.sh"; then
        # 자식 실행기의 준비 실패를 부모의 마지막 성공 응답(200)으로 보고하지 않는다.
        SMOKE_HTTP_CODE=000; SMOKE_HTTP_MS=0
        : > "$SMOKE_BODY_FILE"
        record 015 FAIL '독립 도서관 fixture 준비 실패 (자식 실행기 진단 참조)'
        return
      fi
    else record 015 FAIL '완공 도서관 전용 fixture 없음: SMOKE_CORE_ENABLED=1 또는 SMOKE_CORE_CONTEXT_FILE 필요'; return; fi
  fi
  token=$(jq -er '.accessToken' "$context") || { record 015 FAIL 'fixture 토큰 없음'; return; }
  island=$(jq -er '.islandId' "$context") || return
  # Upload deviceId is signed auth session sid, not X-Device-Id.
  sid=$(printf '%s' "$token" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(Buffer.from(s.split(".")[1],"base64url")).sid)}catch{process.exit(1)}})') || { record 015 FAIL '서명된 sid 없음'; return; }
  today=$(date -u +%F); measured=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  if ! req GET "/islands/$island/statistics/screen-time?from=$today&to=$today&scope=me&timezone=UTC" '' "$token"; then record 015 FAIL '통계 초기 조회/도서관 gate'; return; fi
  body=$(jq -nc --arg device "$sid" --arg at "$measured" '{minutes:7,measurementStatus:"authorized",timezone:"UTC",measuredAt:$at,deviceId:$device}')
  if req PUT "/me/screen-time/$today" "$body" "$token" && jq -e --arg date "$today" '.data.date==$date and .data.minutes==7 and .data.measurementStatus=="authorized"' "$SMOKE_BODY_FILE" >/dev/null && req GET "/islands/$island/statistics/screen-time?from=$today&to=$today&scope=me&timezone=UTC" '' "$token" && jq -e --arg date "$today" '.data.scope=="me" and .data.totalMinutes==7 and any(.data.series[]; .date==$date and .minutes==7 and .measurementStatus=="authorized")' "$SMOKE_BODY_FILE" >/dev/null; then record 015 PASS 'UTC 표본 7분 저장·개인 통계 동일 (최신 관측 선택, 가산 아님)'; else record 015 FAIL '표본 저장/통계 합계 불일치'; fi
}
main
# 인증·섬 같은 선행 실패로 main이 일찍 끝나도 선택한 TC를 결과에서 누락하지 않는다.
selected=(001 002 003 004 005 006 007 009 010)
if [[ "${SMOKE_BASIC_ONLY:-0}" != 1 ]]; then
  selected+=(015 016)
  [[ "${SMOKE_CORE_ENABLED:-0}" != 1 ]] || selected+=(014)
fi
for id in "${selected[@]}"; do
  if ! awk -F '\t' -v id="SMOKE-SERVER-$id" '$1==id{found=1} END{exit !found}' "$RESULTS_FILE"; then
    SMOKE_HTTP_CODE=000; SMOKE_HTTP_MS=0
    record "$id" SKIP '선행 단계 실패로 실행되지 않음'
  fi
done
cleanup
trap - EXIT
awk -F '\t' 'NR>1 && $2!="PASS"{bad=1} END{exit bad}' "$RESULTS_FILE"
