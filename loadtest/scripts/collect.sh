#!/usr/bin/env bash
# make collect — run 산출물 수집: summary.json(k6) · pg_top20.csv(쿼리 프로필) · meta.json(비교 가능 조건)
. "$(dirname "$0")/common.sh"
LT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PROFILE="${PROFILE:-smoke}"
TARGET="${TARGET:-scenarios/daily_mix.js}"
REPORT_DIR="${REPORT_DIR:?}"

log "summary.json 수거"
if [ ! -f "$REPORT_DIR/.preempted" ]; then
  vm_scp loadgen:'~/k6run/out/summary.json' "$REPORT_DIR/" || log "⚠️ summary 없음 (비정상 종료 run)"
fi

log "pg_stat_statements top-20 덤프 (설계 §4-2 쿼리)"
obs_psql loadtest "--csv -c \"SELECT calls, round(mean_exec_time::numeric,1) AS mean_ms, round(total_exec_time::numeric) AS total_ms, rows, round(100.0*shared_blks_hit/nullif(shared_blks_hit+shared_blks_read,0),1) AS hit_pct, left(query,120) AS query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;\"" \
  > "$REPORT_DIR/pg_top20.csv" || log "⚠️ pg_top20 덤프 실패"

log "부하기 CPU 최대치 조회 (측정 신뢰도 가드)"
LOADGEN_MAX_CPU=$(vm_ssh obs "curl -sf 'http://localhost:9090/api/v1/query' --data-urlencode \
  \"query=max_over_time((100*(1-avg(rate(node_cpu_seconds_total{job='loadgen',mode='idle'}[1m]))))[30m:15s])\" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)[\"data\"][\"result\"]; print(round(float(r[0][\"value\"][1]),1) if r else -1)'" \
  2>/dev/null || echo -1)

log "meta.json 작성 (비교 가능 조건 — sha 외 전부 동일해야 diff 유효)"
SHA=$(git -C "$LT_DIR/.." rev-parse --short HEAD)
SUT_SPEC=$(gcloud compute instances describe sut --zone="$ZONE" --project="$PROJECT_ID" \
  --format='value(machineType.basename(),minCpuPlatform)' | tr '\t' '/')
DB_TIER=$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" --format='value(settings.tier)')
LOADGEN_SPEC=$(gcloud compute instances describe loadgen --zone="$ZONE" --project="$PROJECT_ID" \
  --format='value(machineType.basename())' 2>/dev/null || echo deleted)
K6_HASH=$(find "$LT_DIR/k6" -type f -name '*.js' -print0 | sort -z | xargs -0 shasum | shasum | cut -c1-12)

cat > "$REPORT_DIR/meta.json" <<EOF
{
  "sha": "$SHA",
  "seedVersion": "$SEED_VERSION",
  "profile": "$PROFILE",
  "target": "$TARGET",
  "mixVersion": "assumed-v1",
  "sut": "$SUT_SPEC / loadtest-profile / -Xmx2g",
  "db": "$DB_TIER / PG16",
  "loadgen": "$LOADGEN_SPEC",
  "k6OptionsHash": "$K6_HASH",
  "loadgenMaxCpu": $LOADGEN_MAX_CPU,
  "preempted": $([ -f "$REPORT_DIR/.preempted" ] && echo true || echo false),
  "k6ExitCode": $(cat "$REPORT_DIR/.k6_exit" 2>/dev/null || echo -1),
  "startedAt": "$(cat "$REPORT_DIR/.started_at" 2>/dev/null || echo unknown)",
  "endedAt": "$(cat "$REPORT_DIR/.ended_at" 2>/dev/null || echo unknown)"
}
EOF

log "완료 → $REPORT_DIR"
