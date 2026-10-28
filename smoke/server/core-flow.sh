#!/usr/bin/env bash
# SMOKE-SERVER-014: 실제 집중 → 섬 적립 → 건설 → 게스트 구매 거절·무변경.
set -uo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
source "$SCRIPT_DIR/lib.sh"
: "${BASE_URL:?BASE_URL이 필요합니다}"
smoke_init
stage='초기 준비'; session=''; token=''; island=''; defer_island=0; B0='?'; B1='?'; B2='?'; B3='?'; product='?'
start=$(date +%s)
cleanup() {
  local failed=0
  if [[ -n "$session" && -n "$token" ]]; then
    smoke_finish "$token" "$session" || { echo 'TC014 진행 세션 정리 실패' >&2; failed=1; }
  fi
  session=''
  if [[ "$defer_island" != 1 && -n "$island" ]]; then
    smoke_request DELETE "/islands/$island/memberships/me" '' "$token" && smoke_ok || { echo 'TC014 전용 섬 정리 실패' >&2; failed=1; }
  fi
  island=''
  return "$failed"
}
trap 'cleanup || true; rm -rf "$SMOKE_TMP_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
api() { smoke_request "$1" "$2" "${3:-}" "$token" "${4:-}" && smoke_ok; }
assert() { jq -e "$1" "$SMOKE_BODY_FILE" >/dev/null; }
flow() {
  SMOKE_CORE_DEVICE_ID=$(smoke_uuid) || return 1
  export SMOKE_CORE_DEVICE_ID
  export SMOKE_CORE_FIXTURE_NAME="smoke-core-$SMOKE_CORE_DEVICE_ID"
  stage='전용 게스트 생성'
  smoke_guest_login "$SMOKE_CORE_DEVICE_ID" core || return 1
  stage='게스트 발급 본문·세션 클레임 확인'
  token=$(smoke_json '.data.accessToken') || return 1
  SMOKE_CORE_USER_ID=$(smoke_json '.data.userId') || return 1
  export SMOKE_CORE_USER_ID
  SMOKE_CORE_SESSION_ID=$(printf '%s' "$token" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(Buffer.from(s.split(".")[1],"base64url")).sid)}catch{process.exit(1)}})') || return 1
  export SMOKE_CORE_SESSION_ID
  [[ -n "$SMOKE_CORE_SESSION_ID" ]] || return 1
  stage='전용 섬 생성'
  api POST /islands "{\"name\":\"$SMOKE_CORE_FIXTURE_NAME\",\"approvalRequired\":false}" || return 1
  SMOKE_CORE_ISLAND_ID=$(smoke_json '.data.id') || return 1
  export SMOKE_CORE_ISLAND_ID
  [[ -n "$SMOKE_CORE_ISLAND_ID" ]] || return 1
  island="$SMOKE_CORE_ISLAND_ID"
  stage='내부 DB fixture 준비'
  "$SCRIPT_DIR/seed-core-flow.sh" > "$SMOKE_TMP_DIR/policy.json" 2> "$SMOKE_TMP_DIR/seed-error" || return 1
  seconds=$(jq -er '.secondsPerFish | select(. > 0)' "$SMOKE_TMP_DIR/policy.json") || return 1
  policy=$(jq -er '.policyRevision' "$SMOKE_TMP_DIR/policy.json") || return 1
  [[ "$seconds" =~ ^[0-9]+$ && "$seconds" -le 150 ]] || { stage='집중 정책 시간이 3분 예산 초과'; return 1; }
  jq -e '.dailyCapFish > 0' "$SMOKE_TMP_DIR/policy.json" >/dev/null || return 1
  today=$(TZ=Asia/Seoul date +%F)
  home="/screens/home?date=$today&timezone=Asia/Seoul"
  stage='홈·초기 잔액'
  api GET "$home" || return 1
  assert '.data.buildings | index("shop") != null' || return 1
  api GET "/islands/$island/shop/wallets" || return 1
  B0=$(smoke_json '.data.villagePoints') || return 1
  api GET "/islands/$island/construction-options" || return 1
  assert '.data.items[] | select(.id=="hall") | .selectable == true' || return 1
  stage='집중 시작·실제 대기'
  api POST /focus-sessions "{\"islandId\":\"$island\",\"subject\":\"smoke-core\"}" || return 1
  session=$(smoke_json '.data.id') || return 1
  assert '.data.status == "active"' || return 1
  echo "TC014 정책 revision=$policy, 실제 집중 $((seconds+2))초 대기"
  remaining=$((seconds+2))
  while (( remaining > 0 )); do
    chunk=$remaining; ((chunk>30)) && chunk=30
    sleep "$chunk"; remaining=$((remaining-chunk))
  done
  api GET /focus-sessions/current || return 1
  version=$(smoke_json '.data.version') || return 1
  assert ".data.id == \"$session\" and .data.status == \"active\" and .data.activeSeconds >= $seconds" || return 1
  stage='집중 종료·일반 보상'
  api POST "/focus-sessions/$session/finish" "{\"expectedVersion\":$version}" || return 1
  assert '.data.earnedFish > 0' || return 1
  session=''
  api GET /focus-sessions/current || return 1
  assert '.data == null' || return 1
  api GET "/islands/$island/shop/wallets" || return 1
  B1=$(smoke_json '.data.villagePoints') || return 1
  ((B1>B0)) || return 1
  stage='회관 목표·착공'
  api GET "/islands/$island/construction-options" || return 1
  cost=$(smoke_json '.data.items[] | select(.id=="hall") | .cost') || return 1
  version=$(smoke_json '.data.islandVersion') || return 1
  revision=$(smoke_json '.data.costPolicyVersion') || return 1
  api PUT "/islands/$island/construction-target" "{\"buildingId\":\"hall\",\"expectedVersion\":$version}" || return 1
  api GET "/islands/$island/construction-options" || return 1
  assert ".data.costPolicyVersion == $revision and (.data.items[] | select(.id==\"hall\") | .cost == $cost and .buildable == true)" || return 1
  version=$(smoke_json '.data.islandVersion') || return 1
  api POST "/islands/$island/constructions" "{\"buildingId\":\"hall\",\"expectedVersion\":$version,\"expectedCostPolicyVersion\":$revision}" || return 1
  assert '.data.buildingId == "hall" and .data.status == "BUILDING"' || return 1
  api GET "/islands/$island/shop/wallets" || return 1
  B2=$(smoke_json '.data.villagePoints') || return 1
  ((B2==B1-cost)) || return 1
  stage='게스트 구매 거절·무변경'
  api GET "/islands/$island/shop/products?category=personal&limit=100" || return 1
  product=$(jq -r '[.data.items[] | select(.available and (.owned|not) and .price>0)][0].id // "smoke-guest-denied"' "$SMOKE_BODY_FILE") || return 1
  product_version=1
  if [[ "$product" != smoke-guest-denied ]]; then
    api GET "/islands/$island/shop/products/$product" || return 1
    product_version=$(smoke_json '.data.productVersion') || return 1
  fi
  # 빈 카탈로그에서도 유효한 요청 형식으로 회원 gate가 상품 조회보다 먼저 적용됨을 확인한다.
  api GET /me/inventory || return 1
  jq -S '.data' "$SMOKE_BODY_FILE" > "$SMOKE_TMP_DIR/inventory-before.json" || return 1
  api GET "/islands/$island/shop/orders?scope=personal&limit=100" || return 1
  jq -S '.data' "$SMOKE_BODY_FILE" > "$SMOKE_TMP_DIR/orders-before.json" || return 1
  api GET "/islands/$island/shop/wallets" || return 1
  wallet_version=$(smoke_json '.data.villagePointsVersion') || return 1
  smoke_request POST "/islands/$island/shop/orders" "{\"productId\":\"$product\",\"expectedWalletVersion\":$wallet_version,\"expectedProductVersion\":$product_version}" "$token" || return 1
  [[ "$SMOKE_HTTP_CODE" == 403 ]] || return 1
  assert '(.error.code // .code) == "SOCIAL_LOGIN_REQUIRED"' || return 1
  api GET "/islands/$island/shop/wallets" || return 1
  B3=$(smoke_json '.data.villagePoints') || return 1
  ((B3==B2)) || return 1
  assert ".data.villagePointsVersion == $wallet_version" || return 1
  api GET "/islands/$island/shop/orders?scope=personal&limit=100" || return 1
  jq -S '.data' "$SMOKE_BODY_FILE" > "$SMOKE_TMP_DIR/orders-after.json" || return 1
  cmp -s "$SMOKE_TMP_DIR/orders-before.json" "$SMOKE_TMP_DIR/orders-after.json" || return 1
  api GET /me/inventory || return 1
  jq -S '.data' "$SMOKE_BODY_FILE" > "$SMOKE_TMP_DIR/inventory-after.json" || return 1
  cmp -s "$SMOKE_TMP_DIR/inventory-before.json" "$SMOKE_TMP_DIR/inventory-after.json" || return 1
  stage='홈·건설 최종 상태'
  api GET "$home" || return 1
  assert ".data.wallets.villagePoints == $B3" || return 1
  cp "$SMOKE_BODY_FILE" "$SMOKE_TMP_DIR/final-home.json"
  api GET "/islands/$island/construction-options" || return 1
  if ! assert '.data.activeConstruction.buildingId == "hall"'; then
    jq -e '.data.buildings | index("hall") != null' "$SMOKE_TMP_DIR/final-home.json" >/dev/null || return 1
  fi
  if [[ -n "${SMOKE_CORE_CONTEXT_FILE:-}" ]]; then
    printf '%s' "$token" > "$SMOKE_TMP_DIR/token"
    jq -n --rawfile accessToken "$SMOKE_TMP_DIR/token" --arg userId "$SMOKE_CORE_USER_ID" --arg islandId "$island" --arg deviceId "$SMOKE_CORE_DEVICE_ID" \
      '{accessToken:$accessToken,userId:$userId,islandId:$islandId,deviceId:$deviceId}' > "$SMOKE_CORE_CONTEXT_FILE"
    chmod 600 "$SMOKE_CORE_CONTEXT_FILE"
    defer_island=1
  fi
}
if flow; then
  cleanup_ok=1; cleanup || cleanup_ok=0
  if [[ "$cleanup_ok" == 1 ]]; then
    smoke_record SMOKE-SERVER-014 PASS "$SMOKE_HTTP_CODE" "$((($(date +%s)-start)*1000))" "B0=$B0 B1=$B1 B2=$B2 B3=$B3 product=$product purchase=403/SOCIAL_LOGIN_REQUIRED unchanged=wallet,orders,inventory"
  else
    smoke_record SMOKE-SERVER-014 FAIL "${SMOKE_HTTP_CODE:-000}" "$((($(date +%s)-start)*1000))" '전용 섬 정리 실패'
    exit 1
  fi
else
  cleanup_ok=1; cleanup || cleanup_ok=0; session=''
  # DB 오류는 원문 접속 정보를 노출하지 않고 제한된 원인만 전달한다.
  reason="$stage 실패; B0=$B0 B1=$B1 B2=$B2 B3=$B3 정리=$cleanup_ok"
  if [[ "$stage" == '전용 게스트 생성' ]]; then reason="$reason; ${SMOKE_AUTH_SUMMARY:-}"; fi
  error_code=$(jq -r '.error.code // .code // empty' "$SMOKE_BODY_FILE" 2>/dev/null || true)
  if [[ "$error_code" =~ ^[A-Z][A-Z0-9_]{0,79}$ ]]; then
    reason="$reason; API=$error_code"
  fi
  if [[ -s "$SMOKE_TMP_DIR/seed-error" ]]; then
    reason="$reason; $(sed -n 's/.*ERROR:  /DB: /p' "$SMOKE_TMP_DIR/seed-error" | head -1)"
  fi
  smoke_record SMOKE-SERVER-014 FAIL "${SMOKE_HTTP_CODE:-000}" "$((($(date +%s)-start)*1000))" "$reason"
  exit 1
fi
