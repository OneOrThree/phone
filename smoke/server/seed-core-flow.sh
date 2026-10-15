#!/usr/bin/env bash
set -euo pipefail
# 내부 DB 접속이 가능한 실행기에서만 호출. 접속값은 출력하지 않는다.
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
for value in "${SMOKE_CORE_USER_ID:-}" "${SMOKE_CORE_ISLAND_ID:-}" "${SMOKE_CORE_SESSION_ID:-}"; do
  [[ "$value" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo 'fixture UUID 누락/형식 오류' >&2; exit 1; }
done
[[ "${SMOKE_CORE_FIXTURE_NAME:-}" == "smoke-core-${SMOKE_CORE_DEVICE_ID:-}" ]] || { echo 'fixture 이름/기기 대조 실패' >&2; exit 1; }
SMOKE_FIXTURE_MODE=${SMOKE_FIXTURE_MODE:-core}
[[ "$SMOKE_FIXTURE_MODE" == core || "$SMOKE_FIXTURE_MODE" == statistics ]] || { echo 'fixture 모드 오류' >&2; exit 1; }
args=(-X -q -t -A -v ON_ERROR_STOP=1 -v "fixture_mode=$SMOKE_FIXTURE_MODE" -v "user_id=$SMOKE_CORE_USER_ID" -v "island_id=$SMOKE_CORE_ISLAND_ID" -v "session_id=$SMOKE_CORE_SESSION_ID" -v "fixture_name=$SMOKE_CORE_FIXTURE_NAME")
if [[ -n "${SMOKE_DB_CONTAINER:-}" ]]; then
  docker exec -i "$SMOKE_DB_CONTAINER" psql -U "${SMOKE_DB_USER:-postgres}" -d "${SMOKE_DB_NAME:-phone}" "${args[@]}" < "$SCRIPT_DIR/seed-core-flow.sql"
elif [[ -n "${SMOKE_DATABASE_URL:-}" ]]; then
  # libpq reads credentials from environment, never argv.
  PGDATABASE="$SMOKE_DATABASE_URL" psql "${args[@]}" < "$SCRIPT_DIR/seed-core-flow.sql"
else
  echo '내부 DB 설정 필요: SMOKE_DB_CONTAINER 또는 SMOKE_DATABASE_URL' >&2
  exit 1
fi
