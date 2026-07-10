#!/usr/bin/env bash
# 차원 테이블 \copy — FK 위상 순서 준수 (관측 VM 에서 실행, CSV 는 ~/seed/csv/)
set -euo pipefail

DB_HOST="${DB_HOST:?}"
DB_USER="${DB_USER:-loadtest}"
DB_PASSWORD="${DB_PASSWORD:?}"
CSV_DIR="${CSV_DIR:-$HOME/seed/csv}"

PSQL=(psql -h "$DB_HOST" -U "$DB_USER" -d golden -v ON_ERROR_STOP=1)
export PGPASSWORD="$DB_PASSWORD"

copy() { # copy <table> <columns>
  echo "[15_copy] $1"
  "${PSQL[@]}" -c "\\copy $1 ($2) FROM '${CSV_DIR}/$1.csv' WITH (FORMAT csv, HEADER true, NULL '')"
}

copy occupations "code,display_name,created_at"
copy default_tags "id,name,created_at"
copy occupation_default_tags "id,occupation,sort_order,created_at,default_tag_id"
copy league_tier_configs "tier_level,arena_size,badge_id,promote_count,relegate_count,relegate_warning_count,created_at"
copy users "id,is_guest,nickname,country_code,occupation,stat_visibility,device_token,refresh_token,created_at,updated_at,is_deleted,last_active_at"
copy groups "id,name,description,password,host_id,max_members,status,bet_type,is_chat_enabled,chat_limit_per_person,invite_permission,notice_permission,started_at,ended_at,created_at,deleted_at,version"
copy items "id,name,item_type,grade,slot_type,payment_type,currency_price,premium_price,asset_url,is_active,created_at"

echo "[15_copy] 완료"
