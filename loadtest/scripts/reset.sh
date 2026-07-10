#!/usr/bin/env bash
# make reset — loadtest DB 를 golden 에서 재복제 (분 단위, 파일 수준 복사)
. "$(dirname "$0")/common.sh"

log "loadtest ← golden TEMPLATE 복제"
obs_psql postgres '-f ~/seed/reset.sql'
log "완료 — 다음: make app-up (SUT 가 새 DB 에 접속)"
