#!/usr/bin/env bash
# golden DB 스키마 구성 — 앱 부팅 없이 dockerized Flyway CLI 로 V1~최신 마이그레이션 전부 실행.
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
export PGPASSWORD="$DB_PASSWORD"
PSQL=(psql -h "$DB_HOST" -U "$DB_USER" -d postgres)
# 재시드 시 기존 golden 회수 — Cloud SQL 은 superuser 가 없어 pg_database 직접 UPDATE 가 거부된다.
# owner 권한으로 되는 ALTER DATABASE 로 처리. 첫 실행엔 golden 이 없으니 ALTER 는 무시.
"${PSQL[@]}" -c "ALTER DATABASE golden IS_TEMPLATE false" 2>/dev/null || true
# 새 접속을 막고(ALLOW_CONNECTIONS false) 기존 세션을 강제 종료 — 끊긴 seed 의 좀비 psql 연결이
# 남아 있으면 "being accessed by other users" 로 DROP 이 실패한다.
"${PSQL[@]}" -c "ALTER DATABASE golden WITH ALLOW_CONNECTIONS false" 2>/dev/null || true
"${PSQL[@]}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='golden' AND pid <> pg_backend_pid()" 2>/dev/null || true
"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS golden"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE golden"

echo "[00_flyway] V1+ 마이그레이션 실행 (dockerized flyway)"
# OS Login 사용자는 docker 그룹이 아니라 소켓 접근에 sudo 필요 (VM 은 sudo 무암호 허용)
sudo docker run --rm \
  -v "$MIGRATIONS_DIR":/flyway/sql:ro \
  flyway/flyway:10-alpine \
  -url="jdbc:postgresql://${DB_HOST}:5432/golden" \
  -user="$DB_USER" -password="$DB_PASSWORD" \
  -connectRetries=5 \
  migrate

echo "[00_flyway] 완료 — flyway_schema_history:"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d golden -c \
  "SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;"
