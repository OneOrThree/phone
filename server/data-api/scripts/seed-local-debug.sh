#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
db_container="${LOCAL_DB_CONTAINER:-phone-db-local}"

docker exec -i "$db_container" psql -v ON_ERROR_STOP=1 -U jajo -d tt_db \
  < "$script_dir/seed-local-debug.sql"

docker exec "$db_container" psql -U jajo -d tt_db -Atc \
  "select 'users=' || count(*)
    || ', focus_stats=' || (select count(*) from daily_focus_stats)
    || ', sessions=' || (select count(*) from focus_sessions)
    || ', friendships=' || (select count(*) from friendships)
    || ', groups=' || (select count(*) from groups)
    || ', announcements=' || (select count(*) from group_announcements)
    || ', ledger=' || (select count(*) from currency_transactions)
   from users"
