#!/usr/bin/env bash
# 외부 DB를 건드리지 않고 최신 전체 마이그레이션 + 축소 시드 + JWT 계약을 검증한다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
NAME="loadtest-seed-check-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
node "$ROOT/loadtest/seed/10_dimensions.mjs" --scale 0.001 --out "$TMP/csv"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=local-contract-only -e POSTGRES_DB=golden \
  -v "$ROOT/server/data-api/src/main/resources/db/migration:/migration:ro" \
  -v "$ROOT/loadtest/seed:/seed:ro" -v "$TMP/csv:/csv:ro" \
  postgres:16-alpine -c shared_preload_libraries=pg_stat_statements >/dev/null
ready=false
for i in {1..30}; do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || { echo '임시 PostgreSQL 기동 실패' >&2; exit 1; }
docker exec "$NAME" sh -ec '
  for f in $(ls /migration/V*.sql | sort -V); do
    psql -U postgres -d golden -v ON_ERROR_STOP=1 -f "$f" > /tmp/migrate.log 2>&1 || { cat /tmp/migrate.log; exit 1; }
  done
  for table in occupations default_tags occupation_default_tags users groups items; do
    f=/csv/$table.csv
    cols=$(head -1 "$f")
    psql -U postgres -d golden -v ON_ERROR_STOP=1 -c "\copy $table ($cols) FROM '\''$f'\'' CSV HEADER"
  done
  psql -U postgres -d golden -f /seed/20_facts.sql -f /seed/30_constraints_indexes.sql -f /seed/95_verify.sql
  mkdir -p /tmp/export/seed/params
  cd /tmp/export
  psql -U postgres -d golden -f /seed/40_params_export.sql
'
docker cp "$NAME:/tmp/export/seed/params" "$TMP/params" >/dev/null
JWT_SECRET=local-contract-secret-at-least-32-bytes node "$ROOT/loadtest/seed/50_mint_jwt.mjs" "$TMP/params"
node --input-type=module - "$TMP/params" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
const users=JSON.parse(readFileSync(`${process.argv[2]}/users_uniform.json`));
assert(users.length > 0);
for (const user of users) {
  const [header,payload,signature]=user.token.split('.');
  const claims=JSON.parse(Buffer.from(payload,'base64url'));
  assert.equal(claims.sub,user.userId);
  assert.equal(claims.guest,user.isGuest);
  assert.equal(claims.sid,user.sessionId);
  assert.equal(claims.gen,0);
  assert.equal(claims.type,'access');
  assert.equal(signature,createHmac('sha256','local-contract-secret-at-least-32-bytes').update(`${header}.${payload}`).digest('base64url'));
}
console.log(`시드/JWT 계약 검증 완료: ${users.length}명`);
JS
