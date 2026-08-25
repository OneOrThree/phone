#!/usr/bin/env bash
#
# Apidog OpenAPI import 1건을 보내고 **반영됐는지까지** 확인한다 (GROMO-1623).
#
# 사용법: APIDOG_TOKEN=... apidog-import.sh <projectId> <payloadFile>
#
# 토큰은 위치 인자가 아니라 env 로 받는다. argv 는 `ps aux` 로 같은 호스트의 아무 유저에게나
# 보이지만 환경변수는 /proc/<pid>/environ 을 통해서만 보이고 그 파일은 소유자·root 만 읽는다.
# self-hosted 러너가 멀티테넌시일 수 있어 노출 표면을 줄인다.
# ⚠️ 잔여 노출: 아래 curl 의 `-H "Authorization: Bearer ..."` 는 여전히 curl 의 argv 에 실린다.
#    이걸 없애려면 `curl --config <파일>` 로 헤더를 파일에서 읽어야 하는데, 그건 러너 디스크에
#    시크릿 파일을 남기는 것이라 더 나쁘다. 그래서 노출 창을 스크립트 수명 전체에서
#    curl 실행 순간으로 줄이는 선까지만 한다.
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
PAYLOAD="$2"
TOKEN="${APIDOG_TOKEN:?APIDOG_TOKEN 이 비어 있다 — 시크릿 이름을 확인하라}"

# 로컬에서 목 서버로 이 스크립트의 관문 3개를 실제로 돌려보기 위한 훅. CI 는 기본값을 쓴다.
BASE_URL="${APIDOG_BASE_URL:-https://api.apidog.com}"

# ① payload 실질 크기 — 스펙 하나가 200 KB 대라 정상 payload 는 10 KB 를 한참 넘는다.
#    빈 파일(0 B)이나 jq 중단으로 절단된 파일을 여기서 잡는다.
#    파일 부재는 먼저 잡는다 — 안 그러면 리다이렉션 실패의 셸 기본 메시지로 끝나 CI 로그에서
#    "왜 죽었는지"가 한 줄로 안 읽힌다.
if [ ! -f "$PAYLOAD" ]; then
  echo "::error::Apidog payload 파일이 없다: ${PAYLOAD} — 앞단 jq 가 실행되지 못했다."
  exit 1
fi
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

# ③ 수락·오류 판정.
#
# ⚠️ Apidog 응답 스키마는 두 종이 관측됐다 (GROMO-1625).
#   (신) 2026-08-25 정상 import 실측:
#        {"data":{"counters":{"endpointCreated":14,"endpointUpdated":38,"endpointFailed":0,
#                             "schemaFailed":0,"securitySchemeFailed":0, ...}}}
#        → success 필드가 **없고**, 실패는 *Failed 6종으로 온다
#   (구) 2026-08-19 빈 바디 요청에 받던 것:
#        {"success":true,"data":{"apiCollection":{"item":{"errorCount":0, ...}}, ...}}
#
# GROMO-1623 은 (구)만 알고 짜였다 — 그 픽스처의 출처가 **빈 바디를 보낸 실패 경로**였기
# 때문이다. 그래서 목 테스트 10개가 다 통과하고도 실물에서 성공한 import 를 막았다.
# 지어낸 형태가 아니라 **실물 응답 2종**을 기준으로 두 스키마를 모두 이해하게 둔다.

# 수락 여부 — success 는 (구)에만 있으므로 "있으면 검사, 없으면 카운터 존재로 갈음" 한다.
if jq -e 'has("success")' apidog-response.json > /dev/null 2>&1; then
  if ! jq -e '.success == true' apidog-response.json > /dev/null; then
    echo "::error::Apidog 가 HTTP ${HTTP} 로 응답했지만 success 가 true 가 아니다."
    cat apidog-response.json
    exit 1
  fi
fi

# 실패 카운터 — 두 스키마의 이름을 모두 훑는다.
FAIL_SELECTOR='($p[-1] | type == "string") and (($p[-1] | endswith("Failed")) or ($p[-1] == "errorCount"))'
FAIL_FIELDS=$(jq "[paths as \$p | select(${FAIL_SELECTOR})] | length" apidog-response.json)
if [ "$FAIL_FIELDS" -eq 0 ]; then
  echo "::error::Apidog 응답에 실패 카운터(*Failed / errorCount)가 하나도 없다 — 응답 스키마가 예상과 다르다(반영 여부 확인 불가)."
  cat apidog-response.json
  exit 1
fi

# 반영 건수 요약 — 실패 판정에는 쓰지 않는다(위 주석 참조). 계속 0 이면 사람이 의심할 근거가 된다.
# 두 스키마를 모두 다루려고 0 이 아닌 카운터만 이름째로 뽑는다.
SUMMARY=$(jq -r '
  [ paths as $p
    | select((getpath($p) | type == "number") and getpath($p) != 0)
    | "\($p[-1])=\(getpath($p))" ]
  | join(" ")' apidog-response.json)
echo "project ${PROJECT_ID} 반영 — ${SUMMARY:-변경 없음(전 항목 0)}"

# 0 이 아닌 실패 카운터를 **어디서** 났는지와 함께 뽑는다. 위치를 안 남기면 스키마 오류인지
# 엔드포인트 오류인지 구분하러 응답 전문을 다시 읽어야 한다.
NONZERO=$(jq -r "
  [ paths as \$p
    | select(${FAIL_SELECTOR}
             and (getpath(\$p) | type == \"number\")
             and getpath(\$p) > 0)
    | \"\(\$p | join(\".\"))=\(getpath(\$p))\" ]
  | join(\" \")" apidog-response.json)
if [ -n "$NONZERO" ]; then
  echo "::error::Apidog 가 import 오류를 보고했다 — ${NONZERO}"
  cat apidog-response.json
  exit 1
fi
echo "실패 카운터 ${FAIL_FIELDS}개 전부 0"
