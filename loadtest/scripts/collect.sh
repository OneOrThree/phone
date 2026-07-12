#!/usr/bin/env bash
# make collect — run 산출물 수집: summary.json(k6) · pg_top20.csv(쿼리 프로필) · meta.json(비교 가능 조건)
# GROMO-763: loadgen N대 → summary-0..N-1 수거 후 병합(카운트 합산·threshold OR), 부하기 CPU 는 VM별 최대,
#            지연 p95/p99 는 SUT micrometer 히스토그램(참 글로벌 — 부하기 대수 무관)에서 소싱.
. "$(dirname "$0")/common.sh"
LT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PROFILE="${PROFILE:-smoke}"
TARGET="${TARGET:-scenarios/daily_mix.js}"
SPOTS="${SPOTS:-1}"
REPORT_DIR="${REPORT_DIR:?}"

log "summary.json ${SPOTS}대 수거"
if [ ! -f "$REPORT_DIR/.preempted" ]; then
  for i in $(seq 0 $((SPOTS - 1))); do
    vm_scp "loadgen-$i:~/k6run/out/summary.json" "$REPORT_DIR/summary-$i.json" \
      || log "⚠️ loadgen-$i summary 없음 (비정상 종료 run)"
  done
fi
# 수거 개수 검증 — SPOTS 와 다르면 부분 병합(과소집계). meta 에 기록해 verdict 가 INVALID 처리 (#211 리뷰).
SUMMARIES_GOT=$(ls "$REPORT_DIR"/summary-*.json 2>/dev/null | wc -l | tr -d ' ')
{ [ ! -f "$REPORT_DIR/.preempted" ] && [ "$SUMMARIES_GOT" -ne "$SPOTS" ]; } \
  && log "⚠️ summary 수거 ${SUMMARIES_GOT}/${SPOTS} — 일부 shard 누락(verdict INVALID 예정)" || true

# N-summary 병합 → 단일 summary.json. 카운트(dropped·reqs·fails)는 합산, 에러율은 Σfails/Σreqs 가중,
# threshold 는 per-VM OR(어느 VM 이든 자기 rate/N 부하로 못 버티면 FAIL 보존). p95/p99 는 퍼센타일이라
# 병합 불가 → summary 에 안 넣고 아래 SUT micrometer 쿼리에서 소싱([summary-merge] 채택안 A).
if [ ! -f "$REPORT_DIR/.preempted" ] && ls "$REPORT_DIR"/summary-*.json >/dev/null 2>&1; then
  node -e '
    const fs = require("fs"), dir = process.argv[1];
    const files = fs.readdirSync(dir).filter(f => /^summary-\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(dir + "/" + f)));
    const g = (m, f) => files.reduce((s, d) => s + (d.metrics?.[m]?.values?.[f] ?? 0), 0);
    const dropped = g("dropped_iterations", "count");
    // 에러율 = Σ(rate×reqs) / Σreqs (phase:main). 비율 직접 평균은 VM별 reqs 가 다르면 틀림.
    const fails = files.reduce((s, d) => {
      const r = d.metrics?.["http_req_failed{phase:main}"]?.values?.rate ?? 0;
      const rq = d.metrics?.["http_reqs{phase:main}"]?.values?.count ?? d.metrics?.["http_reqs"]?.values?.count ?? 0;
      return s + r * rq;
    }, 0);
    const reqsMain = files.reduce((s, d) => s + (d.metrics?.["http_reqs{phase:main}"]?.values?.count ?? 0), 0) || g("http_reqs", "count");
    const merged = { metrics: {} };
    // threshold 보유 메트릭만 OR 축약 — 하나라도 !ok 면 FAIL 보존.
    for (const d of files) for (const [k, m] of Object.entries(d.metrics || {})) {
      if (!m.thresholds) continue;
      merged.metrics[k] = merged.metrics[k] || { thresholds: {}, values: m.values };
      for (const [e, t] of Object.entries(m.thresholds))
        merged.metrics[k].thresholds[e] = { ok: (merged.metrics[k].thresholds[e]?.ok ?? true) && t.ok };
    }
    // 카운트/에러율은 합산값으로 덮어쓰되 threshold(OR 결과)는 스프레드로 보존(...없으면 dropped count<1 threshold 유실).
    merged.metrics.dropped_iterations = { ...merged.metrics.dropped_iterations, values: { count: dropped } };
    merged.metrics["http_req_failed{phase:main}"] = { ...merged.metrics["http_req_failed{phase:main}"], values: { rate: reqsMain ? fails / reqsMain : 0 } };
    fs.writeFileSync(dir + "/summary.json", JSON.stringify(merged));
  ' "$REPORT_DIR" || log "⚠️ summary 병합 실패"
fi

log "pg_stat_statements top-20 덤프 (설계 §4-2 쿼리)"
obs_psql loadtest "--csv -c \"SELECT calls, round(mean_exec_time::numeric,1) AS mean_ms, round(total_exec_time::numeric) AS total_ms, rows, round(100.0*shared_blks_hit/nullif(shared_blks_hit+shared_blks_read,0),1) AS hit_pct, left(query,120) AS query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;\"" \
  > "$REPORT_DIR/pg_top20.csv" || log "⚠️ pg_top20 덤프 실패"

log "부하기 CPU 최대치 조회 (VM별 최대 — 한 대만 포화돼도 INVALID)"
# avg by(instance) 로 VM별 코어평균 → 바깥 max 로 가장 뜨거운 VM. node-exporter 결측 VM 은 여기서
# 조용히 빠지므로(포화 은닉) run.sh 스테이징의 전수 기동확인이 짝.
LOADGEN_MAX_CPU=$(vm_ssh obs "curl -sf 'http://localhost:9090/api/v1/query' --data-urlencode \
  \"query=max(max_over_time((100*(1-avg by(instance)(rate(node_cpu_seconds_total{job='loadgen',mode='idle'}[1m]))))[30m:15s]))\" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)[\"data\"][\"result\"]; print(round(float(r[0][\"value\"][1]),1) if r else -1)'" \
  2>/dev/null || echo -1)

log "SUT 지연 p95/p99 조회 (micrometer 히스토그램 — 부하기 대수 무관 참 글로벌, 본측정 창만)"
MAIN_START=$(cat "$REPORT_DIR/.main_started_at" 2>/dev/null || echo unknown)
ENDED=$(cat "$REPORT_DIR/.ended_at" 2>/dev/null || echo unknown)
# micrometer 카운터는 boot 이래 누적 → rate([창])@end 로 본측정 구간만 잘라 워밍업 오염 차단. 창 하한 15s.
WIN=$(python3 -c "import datetime as d; a=d.datetime.fromisoformat('$MAIN_START'.replace('Z','+00:00')); b=d.datetime.fromisoformat('$ENDED'.replace('Z','+00:00')); print(max(15,int((b-a).total_seconds())))" 2>/dev/null || echo 60)
END_EPOCH=$(python3 -c "import datetime as d; print(int(d.datetime.fromisoformat('$ENDED'.replace('Z','+00:00')).timestamp()))" 2>/dev/null || echo "")
sut_q() { # $1 = quantile(0.95|0.99) → ms (micrometer 초 × 1000), 결과 없으면 -1
  vm_ssh obs "curl -sf 'http://localhost:9090/api/v1/query' \
    --data-urlencode \"query=1000*histogram_quantile($1, sum(rate(http_server_requests_seconds_bucket{job='gromo-back',outcome='SUCCESS'}[${WIN}s]))by(le))\" \
    --data-urlencode 'time=${END_EPOCH}' \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)[\"data\"][\"result\"]; print(round(float(r[0][\"value\"][1]),1) if r else -1)'" \
    2>/dev/null || echo -1
}
SUT_P95=$(sut_q 0.95)
SUT_P99=$(sut_q 0.99)

log "meta.json 작성 (비교 가능 조건 — sha 외 전부 동일해야 diff 유효)"
SHA=$(git -C "$LT_DIR/.." rev-parse --short HEAD)
SUT_SPEC=$(gcloud compute instances describe sut --zone="$ZONE" --project="$PROJECT_ID" \
  --format='value(machineType.basename(),minCpuPlatform)' | tr '\t' '/')
DB_TIER=$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT_ID" --format='value(settings.tier)')
# ×N 표기 — verdict 메타 동일성 검사가 1대 baseline vs N대 run 을 자동 INVALID 로 걸러 diff 오염 방지.
LOADGEN_SPEC=$(gcloud compute instances describe loadgen-0 --zone="$ZONE" --project="$PROJECT_ID" \
  --format='value(machineType.basename())' 2>/dev/null || echo deleted)
LOADGEN_SPEC="${LOADGEN_SPEC} ×${SPOTS}"
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
  "spots": $SPOTS,
  "summariesCollected": $SUMMARIES_GOT,
  "k6OptionsHash": "$K6_HASH",
  "loadgenMaxCpu": $LOADGEN_MAX_CPU,
  "sutP95": $SUT_P95,
  "sutP99": $SUT_P99,
  "preempted": $([ -f "$REPORT_DIR/.preempted" ] && echo true || echo false),
  "k6ExitCode": $(cat "$REPORT_DIR/.k6_exit" 2>/dev/null || echo -1),
  "startedAt": "$(cat "$REPORT_DIR/.started_at" 2>/dev/null || echo unknown)",
  "endedAt": "$(cat "$REPORT_DIR/.ended_at" 2>/dev/null || echo unknown)"
}
EOF

log "완료 → $REPORT_DIR"
