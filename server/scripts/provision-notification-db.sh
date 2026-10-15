#!/usr/bin/env bash
# 기존 Postgres 볼륨/RDS에 알림 database와 전용 계정을 준비한다. 운영 실행은 릴리즈 절차에서 수행한다.
set -euo pipefail

: "${PGHOST:?관리자 접속 호스트가 필요합니다}"
: "${PGUSER:?관리자 접속 계정이 필요합니다}"
: "${API_DB_USERNAME:?기존 Data API 전용 계정이 필요합니다}"
: "${CORE_DB_NAME:?기존 코어 database 이름이 필요합니다}"
: "${NOTI_DB_USERNAME:?알림 전용 계정이 필요합니다}"
: "${NOTI_DB_PASSWORD:?알림 전용 비밀번호가 필요합니다}"

# 비밀번호는 CLI 인수에 넣지 않는다. psql은 libpq의 PGPASSFILE/PGPASSWORD를 사용하고,
# SQL 파일의 \getenv가 알림 비밀번호를 읽는다. -X로 개인 psqlrc의 ECHO 설정도 배제한다.
task_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec psql -X --dbname=postgres --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse \
    --file="$task_script_dir/provision-notification-db.sql"
