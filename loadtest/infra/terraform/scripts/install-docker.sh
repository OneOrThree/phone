#!/usr/bin/env bash
# VM 공통 startup script — docker + compose 플러그인 설치 (멱등)
set -euo pipefail

if command -v docker >/dev/null 2>&1; then
  exit 0
fi

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
