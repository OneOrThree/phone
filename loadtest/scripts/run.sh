#!/usr/bin/env bash
# make run — k6 2회 실행 구조 (설계 §상세4-3):
#   ① 워밍업(판정·요약 제외) → ② pg_stat_statements 리셋 → ③ 본측정
#   리셋 경계를 프로세스 경계에 맞춰 "매트릭스 run 의 pg_stat 델타 = 그 API 의 쿼리 프로필"을
#   순수하게 유지한다. k6 exit≠0 이라도 collect 는 진행 — 판정은 verdict 소관.
. "$(dirname "$0")/common.sh"
LT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PROFILE="${PROFILE:-smoke}"
TARGET="${TARGET:-scenarios/daily_mix.js}"
# 고급 설정 override — 빈값이면 k6 프로파일이 __ENV.RATE/DURATION 대신 기본값 사용
RATE="${RATE:-}"
DURATION="${DURATION:-}"
# 셸 인젝션 방지: RATE/DURATION 은 workflow_dispatch 자유 문자열이라 vm_ssh 원격 명령에 보간되기 전
# 숫자·시간단위(s/m/h)만 허용해 메타문자(; ` $() 등)를 차단한다. 빈값 허용(프로파일 기본).
[[ "$RATE" =~ ^[0-9]*$ ]] || { log "invalid RATE (숫자만 허용): '$RATE'"; exit 1; }
[[ "$DURATION" =~ ^[0-9smh]*$ ]] || { log "invalid DURATION (예: 5m·90s): '$DURATION'"; exit 1; }
REPORT_DIR="${REPORT_DIR:?Makefile 이 주입}"
mkdir -p "$REPORT_DIR"

SUT_IP=$(ip_of sut)
OBS_IP=$(ip_of obs)
K6_IMAGE="grafana/k6:0.54.0"

log "부하 VM 스테이징 (스크립트 scp + params from GCS)"
vm_ssh loadgen 'rm -rf ~/k6run && mkdir -p ~/k6run/params ~/k6run/out && chmod 777 ~/k6run/out'
vm_scp "$LT_DIR/k6" loadgen:~/k6run/scripts
vm_ssh loadgen "gcloud storage cp -r 'gs://${PROJECT_ID}-params/${SEED_VERSION}/*' ~/k6run/params/ -q"

K6_BASE="sudo docker run --rm \
  -v \$HOME/k6run/scripts:/scripts:ro -v \$HOME/k6run/params:/params:ro -v \$HOME/k6run/out:/out \
  -e PARAMS_DIR=/params -e BASE_URL=http://${SUT_IP}:8080"

date -u +%Y-%m-%dT%H:%M:%SZ > "$REPORT_DIR/.started_at"

log "① 워밍업 2분 (판정·요약 제외)"
vm_ssh loadgen "$K6_BASE -e PROFILE=warmup $K6_IMAGE run --no-thresholds --no-summary /scripts/$TARGET" \
  || { "$(dirname "$0")/loadgen.sh" alive || { log "⚠️ 부하 VM 소실 — spot 선점 의심"; touch "$REPORT_DIR/.preempted"; exit 0; }; log "⚠️ 워밍업 비정상 종료 — 계속 진행"; }

# 인자 없는 reset() 은 클러스터 전체(모든 DB) 통계를 리셋한다 — 이 SQL 인스턴스가 loadtest
# 전용이라 실질 영향은 없음(#183 리뷰). 본측정 델타의 0점.
log "② pg_stat_statements 리셋 (인스턴스 전체 — loadtest 전용이라 무방)"
obs_psql loadtest '-c "SELECT pg_stat_statements_reset();"'

log "③ 본측정 (PROFILE=$PROFILE TARGET=$TARGET)"
K6_EXIT=0
vm_ssh loadgen "$K6_BASE \
  -e PROFILE=$PROFILE -e RATE=$RATE -e DURATION=$DURATION -e SUMMARY_PATH=/out/summary.json \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://${OBS_IP}:9090/api/v1/write \
  -e K6_PROMETHEUS_RW_TREND_STATS='p(95),p(99),avg,max' \
  $K6_IMAGE run -o experimental-prometheus-rw /scripts/$TARGET" || K6_EXIT=$?

date -u +%Y-%m-%dT%H:%M:%SZ > "$REPORT_DIR/.ended_at"
echo "$K6_EXIT" > "$REPORT_DIR/.k6_exit"

if [ "$K6_EXIT" -ne 0 ] && ! "$(dirname "$0")/loadgen.sh" alive; then
  log "⚠️ 본측정 중 부하 VM 소실 — spot 선점 의심 (verdict=INVALID 예정)"
  touch "$REPORT_DIR/.preempted"
fi
log "run 종료 (k6 exit=$K6_EXIT — 99 는 threshold 초과이며 collect·verdict 로 판정)"
