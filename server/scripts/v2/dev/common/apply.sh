#!/usr/bin/env bash
# 데이터 디스크와 호스트 잠금을 확인한 뒤 선택한 runtime만 적용한다.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
role=${1:-}
case "$role" in
  kafka) host_role=data; files=(-f "$root/kafka/compose.yml"); services=(kafka) ;;
  postgres) host_role=data; files=(-f "$root/postgres/compose.yml"); services=(postgres) ;;
  redis-shared) host_role=redis; files=(-f "$root/redis/shared.yml"); services=(shared) ;;
  redis-business) host_role=redis; files=(-f "$root/redis/business.yml"); services=(business) ;;
  redis-all) host_role=redis; files=(-f "$root/redis/shared.yml" -f "$root/redis/business.yml"); services=(shared business) ;;
  *) printf '사용법: %s kafka|postgres|redis-shared|redis-business|redis-all\n' "$0" >&2; exit 2 ;;
esac
# Kafka와 PostgreSQL은 같은 VM이므로 같은 잠금을 사용한다.
exec 9>"/run/lock/catus-dev-v2-${host_role}.lock"
flock -n 9 || { echo '같은 호스트의 배포가 진행 중입니다.' >&2; exit 1; }
"$root/common/verify-data-mount.sh" "$host_role"
if [[ "$role" = kafka ]]; then
  # 공식 Kafka 이미지의 appuser uid/gid. 디스크 내 기존 파일은 건드리지 않는다.
  install -d -m 0750 -o 1000 -g 1000 /var/lib/catus-dev-v2/kafka
fi
docker compose "${files[@]}" config --quiet
docker compose "${files[@]}" up -d --no-deps --wait --wait-timeout 300 "${services[@]}"
