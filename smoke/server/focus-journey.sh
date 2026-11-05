#!/usr/bin/env bash
# 첫 항해를 끝낸 같은 신규 게스트로 집중·휴식·정산을 검증한다.
focus_journey() {
  local start_key retry_key pause_key resume_key finish_key session version paused_seconds fish before after body stage seconds started completed elapsed
  stage='현재 보상 정책 확인'
  seconds=${SMOKE_FIRST_REWARD_SECONDS:-}
  if [[ -z "$seconds" ]]; then
    seconds=$("${SMOKE_DOCKER:-docker}" exec "$SMOKE_DB_CONTAINER" psql -U "$SMOKE_DB_USER" -d "$SMOKE_DB_NAME" -X -q -t -A -c 'SELECT seconds_per_fish FROM focus_reward_policies ORDER BY revision DESC LIMIT 1' | tr -d '[:space:]') || { record 020 FAIL "$stage"; return; }
  fi
  if [[ ! "$seconds" =~ ^[0-9]+$ ]] || (( seconds < 1 || seconds > 150 )); then record 020 FAIL "$stage"; return; fi
  stage='초기 지갑'
  if ! smoke_request GET "/islands/$ISLAND_ID/shop/wallets" '' "$TOKEN" || ! smoke_ok; then record 020 FAIL "$stage"; return; fi
  before=$(jq -er '.data.villagePoints | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  body=$(jq -nc --arg id "$ISLAND_ID" '{islandId:$id,subject:"smoke"}')
  start_key=$(smoke_uuid); retry_key=$(smoke_uuid)
  stage='집중 시작·시간 확인'
  if ! smoke_request POST /focus-sessions "$body" "$TOKEN" '' "$start_key" || ! smoke_ok ||
     ! jq -e '.data.status=="active" and (.data.startedAt|type)=="string" and (.data.serverNow|type)=="string"' "$SMOKE_BODY_FILE" >/dev/null; then
    record 020 FAIL "$stage"; return
  fi
  session=$(jq -er '.data.id | strings' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  started=$(jq -er '.data.startedAt | strings' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  SESSION_ID="$session"
  version=$(jq -er '.data.version | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  stage='같은 시작 재요청과 다른 시작 거부'
  if ! smoke_request POST /focus-sessions "$body" "$TOKEN" '' "$start_key" || ! smoke_ok ||
     ! jq -e --arg id "$session" '.data.id==$id' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  if ! smoke_request POST /focus-sessions "$body" "$TOKEN" '' "$retry_key" || [[ "$SMOKE_HTTP_CODE" != 409 ]]; then record 020 FAIL "$stage"; return; fi
  stage='앱 복구에 필요한 진행 세션 재조회'
  if ! smoke_request GET /focus-sessions/current '' "$TOKEN" || ! smoke_ok ||
     ! jq -e --arg id "$session" '.data.id==$id and .data.status=="active"' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  stage='휴식과 휴식 중 시간 정지'
  pause_key=$(smoke_uuid)
  if ! smoke_request POST "/focus-sessions/$session/pause" "{\"expectedVersion\":$version}" "$TOKEN" '' "$pause_key" || ! smoke_ok ||
     ! jq -e '.data.status=="paused" and (.data.activeSeconds|type)=="number"' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  paused_seconds=$(jq -er '.data.activeSeconds' "$SMOKE_BODY_FILE"); version=$(jq -er '.data.version | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  sleep 3
  if ! smoke_request GET /focus-sessions/current '' "$TOKEN" || ! smoke_ok ||
     ! jq -e --arg id "$session" --argjson seconds "$paused_seconds" '.data.id==$id and .data.status=="paused" and .data.activeSeconds==$seconds' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  resume_key=$(smoke_uuid); stage='집중 재개와 오래된 버전 거절'
  if ! smoke_request POST "/focus-sessions/$session/resume" "{\"expectedVersion\":$version}" "$TOKEN" '' "$resume_key" || ! smoke_ok ||
     ! jq -e '.data.status=="active"' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  version=$(jq -er '.data.version | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  if ! smoke_request POST "/focus-sessions/$session/finish" '{"expectedVersion":0}' "$TOKEN" '' "$(smoke_uuid)" || [[ "$SMOKE_HTTP_CODE" != 409 ]]; then record 020 FAIL "$stage"; return; fi
  if ! smoke_request GET /focus-sessions/current '' "$TOKEN" || ! smoke_ok ||
     ! jq -e --arg id "$session" '.data.id==$id and .data.status=="active"' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  stage='집중 보상과 종료'
  # 최소 집중 60초와 분 단위 적립 스케줄러의 최대 한 주기를 함께 기다린다.
  sleep $((seconds + 65))
  finish_key=$(smoke_uuid); body="{\"expectedVersion\":$version}"
  if ! smoke_request POST "/focus-sessions/$session/finish" "$body" "$TOKEN" '' "$finish_key" || ! smoke_ok ||
     ! jq -e --arg id "$session" --argjson seconds "$seconds" '.data.recordId==$id and .data.earnedFish>0 and (.data.completedAt|type)=="string" and .data.activeSeconds>=$seconds' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  fish=$(jq -er '.data.earnedFish | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  completed=$(jq -er '.data.completedAt | strings' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  elapsed=$(jq -er '.data.activeSeconds | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  if ! node -e 'const [start,end,seconds]=process.argv.slice(1); const a=Date.parse(start),b=Date.parse(end); if(!Number.isFinite(a)||!Number.isFinite(b)||b<a||Number(seconds)>(b-a)/1000+1)process.exit(1)' "$started" "$completed" "$elapsed"; then record 020 FAIL '시작·종료 시각과 집중 시간 불일치'; return; fi
  stage='종료 응답 유실 재요청과 보상 중복 방지'
  if ! smoke_request POST "/focus-sessions/$session/finish" "$body" "$TOKEN" '' "$finish_key" || ! smoke_ok ||
     ! jq -e --arg id "$session" --argjson fish "$fish" '.data.recordId==$id and .data.earnedFish==$fish' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  if ! smoke_request GET /focus-sessions/current '' "$TOKEN" || ! smoke_ok || ! jq -e '.data==null' "$SMOKE_BODY_FILE" >/dev/null; then record 020 FAIL "$stage"; return; fi
  SESSION_ID=''
  if ! smoke_request GET "/islands/$ISLAND_ID/shop/wallets" '' "$TOKEN" || ! smoke_ok; then record 020 FAIL "$stage"; return; fi
  after=$(jq -er '.data.villagePoints | numbers' "$SMOKE_BODY_FILE") || { record 020 FAIL "$stage"; return; }
  if (( after - before != fish )); then record 020 FAIL "$stage"; return; fi
  record 020 PASS '첫 항해 신규 사용자 집중 시작·휴식·재개·충돌·종료 재생·보상'
}
