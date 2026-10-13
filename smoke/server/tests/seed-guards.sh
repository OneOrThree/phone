#!/usr/bin/env bash
# DB 변경 도구에 잘못된 식별자를 전달해도 접속조차 하지 않는지 확인한다.
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
export PATH="$tmp/bin:$PATH" GUARD_MARKER="$tmp/marker" SMOKE_DB_CONTAINER='guard-test'
uuid='11111111-1111-4111-8111-111111111111'
export SMOKE_CORE_USER_ID="$uuid" SMOKE_CORE_ISLAND_ID="$uuid" SMOKE_CORE_SESSION_ID="$uuid" SMOKE_CORE_DEVICE_ID="$uuid" SMOKE_CORE_FIXTURE_NAME="smoke-core-$uuid"
SMOKE_CORE_USER_ID="x'; DELETE FROM users; --" "$DIR/seed-core-flow.sh" > "$tmp/out" 2>&1 && { echo 'UUID guard 실패'; exit 1; }
[[ ! -e "$GUARD_MARKER" ]]
SMOKE_CORE_FIXTURE_NAME='real-user-island' "$DIR/seed-core-flow.sh" > "$tmp/out" 2>&1 && { echo 'fixture guard 실패'; exit 1; }
[[ ! -e "$GUARD_MARKER" ]]
SMOKE_FIXTURE_MODE='unknown' "$DIR/seed-core-flow.sh" > "$tmp/out" 2>&1 && { echo 'mode guard 실패'; exit 1; }
[[ ! -e "$GUARD_MARKER" ]]
echo 'seed UUID / fixture / mode 사전 접속 차단 PASS'
