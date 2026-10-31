#!/usr/bin/env bash
# 각 VM의 v2 데이터 디스크가 지정된 마운트 지점인지 확인한다.
set -euo pipefail
case "${1:-}" in
  data|redis) role=$1 ;;
  *) printf '사용법: %s data|redis\n' "$0" >&2; exit 2 ;;
esac
mount_dir=/var/lib/catus-dev-v2
expected="/dev/disk/by-id/google-catus-dev-v2-${role}-data"
if ! mountpoint -q "$mount_dir"; then
  printf 'v2 데이터 디스크가 %s에 마운트되지 않았습니다.\n' "$mount_dir" >&2
  exit 1
fi
if [ ! -e "$expected" ]; then
  printf '예상 디스크 장치가 없습니다: %s\n' "$expected" >&2
  exit 1
fi
actual=$(findmnt -n -o SOURCE --mountpoint "$mount_dir")
actual_device=$(readlink -f "$actual")
expected_device=$(readlink -f "$expected")
if [ -z "$actual_device" ] || [ "$actual_device" != "$expected_device" ]; then
  printf '마운트된 디스크가 v2 %s 데이터 디스크와 다릅니다.\n' "$role" >&2
  exit 1
fi
