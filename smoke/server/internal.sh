#!/usr/bin/env bash
# 내부 서비스·Redis 검사는 공개 API 검사와 같은 결과 형식으로 기록한다.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/internal.py" "$@"
