#!/usr/bin/env bash
# v2 PostgreSQL의 로컬 쿼리를 확인한다.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
"$root/common/verify-data-mount.sh" data
docker exec catus-dev-postgres-v2-postgres-1 sh -c 'psql -X -q -U "$POSTGRES_USER" -d postgres -Atc "SELECT 1"' | grep -qx 1
