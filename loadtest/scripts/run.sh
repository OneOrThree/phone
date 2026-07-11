#!/usr/bin/env bash
# make run — k6 2회 실행 구조 (설계 §상세4-3):
#   ① 워밍업(판정·요약 제외) → ② pg_stat_statements 리셋 → ③ 본측정
#   리셋 경계를 프로세스 경계에 맞춰 "매트릭스 run 의 pg_stat 델타 = 그 API 의 쿼리 프로필"을
#   순수하게 유지한다. k6 exit≠0 이라도 collect 는 진행 — 판정은 verdict 소관.
# GROMO-763: loadgen 을 SPOTS=N 대(loadgen-0..N-1)로 수평 분산 — 각 VM 이 총 rate/N 담당(k6 shardRate).
. "$(dirname "$0")/common.sh"
LT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PROFILE="${PROFILE:-smoke}"
TARGET="${TARGET:-scenarios/daily_mix.js}"
# 고급 설정 override — 빈값이면 k6 프로파일이 __ENV.* 대신 기본값 사용.
# rate 계열: RATE/DURATION(constant) · START_RATE(stress) · BASE_RATE/SPIKE_RATE(spike).
# 원격(workflow)은 10-input 제한 때문에 PARAMS="KEY=VALUE;…" 한 입력으로 실어 보낸다 → 여기서 파싱.
# 키 화이트리스트로 오타·미지원 키를 차단하고, 값은 아래 개별 검증을 그대로 통과시킨다.
# 로컬 `make run RATE=80` 은 PARAMS 없이 개별 env 로도 동작(PARAMS 가 있으면 해당 키만 덮어씀).
PARAMS="${PARAMS:-}"
if [ -n "$PARAMS" ]; then
  IFS=';' read -ra _pairs <<< "$PARAMS"
  for _pair in "${_pairs[@]}"; do
    [ -z "$_pair" ] && continue
    _k="${_pair%%=*}"; _v="${_pair#*=}"
    case "$_k" in
      RATE) RATE="$_v" ;;
      DURATION) DURATION="$_v" ;;
      START_RATE) START_RATE="$_v" ;;
      BASE_RATE) BASE_RATE="$_v" ;;
      SPIKE_RATE) SPIKE_RATE="$_v" ;;
      *) log "invalid PARAMS key '$_k' (허용: RATE·DURATION·START_RATE·BASE_RATE·SPIKE_RATE)"; exit 1 ;;
    esac
  done
fi
RATE="${RATE:-}"
DURATION="${DURATION:-}"
START_RATE="${START_RATE:-}"
BASE_RATE="${BASE_RATE:-}"
SPIKE_RATE="${SPIKE_RATE:-}"
# 셸 인젝션 방지: 값이 vm_ssh 원격 명령에 보간되기 전 숫자·시간단위(s/m/h)만 허용해 메타문자(; ` $() 등)를
# 차단한다. 빈값 허용(프로파일 기본). rps 계열은 숫자만, DURATION 만 시간단위 허용.
[[ "$RATE" =~ ^[0-9]*$ ]] || { log "invalid RATE (숫자만 허용): '$RATE'"; exit 1; }
[[ "$DURATION" =~ ^[0-9smh]*$ ]] || { log "invalid DURATION (예: 5m·90s): '$DURATION'"; exit 1; }
[[ "$START_RATE" =~ ^[0-9]*$ ]] || { log "invalid START_RATE (숫자만 허용): '$START_RATE'"; exit 1; }
[[ "$BASE_RATE" =~ ^[0-9]*$ ]] || { log "invalid BASE_RATE (숫자만 허용): '$BASE_RATE'"; exit 1; }
[[ "$SPIKE_RATE" =~ ^[0-9]*$ ]] || { log "invalid SPIKE_RATE (숫자만 허용): '$SPIKE_RATE'"; exit 1; }
# RECIPES: matrix/_generic.js 가 콤마구분 목록으로 읽어 open(../recipes/<name>.json). 경로주입 방지로 영숫자/_/-/, 만 허용.
RECIPES="${RECIPES:-}"
[[ "$RECIPES" =~ ^[a-zA-Z0-9_,-]*$ ]] || { log "invalid RECIPES (영숫자·_·-·, 만): '$RECIPES'"; exit 1; }
# SCENARIO: scenarios/_generic.js 가 open(./defs/<SCENARIO>.json). 경로주입 방지로 영숫자/_/- 만.
SCENARIO="${SCENARIO:-}"
[[ "$SCENARIO" =~ ^[a-zA-Z0-9_-]*$ ]] || { log "invalid SCENARIO (영숫자·_·- 만): '$SCENARIO'"; exit 1; }
# SPOTS: loadgen VM 을 N대로 수평 분산 — 각 VM(loadgen-0..N-1)이 총 rate/N 담당(k6 shardRate). VM별 CPU 가드 max.
# 상한 6: 전역 32vCPU − 고정 6(SUT2+obs2+러너2) = loadgen 예산 26 ÷ n2-highcpu-4(4vCPU) = 6.
SPOTS="${SPOTS:-1}"
[[ "$SPOTS" =~ ^[0-9]+$ ]] || { log "invalid SPOTS (숫자만): '$SPOTS'"; exit 1; }
{ [ "$SPOTS" -ge 1 ] && [ "$SPOTS" -le 6 ]; } || { log "❌ SPOTS 는 1..6 (loadgen 예산 26vCPU ÷ n2-highcpu-4 4vCPU). 입력=$SPOTS"; exit 1; }
REPORT_DIR="${REPORT_DIR:?Makefile 이 주입}"
mkdir -p "$REPORT_DIR"

SUT_IP=$(ip_of sut)
OBS_IP=$(ip_of obs)
K6_IMAGE="grafana/k6:0.54.0"

log "부하 VM ${SPOTS}대 스테이징 (스크립트 scp + params from GCS + node-exporter)"
stage_one() { # $1 = shard index → loadgen-$1 스테이징
  local vm="loadgen-$1"
  vm_ssh "$vm" 'rm -rf ~/k6run && mkdir -p ~/k6run/params ~/k6run/out && chmod 777 ~/k6run/out'
  vm_scp "$LT_DIR/k6" "$vm:~/k6run/scripts"
  vm_ssh "$vm" "gcloud storage cp -r 'gs://${PROJECT_ID}-params/${SEED_VERSION}/*' ~/k6run/params/ -q"
  # 부하기 CPU 가드용 node-exporter — run 마다 새 VM 이라 매번 기동. 없으면 그 VM CPU 시계열 결측 →
  # collect 의 max by(instance) 에서 조용히 빠져 포화를 놓친다. 전수 기동확인(아래 grep)이 짝.
  vm_ssh "$vm" "sudo docker rm -f node-exporter 2>/dev/null; sudo docker run -d --name node-exporter --restart=unless-stopped --net=host --pid=host -v /:/host:ro,rslave prom/node-exporter:v1.8.2 --path.rootfs=/host"
  vm_ssh "$vm" "sudo docker ps --filter name=node-exporter --filter status=running -q" | grep -q . \
    || log "⚠️ $vm node-exporter 미기동 — 부하기 CPU 가드가 INVALID/결측 위험"
}
for i in $(seq 0 $((SPOTS - 1))); do stage_one "$i" & done
wait
if ! "$(dirname "$0")/loadgen.sh" alive; then
  log "⚠️ 스테이징 중 부하 VM 소실 — spot 선점 의심 (verdict=INVALID)"; touch "$REPORT_DIR/.preempted"; exit 0
fi

K6_BASE="sudo docker run --rm \
  -v \$HOME/k6run/scripts:/scripts:ro -v \$HOME/k6run/params:/params:ro -v \$HOME/k6run/out:/out \
  -e PARAMS_DIR=/params -e BASE_URL=http://${SUT_IP}:8080"

date -u +%Y-%m-%dT%H:%M:%SZ > "$REPORT_DIR/.started_at"

log "① 워밍업 2분 (판정·요약 제외 · ${SPOTS}대 분산)"
# 워밍업도 SPOTS 로 분배(warmup.js 가 shardRate(WARMUP_RATE||20)) — 안 하면 총부하 20×N 으로 데워져
# 본측정과 다른 커넥션풀/버퍼캐시 상태가 됨. WARMUP_RATE env 는 미전달(profile 기본 20 사용).
for i in $(seq 0 $((SPOTS - 1))); do
  vm_ssh "loadgen-$i" "$K6_BASE -e PROFILE=warmup -e SPOTS=$SPOTS -e SHARD=$i -e RECIPES=$RECIPES -e SCENARIO=$SCENARIO $K6_IMAGE run --no-thresholds --no-summary --tag shard=$i /scripts/$TARGET" &
done
wait  # 무인자 — 워밍업 k6 exit 은 판정 제외(무시). 소실만 아래 alive 로 검사.
if ! "$(dirname "$0")/loadgen.sh" alive; then
  log "⚠️ 워밍업 중 부하 VM 소실 — spot 선점 의심 (verdict=INVALID)"; touch "$REPORT_DIR/.preempted"; exit 0
fi

# 인자 없는 reset() 은 클러스터 전체(모든 DB) 통계를 리셋한다 — 이 SQL 인스턴스가 loadtest
# 전용이라 실질 영향은 없음(#183 리뷰). 본측정 델타의 0점.
log "② pg_stat_statements 리셋 (인스턴스 전체 — loadtest 전용이라 무방)"
obs_psql loadtest '-c "SELECT pg_stat_statements_reset();"'

log "③ 본측정 (PROFILE=$PROFILE TARGET=$TARGET · ${SPOTS}대 분산)"
# 본측정 시작 타임스탬프 — collect 의 SUT micrometer p95/p99 windowed 쿼리가 이 구간(.main_started_at
# ~.ended_at)만 잘라 워밍업 저부하 오염을 차단(micrometer 히스토그램엔 phase 라벨 없음).
date -u +%Y-%m-%dT%H:%M:%SZ > "$REPORT_DIR/.main_started_at"
declare -a PIDS=()
for i in $(seq 0 $((SPOTS - 1))); do
  # 각 VM 에 서로 다른 SHARD=$i (복붙 실수로 동일 SHARD 면 나머지 분배 깨져 Σ≠total).
  # --tag shard=$i — remote-write 시계열 충돌 방지(없으면 N대 동일 라벨셋 → out-of-order 드랍).
  vm_ssh "loadgen-$i" "$K6_BASE \
    -e PROFILE=$PROFILE -e RATE=$RATE -e DURATION=$DURATION -e START_RATE=$START_RATE -e BASE_RATE=$BASE_RATE -e SPIKE_RATE=$SPIKE_RATE -e RECIPES=$RECIPES -e SCENARIO=$SCENARIO -e SPOTS=$SPOTS -e SHARD=$i -e SUMMARY_PATH=/out/summary.json \
    -e K6_PROMETHEUS_RW_SERVER_URL=http://${OBS_IP}:9090/api/v1/write \
    -e K6_PROMETHEUS_RW_TREND_STATS='p(95),p(99),avg,max' \
    $K6_IMAGE run -o experimental-prometheus-rw --tag shard=$i /scripts/$TARGET" &
  PIDS+=($!)
done
K6_EXIT=0
for pid in "${PIDS[@]}"; do wait "$pid" || { rc=$?; [ "$rc" -gt "$K6_EXIT" ] && K6_EXIT=$rc; }; done

date -u +%Y-%m-%dT%H:%M:%SZ > "$REPORT_DIR/.ended_at"
echo "$K6_EXIT" > "$REPORT_DIR/.k6_exit"

# [preempt-N] all-or-nothing — 완주 후 alive 무조건 재검사(K6_EXIT 조건 없음).
# spot DELETE 가 우아한 exit 0 로 위장해도 하나라도 ABSENT 면 선점으로 INVALID.
if ! "$(dirname "$0")/loadgen.sh" alive; then
  log "⚠️ 본측정 중 부하 VM 소실 — spot 선점 의심 (verdict=INVALID 예정)"
  touch "$REPORT_DIR/.preempted"
fi
log "run 종료 (k6 exit=$K6_EXIT — 99 는 threshold 초과이며 collect·verdict 로 판정)"
