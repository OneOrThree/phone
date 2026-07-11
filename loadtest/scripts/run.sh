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
# RECIPES: matrix/_generic.js 가 콤마구분 목록으로 읽어 open(../recipes/<name>.json). 경로주입 방지로 영숫자/_/-/, 만 허용.
RECIPES="${RECIPES:-}"
[[ "$RECIPES" =~ ^[a-zA-Z0-9_,-]*$ ]] || { log "invalid RECIPES (영숫자·_·-·, 만): '$RECIPES'"; exit 1; }
# SCENARIO: scenarios/_generic.js 가 open(./defs/<SCENARIO>.json). 경로주입 방지로 영숫자/_/- 만.
SCENARIO="${SCENARIO:-}"
[[ "$SCENARIO" =~ ^[a-zA-Z0-9_-]*$ ]] || { log "invalid SCENARIO (영숫자·_·- 만): '$SCENARIO'"; exit 1; }
# SPOTS: 다중 loadgen 분산은 미구현 — loadgen.sh/run.sh 는 단일 'loadgen' VM 만 생성·사용한다.
# SPOTS>1 을 조용히 1대로 처리하면 부하기 포화(CPU 가드)로 무효 결과를 '분산 결과'로 오인하게 되므로
# 명시적으로 차단한다(실제 N-VM 분산은 GROMO-750 후속). 대시보드의 spot N 선택도 이 가드에 걸린다.
SPOTS="${SPOTS:-1}"
[[ "$SPOTS" =~ ^[0-9]+$ ]] || { log "invalid SPOTS (숫자만): '$SPOTS'"; exit 1; }
[ "$SPOTS" -le 1 ] || { log "❌ SPOTS>1(다중 loadgen 분산)은 미구현 — 현재 단일 VM 만 지원. SPOTS=1 로 실행하세요."; exit 1; }
REPORT_DIR="${REPORT_DIR:?Makefile 이 주입}"
mkdir -p "$REPORT_DIR"

SUT_IP=$(ip_of sut)
OBS_IP=$(ip_of obs)
K6_IMAGE="grafana/k6:0.54.0"

log "부하 VM 스테이징 (스크립트 scp + params from GCS)"
vm_ssh loadgen 'rm -rf ~/k6run && mkdir -p ~/k6run/params ~/k6run/out && chmod 777 ~/k6run/out'
vm_scp "$LT_DIR/k6" loadgen:~/k6run/scripts
vm_ssh loadgen "gcloud storage cp -r 'gs://${PROJECT_ID}-params/${SEED_VERSION}/*' ~/k6run/params/ -q"

# 부하기 CPU 가드용 node-exporter — prometheus 의 loadgen 잡(:9100)을 스크레이프해 collect 가 부하기 CPU 를
# 읽는다(부하기가 SUT 보다 먼저 포화되면 verdict=INVALID). loadgen 은 run 마다 새 VM 이라 매번 기동해야 하며,
# 없으면 loadgenMaxCpu=-1 로 항상 INVALID 가 된다. SUT compose 의 node-exporter 와 동일 핀(v1.8.2).
vm_ssh loadgen "sudo docker rm -f node-exporter 2>/dev/null; sudo docker run -d --name node-exporter --restart=unless-stopped --net=host --pid=host -v /:/host:ro,rslave prom/node-exporter:v1.8.2 --path.rootfs=/host"

K6_BASE="sudo docker run --rm \
  -v \$HOME/k6run/scripts:/scripts:ro -v \$HOME/k6run/params:/params:ro -v \$HOME/k6run/out:/out \
  -e PARAMS_DIR=/params -e BASE_URL=http://${SUT_IP}:8080"

date -u +%Y-%m-%dT%H:%M:%SZ > "$REPORT_DIR/.started_at"

log "① 워밍업 2분 (판정·요약 제외)"
vm_ssh loadgen "$K6_BASE -e PROFILE=warmup -e RECIPES=$RECIPES -e SCENARIO=$SCENARIO $K6_IMAGE run --no-thresholds --no-summary /scripts/$TARGET" \
  || { "$(dirname "$0")/loadgen.sh" alive || { log "⚠️ 부하 VM 소실 — spot 선점 의심"; touch "$REPORT_DIR/.preempted"; exit 0; }; log "⚠️ 워밍업 비정상 종료 — 계속 진행"; }

# 인자 없는 reset() 은 클러스터 전체(모든 DB) 통계를 리셋한다 — 이 SQL 인스턴스가 loadtest
# 전용이라 실질 영향은 없음(#183 리뷰). 본측정 델타의 0점.
log "② pg_stat_statements 리셋 (인스턴스 전체 — loadtest 전용이라 무방)"
obs_psql loadtest '-c "SELECT pg_stat_statements_reset();"'

log "③ 본측정 (PROFILE=$PROFILE TARGET=$TARGET)"
K6_EXIT=0
vm_ssh loadgen "$K6_BASE \
  -e PROFILE=$PROFILE -e RATE=$RATE -e DURATION=$DURATION -e RECIPES=$RECIPES -e SCENARIO=$SCENARIO -e SUMMARY_PATH=/out/summary.json \
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
