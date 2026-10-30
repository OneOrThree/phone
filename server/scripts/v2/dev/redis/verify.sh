#!/usr/bin/env bash
# 비밀번호는 표준입력의 한 줄로만 받는다.
set -euo pipefail
role=${1:-}
case "$role" in
  shared) container=catus-dev-redis-v2-shared-1; user=realtime; prefix=movement:owner:dev-v2-probe ;;
  business) container=catus-dev-redis-v2-business-1; user=business; prefix=cache:business:dev-v2-probe ;;
  *) echo '사용법: verify.sh shared|business' >&2; exit 2 ;;
esac
IFS= read -r password
[[ -n "$password" ]] || { echo 'Redis 자격이 비어 있습니다.' >&2; exit 1; }
probe="${prefix}:$(cat /proc/sys/kernel/random/uuid)"
printf '%s\n' "$password" | docker exec -i "$container" sh -c '
  set -eu
  IFS= read -r REDISCLI_AUTH
  export REDISCLI_AUTH
  user=$1; probe=$2
  redis-cli -e --no-auth-warning --user "$user" ping | grep -qx PONG
  redis-cli -e --no-auth-warning --user "$user" set "$probe" ok EX 30 | grep -qx OK
  redis-cli -e --no-auth-warning --user "$user" get "$probe" | grep -qx ok
  redis-cli -e --no-auth-warning --user "$user" del "$probe" >/dev/null
  if redis-cli -e --no-auth-warning --user "$user" get catus-dev-v2-forbidden >/dev/null 2>&1; then
    echo "Redis ACL이 허용되지 않은 키를 차단하지 못했습니다." >&2
    exit 1
  fi
  if [ "$user" = realtime ]; then
    channel="chat:dev-v2-probe:$probe"
    output=$(mktemp)
    trap "unlink \"$output\"" EXIT
    timeout 10 redis-cli --raw --no-auth-warning --user "$user" subscribe "$channel" >"$output" &
    subscriber=$!
    sleep 2
    redis-cli -e --no-auth-warning --user "$user" publish "$channel" v2-probe | grep -qx 1
    wait "$subscriber" || true
    grep -qx v2-probe "$output"
  fi
' sh "$user" "$probe"
