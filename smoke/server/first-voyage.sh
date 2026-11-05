#!/usr/bin/env bash
# run.sh의 신규 main 게스트를 재사용한다. 추가 로그인·DB seed·운영 요청은 없다.
first_voyage() {
  local destination key response_id confirmed replay_id
  local stage='신규 게스트의 무소속 확인'
  if ! req GET /me/islands '' "$TOKEN" || ! jq -e '.data.items == [] and .data.currentIslandId == null' "$SMOKE_BODY_FILE" >/dev/null; then
    record 019 FAIL "$stage"; return
  fi
  stage='첫 항해 무인도 후보 조회'
  if ! req GET /me/telescope '' "$TOKEN"; then record 019 FAIL "$stage"; return; fi
  destination=$(jq -er '[.data.items[] | select(.slot=="uninhabited")][0].islandId | strings' "$SMOKE_BODY_FILE" 2>/dev/null || true)
  if [[ ! "$destination" =~ ^[0-9a-fA-F-]{36}$ ]]; then record 019 FAIL "$stage"; return; fi
  key=$(smoke_uuid) || { record 019 FAIL '멱등 키 생성'; return; }
  stage='첫 항해 도착·실제 섬 생성'
  response_id=''
  if smoke_request POST "/islands/$destination/intro-arrivals" '' "$TOKEN" '' "$key" && smoke_ok; then
    response_id=$(jq -er '.data | select(.membershipStatus=="active" and .currentIslandId==.islandId and (.arrivedBefore|type)=="boolean") | .islandId | strings' "$SMOKE_BODY_FILE" 2>/dev/null || true)
  fi
  # 응답 유실도 무소속이었던 신규 계정의 단일 소속을 확인해 정리 대상으로 추적한다.
  confirmed=''
  if req GET /me/islands '' "$TOKEN"; then
    confirmed=$(jq -er '.data | select((.items|length)==1 and .items[0].id==.currentIslandId) | .currentIslandId | strings' "$SMOKE_BODY_FILE" 2>/dev/null || true)
  fi
  if [[ "$confirmed" =~ ^[0-9a-fA-F-]{36}$ ]]; then MAIN_CREATED_ISLAND_ID="$confirmed"; fi
  if [[ -z "$response_id" || "$response_id" != "$confirmed" ]]; then record 019 FAIL "$stage"; return; fi
  stage='같은 멱등 키 재전송·생성 섬 유지'
  if ! smoke_request POST "/islands/$destination/intro-arrivals" '' "$TOKEN" '' "$key" || ! smoke_ok; then record 019 FAIL "$stage"; return; fi
  replay_id=$(jq -er '.data.islandId | strings' "$SMOKE_BODY_FILE" 2>/dev/null || true)
  if [[ "$replay_id" != "$confirmed" ]]; then record 019 FAIL "$stage"; return; fi
  if ! req GET /me/islands '' "$TOKEN" || ! jq -e --arg id "$confirmed" '.data | (.items|length)==1 and .items[0].id==$id and .currentIslandId==$id' "$SMOKE_BODY_FILE" >/dev/null; then
    record 019 FAIL "$stage"; return
  fi
  stage='첫 항해 후 홈 조각 확인'
  if ! req GET "/screens/home?date=$(TZ=Asia/Seoul date +%F)&timezone=Asia/Seoul" '' "$TOKEN" || ! jq -e '.data | (.buildings|type)=="array" and (.members.items|type)=="array" and (.wallets|has("fish") and has("villagePoints")) and ((.missingFragments // [])|length)==0' "$SMOKE_BODY_FILE" >/dev/null; then
    record 019 FAIL "$stage"; return
  fi
  record 019 PASS '신규 게스트→무인도→실제 섬 도착→동일 키 재전송→단일 소속→홈'
}
