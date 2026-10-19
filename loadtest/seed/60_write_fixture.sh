#!/usr/bin/env bash
# 쓰기 시나리오 slot fixture 준비 — 로컬 격리 스택(infra/local/compose.yml)에만 쓴다. 운영·dev 서버 금지.
# 순서: ① accounts(공개 API) ② SQL(회원 전환·친구·전망대) ③ join(공개 API). 결과: $PARAMS_DIR/write_fixture.json
# 사용: SLOTS=50 loadtest/seed/60_write_fixture.sh   (URL 기본 http://localhost:18088)
set -euo pipefail
LT="$(cd "$(dirname "$0")/.." && pwd)"
PARAMS_DIR="${PARAMS_DIR:-$LT/.local/params}"
URL="${URL:-http://localhost:18088}"
SLOTS="${SLOTS:-50}"
case "$URL" in http://localhost:*|http://127.0.0.1:*) ;; *) echo "로컬 스택(localhost)만 허용합니다: $URL" >&2; exit 2;; esac
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
node "$LT/seed/60_write_fixture.mjs" --phase accounts --url "$URL" --out "$PARAMS_DIR" --slots "$SLOTS"
node --input-type=module - "$PARAMS_DIR/write_fixture.json" "$LT/seed/60_write_fixture.sql" > "$TMP" <<'JS'
import fs from 'node:fs';
const slots = JSON.parse(fs.readFileSync(process.argv[2]));
const uuid = /^[0-9a-f-]{36}$/;
const rows = slots.map((s) => [s.actor.userId, s.partner.userId, s.islandId, s.hubIslandId]);
if (rows.flat().some((v) => !uuid.test(v))) throw new Error('UUID fixture 형식 오류');
console.log('CREATE TEMP TABLE write_slots (actor uuid, partner uuid, island uuid, hub uuid);');
console.log('COPY write_slots FROM STDIN CSV;');
for (const r of rows) console.log(r.join(','));
console.log('\\.');
console.log(fs.readFileSync(process.argv[3], 'utf8'));
JS
docker compose -f "$LT/infra/local/compose.yml" exec -T db psql -U loadtest -d gromo -v ON_ERROR_STOP=1 < "$TMP"
node "$LT/seed/60_write_fixture.mjs" --phase join --url "$URL" --out "$PARAMS_DIR" --slots "$SLOTS"
