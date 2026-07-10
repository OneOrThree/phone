#!/usr/bin/env bash
# golden DB 스키마 구성 — 앱 부팅 없이 dockerized Flyway CLI 로 V1+V2 실행.
# prod 와 같은 경로(Flyway 마이그레이션)로 만들어진 스키마여야 이후 앱의 ddl-auto:validate 가
# 드리프트 가드로 성립한다. 빈 DB 라 baseline 불필요(V1부터 전부 실행).
#
# 관측 VM 에서 실행 전제 (Cloud SQL 은 사설 IP — seed.sh 가 이 파일을 VM 으로 보냄).
# 필요 env: DB_HOST, DB_PASSWORD (user=loadtest 고정)
set -euo pipefail

DB_HOST="${DB_HOST:?Cloud SQL 사설 IP}"
DB_USER="${DB_USER:-loadtest}"
DB_PASSWORD="${DB_PASSWORD:?}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/back/src/main/resources/db/migration}"

echo "[00_flyway] golden DB 재생성"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 <<'SQL'
-- 재시드 시 기존 golden 회수: template 지정 해제 후 드롭
UPDATE pg_database SET datistemplate = false WHERE datname = 'golden';
DROP DATABASE IF EXISTS golden;
CREATE DATABASE golden;
SQL

echo "[00_flyway] V1+ 마이그레이션 실행 (dockerized flyway)"
docker run --rm \
  -v "$MIGRATIONS_DIR":/flyway/sql:ro \
  flyway/flyway:10-alpine \
  -url="jdbc:postgresql://${DB_HOST}:5432/golden" \
  -user="$DB_USER" -password="$DB_PASSWORD" \
  -connectRetries=5 \
  migrate

echo "[00_flyway] 완료 — flyway_schema_history:"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d golden -c \
  "SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;"
