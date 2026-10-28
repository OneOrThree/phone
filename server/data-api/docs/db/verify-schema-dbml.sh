#!/usr/bin/env bash
#
# schema.dbml 이 «실제 스키마»와 어긋났는지 확인한다 (GROMO-1912).
#
# ── 왜 이렇게 하는가 ──────────────────────────────────────────────────────────
# 문서끼리 비교하면 또 문서를 믿는 것이 된다. 그래서 한쪽은 반드시 실물이어야 한다 —
# 마이그레이션을 «빈 postgres 에 전부 적용»해서 뜬 스키마를 정답으로 놓고 dbml 을 대조한다.
#
# 기본 CI 컨텍스트는 create-drop을 쓰므로 이 검사는 별도로 V0를 실제 적용한다.
#
# ── 쓰는 법 ──────────────────────────────────────────────────────────────────
#   ./verify-schema-dbml.sh            # 대조만
#   ./verify-schema-dbml.sh --keep     # 끝나고 DB 를 남긴다(직접 들여다볼 때)
#
# 필요한 것: docker. 그 외 설치 없음(psql·flyway 모두 컨테이너로 돈다).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$HERE/../../src/main/resources/db/v0" && pwd)"
DBML="$HERE/schema.dbml"
CONTAINER="schema-dbml-audit-$$"
KEEP=0
WORK="$(mktemp -d)"
[ "${1:-}" = "--keep" ] && KEEP=1

cleanup() {
  if [ "$KEEP" -ne 1 ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

echo "① 빈 postgres 를 띄운다"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=audit \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U ci -d audit >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U ci -d audit >/dev/null

echo "② 마이그레이션을 전부 적용한다"
docker run --rm --network "container:$CONTAINER" -v "$MIGRATIONS":/flyway/sql flyway/flyway:10-alpine \
  -url="jdbc:postgresql://localhost:5432/audit" -user=ci -password=ci \
  -connectRetries=10 migrate | tail -1

echo "③ 실제 스키마를 뜬다"
Q() { docker exec -i "$CONTAINER" psql -U ci -d audit -At -F '|' -c "$1"; }
Q "SELECT c.relname, a.attname,
          replace(replace(replace(format_type(a.atttypid, a.atttypmod),
              'character varying', 'varchar'),
              'timestamp with time zone', 'timestamptz'),
              'timestamp without time zone', 'timestamp'),
          CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,
          COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
     LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'flyway_schema_history'
    ORDER BY c.relname, a.attnum;" > "$WORK/real_columns.txt"
# 복합 FK의 순서와 제약 단위를 보존한다. 컬럼별 행으로 분리하면 복합 FK를 단일 FK로
# 잘못 적어도 비교가 통과하므로, 제약마다 컬럼 이름을 순서대로 모아 한 행에 적는다.
Q "SELECT child.relname, string_agg(ca.attname, ',' ORDER BY ck.ordinality),
          parent.relname, string_agg(pa.attname, ',' ORDER BY ck.ordinality),
          CASE fk.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END
     FROM pg_constraint fk
     JOIN pg_class child ON child.oid=fk.conrelid
     JOIN pg_namespace n ON n.oid=child.relnamespace
     JOIN pg_class parent ON parent.oid=fk.confrelid
     JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY ck(attnum, ordinality) ON true
     JOIN LATERAL unnest(fk.confkey) WITH ORDINALITY pk(attnum, ordinality)
       ON pk.ordinality=ck.ordinality
     JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=ck.attnum
     JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=pk.attnum
    WHERE fk.contype='f' AND n.nspname='public'
    GROUP BY fk.oid, child.relname, parent.relname, fk.confdeltype
    ORDER BY child.relname, fk.oid;" > "$WORK/real_fks.txt"

echo "④ dbml 과 대조한다"
SCRATCH="$WORK" DBML_PATH="$DBML" python3 "$HERE/compare-schema-dbml.py"

[ "$KEEP" -eq 1 ] && echo "스키마 입력: $WORK · DB 를 남겼다: docker exec -it $CONTAINER psql -U ci -d audit   (지울 때 docker rm -f $CONTAINER)"
exit 0
