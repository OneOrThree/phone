#!/usr/bin/env bash
# 친구 준비에서 token/사용자 불일치나 비UUID SQL 입력은 DB 접속 전에 차단한다.
set -euo pipefail
DIR=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
cat > "$tmp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
printf called >> "$GUARD_MARKER"
exit 99
MOCK
chmod +x "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH" GUARD_MARKER="$tmp/marker" SMOKE_DB_CONTAINER='guard-test' SMOKE_FRIEND_CONTEXT_FILE="$tmp/context.json"
node - "$SMOKE_FRIEND_CONTEXT_FILE" <<'NODE'
const fs=require('node:fs');
const user='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222';
const jwt=(sub,sid)=>'header.'+Buffer.from(JSON.stringify({sub,sid})).toString('base64url')+'.sig';
fs.writeFileSync(process.argv[2],JSON.stringify({userId:user,peerUserId:peer,islandId:user,accessToken:jwt(peer,user),peerAccessToken:jwt(peer,peer)}));
NODE
"$DIR/prepare-friendship.sh" > "$tmp/out" 2>&1 && { echo '사용자 일치 guard 실패'; exit 1; }
[[ ! -e "$GUARD_MARKER" ]]
node - "$SMOKE_FRIEND_CONTEXT_FILE" <<'NODE'
const fs=require('node:fs');const c=JSON.parse(fs.readFileSync(process.argv[2]));
c.accessToken='header.'+Buffer.from(JSON.stringify({sub:c.userId,sid:"x';DELETE FROM users;--"})).toString('base64url')+'.sig';
fs.writeFileSync(process.argv[2],JSON.stringify(c));
NODE
"$DIR/prepare-friendship.sh" > "$tmp/out" 2>&1 && { echo 'UUID guard 실패'; exit 1; }
[[ ! -e "$GUARD_MARKER" ]]
echo 'friendship 사용자 / UUID 사전 접속 차단 PASS'
