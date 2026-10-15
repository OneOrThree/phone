#!/usr/bin/env bash
# 게스트 공개 친구 생성은 정책상 금지다. TC016 준비만 신규 전용 계정 둘에 제한해서 SQL로 수행.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
: "${SMOKE_FRIEND_CONTEXT_FILE:?비공개 친구 context 파일 경로가 필요합니다}"
[[ -f "$SMOKE_FRIEND_CONTEXT_FILE" && ! -L "$SMOKE_FRIEND_CONTEXT_FILE" ]] || { echo '친구 context 파일 오류' >&2; exit 1; }
umask 077
# token은 argv/stdout에 보내지 않고 비공개 파일에서 서명 payload의 sid만 추출한다.
identities=$(node - "$SMOKE_FRIEND_CONTEXT_FILE" <<'NODE'
const fs = require('node:fs');
try {
  const c=JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const a=JSON.parse(Buffer.from(c.accessToken.split('.')[1],'base64url'));
  const b=JSON.parse(Buffer.from(c.peerAccessToken.split('.')[1],'base64url'));
  if (a.sub!==c.userId || b.sub!==c.peerUserId) throw Error('identity');
  process.stdout.write([c.userId,c.peerUserId,c.islandId,a.sid,b.sid].join('\n'));
} catch { process.exit(1); }
NODE
) || { echo '친구 로그인 context 대조 실패' >&2; exit 1; }
args=(-X -q -t -A -v ON_ERROR_STOP=1)
index=0
while IFS= read -r value; do
  [[ "$value" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo '친구 fixture UUID 오류' >&2; exit 1; }
  case "$index" in
    0) args+=(-v "user_id=$value");;
    1) args+=(-v "peer_id=$value");;
    2) args+=(-v "island_id=$value");;
    3) args+=(-v "session_id=$value");;
    4) args+=(-v "peer_session_id=$value");;
  esac
  index=$((index+1))
done <<< "$identities"
[[ "$index" == 5 ]] || { echo '친구 fixture 식별자 누락' >&2; exit 1; }
if [[ -n "${SMOKE_DB_CONTAINER:-}" ]]; then
  docker exec -i "$SMOKE_DB_CONTAINER" psql -U "${SMOKE_DB_USER:-postgres}" -d "${SMOKE_DB_NAME:-phone}" "${args[@]}" < "$SCRIPT_DIR/seed-friendship.sql"
elif [[ -n "${SMOKE_DATABASE_URL:-}" ]]; then
  PGDATABASE="$SMOKE_DATABASE_URL" psql "${args[@]}" < "$SCRIPT_DIR/seed-friendship.sql"
else
  echo '내부 DB 설정 필요: SMOKE_DB_CONTAINER 또는 SMOKE_DATABASE_URL' >&2
  exit 1
fi
