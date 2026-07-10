#!/usr/bin/env bash
# make down — 과금 차단: VM 중지 + Cloud SQL activation NEVER. (compose 는 VM 재시작 시
# restart:unless-stopped 로 되살아나므로 내리지 않는다. 부하 VM 은 loadgen.sh down 소관.)
. "$(dirname "$0")/common.sh"

for vm in sut obs; do
  if [ "$(vm_status "$vm")" = "RUNNING" ]; then
    log "$vm VM 중지"
    gcloud compute instances stop "$vm" --zone="$ZONE" --project="$PROJECT_ID" --quiet
  fi
done

log "Cloud SQL 중지 (activation-policy=NEVER)"
gcloud sql instances patch "$SQL_INSTANCE" --project="$PROJECT_ID" --activation-policy=NEVER --quiet || true

log "완료 — 유휴 비용은 디스크·SQL 스토리지 수준"
