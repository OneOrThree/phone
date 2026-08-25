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

# 어느 스키마인지 **먼저 확정**한다 (GROMO-1625 codex 리뷰).
#
# 인정은 **좁게**, 추출은 **넓게** 한다. 방향이 반대라 헷갈리기 쉬운데 실패 모드가 서로 다르다:
#   · 인정이 헐거우면 **모르는 응답이 성공으로 통과**한다 — 관문이 열린다.
#       1라운드: {"data":{"operationFailed":false}} 가 "카운터를 찾았다"로 읽혀 exit 0.
#       2라운드: {"data":{"errorCount":0,"error":"import rejected"}} 가 구 스키마로 읽혀 exit 0.
#     둘 다 이름 패턴만 보고 인정한 탓이다. 그래서 인정은 **실물에서 관측된 앵커**로만 한다.
#   · 추출이 넓으면 **0 이어야 할 카운터가 늘 뿐**이다 — 통과가 까다로워질 뿐 열리지 않는다.
#     실제로 구 실물의 errorCount 33개 중 2개(data.endpointCase · data.environment)는
#     *Collection 아래가 아니라 data 바로 밑에 있다. 추출까지 컬렉션 경로로 좁혔다면
#     그 둘의 import 실패를 영영 못 봤을 것이다. 그래서 추출은 data 전체를 훑는다.
#
#   counters    ← data.counters 에 숫자 *Failed 가 1개 이상 (신 실물 6개)
#   collections ← success:true **그리고** data.apiCollection.item.errorCount 가 숫자 (구 실물)
#   unknown     ← 그 외 전부 실패
# 경로를 밟기 전에 **타입부터** 확인한다. jq 의 `?` 는 오류를 삼키고 **아무것도 출력하지 않아**
# SCHEMA 가 빈 문자열이 되는데, 빈 문자열은 "unknown" 과 달라서 아래 판정을 그냥 통과했다
# ({"data":"nope"} 가 exit 0 이었다). 그래서 ① 타입 가드로 jq 가 오류를 낼 일을 없애고
# ② 그래도 빈 값이 나오면 case 의 default 로 **닫는다**. fail-closed 는 기본값이어야 한다.
SCHEMA=$(jq -r '
  def numeric_failed: to_entries | map(select((.key | endswith("Failed")) and (.value | type == "number")));
  if type != "object" then "unknown"
  elif (.data | type) != "object" then "unknown"
  elif ((.data.counters | type) == "object") and ((.data.counters | numeric_failed | length) > 0)
  then "counters"
  elif ((.success // false) == true)
       and ((.data.apiCollection | type) == "object")
       and ((.data.apiCollection.item | type) == "object")
       and ((.data.apiCollection.item.errorCount | type) == "number")
  then "collections"
  else "unknown"
  end' apidog-response.json 2>/dev/null || true)

case "$SCHEMA" in
  counters | collections) ;;
  *)
    echo "::error::Apidog 응답이 알려진 두 스키마 어느 쪽도 아니다 — data.counters 의 숫자 *Failed 도, success:true + 숫자 data.apiCollection.item.errorCount 도 없다(반영 여부 확인 불가)."
    cat apidog-response.json
    exit 1
    ;;
esac

# 인정한 스키마 안에서 **부분 드리프트**도 잡는다 — 카운터 하나가 null/문자열로 바뀌면
# 그 항목의 실패를 영영 못 보므로, 0 초과 검사 이전에 타입부터 닫는다.
if [ "$SCHEMA" = "counters" ]; then
  BAD_TYPE=$(jq -r '[.data.counters | to_entries[]
    | select((.key | endswith("Failed")) and (.value | type != "number"))
    | "data.counters.\(.key)=\(.value|tojson)"] | join(" ")' apidog-response.json)
else
  BAD_TYPE=$(jq -r '[(.data // {}) | paths as $p
    | select($p[-1] == "errorCount" and (getpath($p) | type != "number"))
    | "data.\($p | join("."))=\(getpath($p)|tojson)"] | join(" ")' apidog-response.json)
fi
if [ -n "$BAD_TYPE" ]; then
  echo "::error::실패 카운터가 숫자가 아니다 — ${BAD_TYPE} (응답 스키마 변경 의심, 반영 여부 확인 불가)."
  cat apidog-response.json
  exit 1
fi

# 반영 건수 요약 — 실패 판정에는 쓰지 않는다(위 주석 참조). 계속 0 이면 사람이 의심할 근거가 된다.
# 로그 한 줄 때문에 성공한 import 가 막히면 그게 이번 사고와 같은 종류라, 여기만 실패에 관대하다.
SUMMARY=$(jq -r '
  [ paths as $p
    | select((getpath($p) | type == "number") and getpath($p) != 0)
    | "\($p[-1])=\(getpath($p))" ]
  | join(" ")' apidog-response.json || true)
echo "project ${PROJECT_ID} 반영 — ${SUMMARY:-변경 없음(전 항목 0)}"

# 0 이 아닌 실패 카운터를 **어디서** 났는지와 함께 뽑는다. 위치를 안 남기면 스키마 오류인지
# 엔드포인트 오류인지 구분하러 응답 전문을 다시 읽어야 한다.
if [ "$SCHEMA" = "counters" ]; then
  NONZERO=$(jq -r '[.data.counters | to_entries[]
    | select((.key | endswith("Failed")) and (.value | type == "number") and .value > 0)
    | "data.counters.\(.key)=\(.value)"] | join(" ")' apidog-response.json)
  FAIL_FIELDS=$(jq '[.data.counters | to_entries[] | select((.key | endswith("Failed")) and (.value | type == "number"))] | length' apidog-response.json)
else
  NONZERO=$(jq -r '[(.data // {}) | paths as $p
    | select($p[-1] == "errorCount" and (getpath($p) | type == "number") and getpath($p) > 0)
    | "data.\($p | join("."))=\(getpath($p))"] | join(" ")' apidog-response.json)
  FAIL_FIELDS=$(jq '[(.data // {}) | paths as $p | select($p[-1] == "errorCount" and (getpath($p) | type == "number"))] | length' apidog-response.json)
fi
if [ -n "$NONZERO" ]; then
  echo "::error::Apidog 가 import 오류를 보고했다 — ${NONZERO}"
  cat apidog-response.json
  exit 1
fi
echo "스키마=${SCHEMA} · 실패 카운터 ${FAIL_FIELDS}개 전부 0"
