#!/usr/bin/env bash
# run 파이프라인 공용 헬퍼 — Makefile/scripts 가 source. DB·VM 접근은 전부 IAP 터널.
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID 를 지정하세요 (예: make test PROJECT_ID=gromo-loadtest-1)}"
ZONE="${ZONE:-asia-northeast3-c}" # a존 stockout 연쇄(07-11~13)로 이동 — terraform variables.tf 와 함께 변경
REGION="${REGION:-asia-northeast3}"
SQL_INSTANCE="${SQL_INSTANCE:-loadtest-pg}"
SEED_VERSION="${SEED_VERSION:-seed-v1}"

log() { printf '\n[%s] %s\n' "$(basename "${BASH_SOURCE[1]:-run}")" "$*"; }

vm_ssh() { # vm_ssh <vm> <command…>
  local vm=$1; shift
  gcloud compute ssh "$vm" --zone="$ZONE" --tunnel-through-iap --project="$PROJECT_ID" --command="$*"
}
vm_scp() { gcloud compute scp --zone="$ZONE" --tunnel-through-iap --project="$PROJECT_ID" --recurse "$@"; }

ip_of() { # 내부 IP
  gcloud compute instances describe "$1" --zone="$ZONE" --project="$PROJECT_ID" \
    --format='value(networkInterfaces[0].networkIP)'
}

vm_status() { # RUNNING|TERMINATED|ABSENT
  gcloud compute instances describe "$1" --zone="$ZONE" --project="$PROJECT_ID" \
    --format='value(status)' 2>/dev/null || echo ABSENT
}

wait_ssh() { # startup script(docker 설치)까지 기다림
  local vm=$1 tries=0
  until vm_ssh "$vm" 'command -v docker >/dev/null' 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -ge 30 ] && { log "❌ $vm ssh/docker 대기 초과"; return 1; }
    sleep 10
  done
}

# 관측 VM 경유 psql (시크릿은 VM 이 vm_env.sh 로 자체 조회 — 인라인 인용에 안 실림)
obs_psql() { # obs_psql <db> <psql args…>
  local db=$1; shift
  vm_ssh obs ". ~/seed/vm_env.sh && psql -h \"\$DB_HOST\" -U \"\$DB_USER\" -v ON_ERROR_STOP=1 -d $db $*"
}
