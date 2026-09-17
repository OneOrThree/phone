#!/usr/bin/env bash
#
# schema.dbml 이 «실제 스키마»와 어긋났는지 확인한다 (GROMO-1912).
#
# ── 왜 이렇게 하는가 ──────────────────────────────────────────────────────────
# 문서끼리 비교하면 또 문서를 믿는 것이 된다. 그래서 한쪽은 반드시 실물이어야 한다 —
# 마이그레이션을 «빈 postgres 에 전부 적용»해서 뜬 스키마를 정답으로 놓고 dbml 을 대조한다.
#
# CI 는 마이그레이션을 돌리지 않는다(create-drop + Flyway off). 그래서 이 대조는
# CI 가 대신해 주지 않는다 — 스키마를 건드린 뒤 사람이 직접 돌려야 한다.
#
# ── 쓰는 법 ──────────────────────────────────────────────────────────────────
#   ./verify-schema-dbml.sh            # 대조만
#   ./verify-schema-dbml.sh --keep     # 끝나고 DB 를 남긴다(직접 들여다볼 때)
#
# 필요한 것: docker. 그 외 설치 없음(psql·flyway 모두 컨테이너로 돈다).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$HERE/../../src/main/resources/db/migration" && pwd)"
DBML="$HERE/schema.dbml"
CONTAINER="schema-dbml-audit"
PORT=55433
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() { [ "$KEEP" -eq 1 ] || docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "① 빈 postgres 를 띄운다"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=audit \
  -p "$PORT":5432 postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U ci -d audit >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U ci -d audit >/dev/null

echo "② 마이그레이션을 전부 적용한다"
docker run --rm --network host -v "$MIGRATIONS":/flyway/sql flyway/flyway:10-alpine \
  -url="jdbc:postgresql://localhost:$PORT/audit" -user=ci -password=ci \
  -connectRetries=10 migrate | tail -1

echo "③ 실제 스키마를 뜬다"
WORK="$(mktemp -d)"
Q() { docker exec -i "$CONTAINER" psql -U ci -d audit -At -F '|' -c "$1"; }
Q "SELECT c.table_name, c.column_name,
          CASE WHEN c.data_type='character varying' THEN 'varchar('||c.character_maximum_length||')'
               WHEN c.data_type='timestamp with time zone' THEN 'timestamptz'
               WHEN c.data_type='timestamp without time zone' THEN 'timestamp'
               ELSE c.data_type END,
          c.is_nullable, COALESCE(c.column_default,'')
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_name=c.table_name AND t.table_schema=c.table_schema
    WHERE c.table_schema='public' AND t.table_type='BASE TABLE'
      AND c.table_name <> 'flyway_schema_history'
    ORDER BY c.table_name, c.ordinal_position;" > "$WORK/real_columns.txt"
# ⚠️ constraint_column_usage 로 부모 컬럼을 뽑으면 «복합 FK 가 카테시안 곱»이 된다.
#    (challenge_id, category) → (id, category) 짝이 2×2 = 4줄이 되어 존재하지 않는
#    `challenge_id → category` 가 만들어졌다. 부모 쪽은 position_in_unique_constraint 로
#    열 순서를 맞춰야 한다.
Q "SELECT tc.table_name, kcu.column_name, pk.table_name, pk.column_name, rc.delete_rule
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name=tc.constraint_name AND kcu.constraint_schema=tc.constraint_schema
     JOIN information_schema.referential_constraints rc
       ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.constraint_schema
     JOIN information_schema.key_column_usage pk
       ON pk.constraint_name=rc.unique_constraint_name
      AND pk.constraint_schema=rc.unique_constraint_schema
      AND pk.ordinal_position=kcu.position_in_unique_constraint
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
    ORDER BY tc.table_name, kcu.column_name;" > "$WORK/real_fks.txt"

echo "④ dbml 과 대조한다"
SCRATCH="$WORK" DBML_PATH="$DBML" python3 "$HERE/compare-schema-dbml.py"

[ "$KEEP" -eq 1 ] && echo "DB 를 남겼다: docker exec -it $CONTAINER psql -U ci -d audit   (지울 때 docker rm -f $CONTAINER)"
exit 0
