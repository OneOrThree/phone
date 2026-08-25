#!/usr/bin/env bash
#
# Apidog OpenAPI import 1건을 보내고 **반영됐는지까지** 확인한다 (GROMO-1623).
#
# 사용법: apidog-import.sh <projectId> <token> <payloadFile>
#
# 이 스크립트의 존재 이유는 전송이 아니라 **단언**이다. 예전 인라인 curl 은 빈 바디를 보내도
# Apidog 가 200 을 돌려주면 그대로 통과했고, 그 결과 문서가 최소 11일간 갱신되지 않았는데도
# CI 는 계속 초록이었다. 그래서 아래 세 관문을 둔다:
#   ① payload 가 실질 크기인가 (jq 가 조용히 실패하면 빈/부분 파일이 남는다)
#   ② HTTP 가 2xx 인가
#   ③ 응답 success 가 true 인가
# ③까지 통과해야 "보냈다"가 아니라 "받아들여졌다"가 된다.
#
# 반영 건수(create/update)는 **단언하지 않고 로그로만 남긴다** — 스펙이 직전 import 와 동일하면
# 전 건이 ignore 로 잡혀 0 이 나오는 게 정상이라, 0 을 실패로 보면 오탐이 된다.
# 대신 아래 요약 줄을 남겨 사람이 "계속 0" 을 알아볼 수 있게 한다.
set -euo pipefail

PROJECT_ID="$1"
TOKEN="$2"
PAYLOAD="$3"

# 로컬에서 목 서버로 이 스크립트의 관문 3개를 실제로 돌려보기 위한 훅. CI 는 기본값을 쓴다.
BASE_URL="${APIDOG_BASE_URL:-https://api.apidog.com}"

# ① payload 실질 크기 — 스펙 하나가 200 KB 대라 정상 payload 는 10 KB 를 한참 넘는다.
#    빈 파일(0 B)이나 jq 중단으로 절단된 파일을 여기서 잡는다.
MIN_BYTES=10000
SIZE=$(wc -c < "$PAYLOAD")
if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "::error::Apidog payload 가 너무 작다 (${SIZE} B < ${MIN_BYTES} B) — 스펙 생성/직렬화가 실패했다. 전송하지 않는다."
  exit 1
fi
echo "payload=${SIZE} B → project ${PROJECT_ID}"

# ② HTTP 상태 — 바디를 파일로 받아 실패 시 원인을 로그에 남긴다.
#    (--fail 은 바디를 버려 422 의 사유를 못 보게 만든다.)
HTTP=$(curl --silent --show-error \
  -o apidog-response.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/projects/${PROJECT_ID}/import-openapi" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Apidog-Api-Version: 2024-03-28" \
  -H "Content-Type: application/json" \
  --data @"$PAYLOAD")

if [ "$HTTP" -ge 400 ]; then
  echo "::error::Apidog import 실패 — HTTP ${HTTP}"
  cat apidog-response.json
  exit 1
fi

# ③ 응답 success — 2xx 여도 success:false 면 반영되지 않은 것이다.
if ! jq -e '.success == true' apidog-response.json > /dev/null; then
  echo "::error::Apidog 가 HTTP ${HTTP} 로 응답했지만 success 가 true 가 아니다."
  cat apidog-response.json
  exit 1
fi

# 반영 건수 요약 — 실패 판정에는 쓰지 않는다(위 주석 참조). 계속 0 이면 사람이 의심할 근거가 된다.
jq -r --arg pid "$PROJECT_ID" \
  '.data.apiCollection.item
   | "project \($pid) 반영 — create=\(.createCount) update=\(.updateCount) ignore=\(.ignoreCount) delete=\(.deleteCount) error=\(.errorCount)"' \
  apidog-response.json

# 엔드포인트 단위 오류는 200/success:true 안에 섞여 오므로 따로 본다.
ERRORS=$(jq -r '.data.apiCollection.item.errorCount' apidog-response.json)
if [ "$ERRORS" != "0" ]; then
  echo "::error::Apidog 가 엔드포인트 ${ERRORS} 건을 오류로 처리했다."
  cat apidog-response.json
  exit 1
fi
