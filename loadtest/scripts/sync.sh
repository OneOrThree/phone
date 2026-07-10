#!/usr/bin/env bash
# make sync — 레포(진실 원천)의 관측·기동 설정을 VM 에 반영.
#   obs: compose·grafana provisioning·대시보드(repo 재사용+loadtest)·렌더된 prometheus.yml·vm_env.sh
#   sut: compose·fetch-env.sh
. "$(dirname "$0")/common.sh"
LT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

SUT_IP=$(ip_of sut)
# 부하 VM 은 run 마다 재생성 — 존별 내부 DNS 는 이름 기준이라 재생성에도 안정
LOADGEN_HOST="loadgen.${ZONE}.c.${PROJECT_ID}.internal"

log "obs 설정 반영 (SUT=${SUT_IP}, LOADGEN=${LOADGEN_HOST})"
TMP=$(mktemp)
SUT_HOST="$SUT_IP" LOADGEN_HOST="$LOADGEN_HOST" \
  envsubst '$SUT_HOST $LOADGEN_HOST' < "$LT_DIR/infra/obs/prometheus-loadtest.yml.tpl" > "$TMP"

vm_ssh obs 'mkdir -p ~/obs/dashboards/repo ~/obs/dashboards/loadtest ~/seed'
vm_scp "$TMP" obs:~/obs/prometheus.yml
# prometheus 컨테이너는 nobody 로 실행 — mktemp(0600) 유래 config 를 못 읽어 crash-loop 하므로
# 원격에서 0644 로 강제(원격 umask/scp 모드보존 무관하게 확정).
vm_ssh obs 'chmod 644 ~/obs/prometheus.yml'
vm_scp "$LT_DIR/infra/obs/docker-compose.obs.yml" "$LT_DIR/infra/obs/grafana-provisioning" \
  "$LT_DIR/infra/fetch-env.sh" obs:~/obs/
vm_scp "$LT_DIR"/../observability/grafana/dashboards/*.json obs:~/obs/dashboards/repo/
vm_scp "$LT_DIR"/grafana/dashboards/*.json obs:~/obs/dashboards/loadtest/
# reset·검증·pg_stat 덤프가 seed 실행 여부와 무관하게 항상 가능하도록 운영 SQL 도 함께 배치
vm_scp "$LT_DIR/seed/vm_env.sh" "$LT_DIR/seed/reset.sql" "$LT_DIR/seed/95_verify.sql" obs:~/seed/
rm -f "$TMP"

log "sut 설정 반영"
vm_ssh sut 'mkdir -p ~/sut'
vm_scp "$LT_DIR/infra/sut/docker-compose.sut.yml" "$LT_DIR/infra/fetch-env.sh" sut:~/sut/

log "완료 — 반영은 make up (compose up -d) 이 적용"
