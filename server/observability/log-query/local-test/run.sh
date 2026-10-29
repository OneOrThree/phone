#!/usr/bin/env bash
# GROMO-2560 로컬 조회 하네스. 실행: server/observability/log-query/local-test/run.sh   (끝나면 down -v·임시 디렉터리 삭제)
# Loki·Grafana·Trino 와 검사 컨테이너는 internal 네트워크에만 붙는다 — AWS·인터넷으로 나가는 요청이 없다.
# 판정은 check.py 의 단언과 Grafana 프로비저닝 오류 로그다. 종료 코드 0 = 통과.
set -uo pipefail
cd "$(dirname "$0")"
C="docker compose -p obs2562-query -f docker-compose.yml"
export QUERY_DATA="${TMPDIR:-/tmp}/obs2562-query-data"
clean() { $C --profile tools down -v --remove-orphans >/dev/null 2>&1; rm -rf "$QUERY_DATA"; }
trap clean EXIT
clean
mkdir -p "$QUERY_DATA"

$C up -d loki grafana trino || exit 1
$C --profile tools run --rm check python -u /w/check.py
rc=$?

echo "== Grafana 프로비저닝 오류 로그(대시보드·데이터소스)"
errors=$($C logs grafana 2>&1 | grep -E 'level=(error|eror)' | grep -iE 'dashboard|provision|datasource' || true)
if [ -n "$errors" ]; then echo "$errors"; rc=1; else echo "없음"; fi
exit $rc
