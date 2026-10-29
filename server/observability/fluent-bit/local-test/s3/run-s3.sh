#!/usr/bin/env bash
# GROMO-2556 로컬 S3(MinIO) 하네스 — 장애 시나리오별 누락·중복·도착 지연을 계수한다. 프로젝트 obs2562-s3, 끝나면 down -v.
# 실행: server/observability/fluent-bit/local-test/s3/run-s3.sh [시나리오 이름...]   (인자 없으면 전부)
# 시나리오: a b1 b2 c d d2 d3 d4 e e2 g2 f1 f2 h i k   — 기대 log_id 집합은 생성기가 정하고, 수신 집합은 watch.py 가 Loki·S3 에서 따로 센다.
# AWS 에는 요청하지 않는다(S3 = 로컬 MinIO). 실패(누락/중복) 시나리오가 있으면 종료 코드 1.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; LT="$(dirname "$HERE")"; FB="$(dirname "$LT")"
TMP="${HARNESS_TMP:-$(mktemp -d)}"; mkdir -p "$TMP"
export HARNESS_TMP="$TMP" HARNESS_ETC="$FB"
PROJECT=obs2562-s3
dc() { docker compose -p "$PROJECT" -f "$LT/docker-compose.yml" -f "$HERE/docker-compose.s3.yml" "$@"; }
FAILS=0; RESULTS="$TMP/results.tsv"; : > "$RESULTS"
WATCH_PID=""
clean() {
  [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null || true
  [ -n "${CANARY_PID:-}" ] && kill "$CANARY_PID" 2>/dev/null || true
  docker ps -aq --filter "name=obs2562s3-gen-" | xargs docker rm -f >/dev/null 2>&1 || true
  dc --profile gen --profile nginx down -v --remove-orphans >/dev/null 2>&1 || true
}
trap clean EXIT

# --- 준비: MinIO 용 S3 모듈 사본(endpoint 한 줄 추가), 빈 Nginx 모듈 ---------------------------------------------------
prepare_modules() {
  mkdir -p "$TMP/s3-module" "$TMP/nginx-host-module"
  sed 's#^    bucket #    endpoint                  ${FLB_S3_ENDPOINT}\n    bucket #' "$FB/modules/s3-on/s3.conf" > "$TMP/s3-module/s3.conf"
  grep -q 'endpoint .*FLB_S3_ENDPOINT' "$TMP/s3-module/s3.conf"
  cp "$FB/modules/nginx-host-on/nginx-host.conf" "$TMP/nginx-host-module/nginx-host.conf"
}
wait_ready() {
  for _ in $(seq 90); do curl -sf http://127.0.0.1:23100/ready >/dev/null && curl -sf http://127.0.0.1:29000/minio/health/live >/dev/null && return 0; sleep 2; done
  echo "FAIL: loki/minio not ready"; return 1
}
fb_id() { dc ps -q fluent-bit; }
# gen RUN COUNT INTERVAL_MS [docker 옵션...]  — compose 라벨을 달아 allowlist 의 data-api 로 보이게 한다.
gen() {
  local run=$1 count=$2 iv=$3; shift 3
  docker run -d --name "obs2562s3-gen-$run" --label com.docker.compose.project=$PROJECT --label com.docker.compose.service=data-api \
    "$@" -v "$HERE/gen.py:/gen.py:ro" python:3.12-alpine python -u /gen.py "$run" "$count" "$iv" >/dev/null
}
start_watch() { local name=$1; shift; python3 "$HERE/watch.py" "$TMP/$name.json" "$@" & WATCH_PID=$!; sleep 3; }
stop_watch() { kill -TERM "$WATCH_PID" 2>/dev/null || true; wait "$WATCH_PID" 2>/dev/null || true; WATCH_PID=""; }
# finish NAME TIMEOUT [--allow-loss] RUN:COUNT...
finish() {
  local name=$1 timeout=$2; shift 2
  local allow=""; [ "$1" = "--allow-loss" ] && { allow="--allow-loss"; shift; }
  [ -z "$allow" ] && python3 "$HERE/settle.py" "$TMP/$name.json" "$timeout" "$@" || sleep "$timeout"
  stop_watch
  python3 "$HERE/report.py" "$TMP/$name.json" "$name" "$@" $allow | tee -a "$RESULTS" || { FAILS=$((FAILS+1)); echo "FAIL: $name (누락 또는 중복)"; }
  metrics "$name" | tee -a "$RESULTS"
  savelogs "$name"
}
# 시나리오가 끝난 시점의 수집기·Loki 로그를 남긴다(원인 확인용). 컨테이너를 다시 만들기 전에도 부른다.
savelogs() { docker logs "$(fb_id)" > "$TMP/fb-$1.log" 2>&1 || true; docker logs "$(dc ps -q loki)" > "$TMP/loki-$1.log" 2>&1 || true; }
metrics() { curl -s http://127.0.0.1:22020/api/v1/metrics 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k,v in d['output'].items(): print('METRICS','$1',k,{x:v.get(x) for x in ('proc_records','retried_records','dropped_records','errors','retries_failed')})" || echo "METRICS $1 unavailable"; }
sleep_ok() { sleep "$1"; }

SCENARIOS=("$@"); [ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(a b1 b2 c d d2 d3 d4 e e2 g2 f1 f2 h i k)
want() { for s in "${SCENARIOS[@]}"; do [ "$s" = "$1" ] && return 0; done; return 1; }

prepare_modules
clean
dc up -d loki minio fluent-bit
wait_ready
sleep 8
python3 "$HERE/canary.py" 420 --max-delay 120 > "$TMP/canary.out" 2>&1 & CANARY_PID=$!

if want a; then echo "== (a) 정상 N=600"
  start_watch a a; gen a 600 20; finish a 90 a:600
fi
if want b1; then echo "== (b1) 전송 중 Fluent Bit docker restart (SIGTERM, Grace 10s)"
  start_watch b1 b1; gen b1 1000 30; sleep 8; dc restart fluent-bit >/dev/null; finish b1 120 b1:1000
fi
if want b2; then echo "== (b2) 전송 중 Fluent Bit SIGKILL 후 재기동"
  start_watch b2 b2; gen b2 1000 30; sleep 8; docker kill "$(fb_id)" >/dev/null; sleep 5; dc start fluent-bit >/dev/null; finish b2 120 b2:1000
fi
if want c; then echo "== (c) 네트워크 단절(수집기를 Loki·MinIO 가 있는 네트워크에서 분리 30초) 후 복구"
  start_watch c c; gen c 1200 50; sleep 10; ID=$(fb_id); docker network disconnect ${PROJECT}_default "$ID"; sleep 30
  docker network connect ${PROJECT}_default "$ID"; finish c 150 c:1200
fi
if want d; then echo "== (d) S3 거부 — MinIO 정지 50초 중 Loki 정상 유지, 복구 후 backlog"
  start_watch d d; gen d 1800 50; sleep 10; dc stop minio >/dev/null; sleep 50; dc start minio >/dev/null; finish d 180 d:1800
fi
if want d2; then echo "== (d2) S3 권한 거부(403, 잘못된 비밀키로 재생성) 60초 후 올바른 키로 복구"
  start_watch d2 d2; savelogs before-d2; HARNESS_S3_SECRET=wrong-secret-xxxxxxxxxxxx dc up -d --force-recreate fluent-bit >/dev/null; sleep 5
  gen d2 1200 50; sleep 62; savelogs d2-wrongkey; dc up -d --force-recreate fluent-bit >/dev/null; finish d2 180 d2:1200
fi
if want d4; then echo "== (d4) MinIO 정지 5분(Retry_Limit 60 으로 견디는지) 뒤 복구"
  start_watch d4 d4; gen d4 4800 100; sleep 20; dc stop minio >/dev/null; sleep 300; dc start minio >/dev/null; finish d4 240 d4:4800
fi
if want e; then echo "== (e)+(g) Loki 단독 실패 3분 — S3 정상, 복구 후 3분 backlog 재전송"
  start_watch e e; gen e 2400 100; sleep 15; dc stop loki >/dev/null; sleep 180; dc start loki >/dev/null
  for _ in $(seq 60); do curl -sf http://127.0.0.1:23100/ready >/dev/null && break; sleep 2; done; finish e 200 e:2400
fi
if want d3; then echo "== (d3) MinIO 정지 90초(5회 실패 한도 초과) → 복구 60초 뒤 상태 → 수집기 재시작 뒤 상태"
  start_watch d3 d3; gen d3 2400 50; sleep 10; dc stop minio >/dev/null; sleep 90; dc start minio >/dev/null; sleep 60
  cp "$TMP/d3.json" "$TMP/d3-before.json"
  python3 "$HERE/report.py" "$TMP/d3-before.json" d3-before-restart d3:2400 --allow-loss | tee -a "$RESULTS"
  savelogs d3-before-restart; dc restart fluent-bit >/dev/null; finish d3 150 d3:2400
fi
if want e2; then echo "== (e2) Loki 단독 실패 3분, 복구 뒤 최대 15분 기다려 지연 도착인지 영구 누락인지 본다"
  start_watch e2 e2; gen e2 2400 100; sleep 15; dc stop loki >/dev/null; sleep 180; dc start loki >/dev/null
  for _ in $(seq 60); do curl -sf http://127.0.0.1:23100/ready >/dev/null && break; sleep 2; done; finish e2 900 e2:2400
fi
if want g2; then echo "== (g2) Loki 수용창 직접 측정(push API)"; python3 "$HERE/g2_window.py" | tee -a "$RESULTS"; fi

limit_run() { # NAME RUN COUNT INTERVAL [docker 옵션...] — 작은 한도로 Loki·MinIO 를 함께 막고 포화시킨다
  local name=$1 run=$2 count=$3 iv=$4; shift 4
  rm -rf "$TMP/etc-small"; cp -R "$FB" "$TMP/etc-small"; rm -rf "$TMP/etc-small/local-test"
  sed -i.bak 's/storage.total_limit_size  128M/storage.total_limit_size  1M/' "$TMP/etc-small/fluent-bit.conf"; rm -f "$TMP/etc-small/fluent-bit.conf.bak"
  grep -q 'total_limit_size  1M' "$TMP/etc-small/fluent-bit.conf"
  HARNESS_ETC="$TMP/etc-small" HARNESS_S3_TOTAL_FILE_SIZE=1M HARNESS_S3_STORE_LIMIT=2M dc up -d --force-recreate fluent-bit >/dev/null
  sleep 6; start_watch "$name" "$run"
  dc stop loki minio >/dev/null
  gen "$run" "$count" "$iv" "$@"
  docker wait "obs2562s3-gen-$run" >/dev/null; sleep 20
  metrics "$name-while-down"
  du -sh /dev/null >/dev/null 2>&1 || true
  dc start loki minio >/dev/null; wait_ready
  finish "$name" 150 --allow-loss "$run:$count"
  metrics "$name-after"
  dc up -d --force-recreate fluent-bit >/dev/null   # 기본 한도로 복귀(HARNESS_ETC=기본)
}
if want f1; then echo "== (f1) 디스크 한도 — Loki 엔진 1M·S3 엔진 1M·store_dir 2M, 두 sink 정지, N=6000 (Docker 로그 회전 없음)"
  limit_run f1 f1 6000 5
fi
if want f2; then echo "== (f2) 디스크 한도 + 소스 회전 — 위와 같고 생성기 Docker 로그를 500k x 2 로 회전"
  limit_run f2 f2 6000 5 --log-opt max-size=500k --log-opt max-file=2
fi
if want h; then echo "== (h) Fluent Bit 정지 중 생성기 컨테이너 새로 생성 → 재기동 뒤 누락 0"
  start_watch h h; dc stop fluent-bit >/dev/null; gen h 400 20; docker wait obs2562s3-gen-h >/dev/null; sleep 3
  dc start fluent-bit >/dev/null; finish h 120 h:400
fi
if want i; then echo "== (i) Nginx — prod 컨테이너(Docker 입력)·dev 호스트(파일 tail, 회전 포함)"
  dc --profile nginx up -d nginx nginx-host >/dev/null; sleep 5
  python3 "$HERE/nginx_traffic.py" 28080 40 "$TMP/t-docker.json"
  python3 "$HERE/nginx_traffic.py" 28081 40 "$TMP/t-host1.json"
  docker exec "$(dc ps -q nginx-host)" sh -c 'mv /var/log/nginx/access.json.log /var/log/nginx/access.json.log.1 && mv /var/log/nginx/error.log /var/log/nginx/error.log.1 && nginx -s reopen'
  sleep 2
  python3 "$HERE/nginx_traffic.py" 28081 40 "$TMP/t-host2.json"
  python3 "$HERE/nginx_check.py" "$TMP/t-docker.json" "$TMP/t-host1.json" "$TMP/t-host2.json" --wait 120 | tee -a "$RESULTS" || { FAILS=$((FAILS+1)); echo "FAIL: nginx"; }
fi

if want k; then echo "== (k) S3 키의 date/hour 가 «첫 레코드 event time» 인지 — 앱 timestamp 를 event time 으로 읽는 임시 수집기(별도 컨테이너)로 3시간 전 레코드를 보낸다"
  mkdir -p "$TMP/k"; cat > "$TMP/k/k.conf" <<'KEOF'
[SERVICE]
    Flush 1
    Parsers_File /k/parsers.conf
    storage.path /tmp/kst
[INPUT]
    Name tail
    Path /k/in.log
    Tag docker
    Parser ts_json
    Read_From_Head On
@INCLUDE /fluent-bit/etc/modules/s3/*.conf
[OUTPUT]
    Name null
    Match docker
KEOF
  printf '[PARSER]\n    Name ts_json\n    Format json\n    Time_Key timestamp\n    Time_Format %%Y-%%m-%%dT%%H:%%M:%%S.%%LZ\n' > "$TMP/k/parsers.conf"
  python3 - "$TMP/k/in.log" <<'PYEOF'
import json, sys, time, datetime
now = time.time()
def rec(age_min, tag):
    t = datetime.datetime.fromtimestamp(now - age_min * 60, datetime.timezone.utc)
    return json.dumps({"timestamp": t.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "log_id": f"k-{tag}", "service": "data-api", "env": "dev", "message": tag})
open(sys.argv[1], "w").write("\n".join([rec(180, "first-3h-ago"), rec(175, "second-175min-ago"), rec(5, "third-5min-ago")]) + "\n")
print("NOW_UTC", datetime.datetime.fromtimestamp(now, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "FIRST_RECORD_UTC", datetime.datetime.fromtimestamp(now - 180 * 60, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"))
PYEOF
  docker run -d --name obs2562s3-gen-k --network ${PROJECT}_default -e AWS_ACCESS_KEY_ID=harness-access -e AWS_SECRET_ACCESS_KEY=harness-secret-0123456789 \
    -e FLB_S3_BUCKET=obs-logs -e FLB_S3_REGION=us-east-1 -e FLB_S3_ENDPOINT=http://minio:9000 -e FLB_S3_TOTAL_FILE_SIZE=10M -e FLB_S3_UPLOAD_TIMEOUT=10s -e FLB_S3_STORE_LIMIT=64M \
    -v "$TMP/k:/k" -v "$TMP/s3-module:/fluent-bit/etc/modules/s3:ro" fluent/fluent-bit:4.2.8 /fluent-bit/bin/fluent-bit -c /k/k.conf >/dev/null
  sleep 30
  PYTHONPATH="$HERE" python3 - <<'PYEOF' | tee -a "$RESULTS"
import sinks
for key, size in sinks.s3_list("system_log/v2/env=dev/service=data-api/"):
    recs = sinks.s3_records(key)
    if any(r.get("log_id", "").startswith("k-") for r in recs): print("KEYTIME", key, [r.get("message") for r in recs])
PYEOF
  docker logs obs2562s3-gen-k > "$TMP/fb-k.log" 2>&1 || true
  PYTHONPATH="$HERE" python3 -c "import sinks; print('KEYLIST', sinks.s3_list('system_log/v2/'))" | tee -a "$RESULTS"
  docker rm -f obs2562s3-gen-k >/dev/null
fi

wait "$CANARY_PID" 2>/dev/null || true; CANARY_PID=""
echo "== canary"; cat "$TMP/canary.out" | tee -a "$RESULTS" | tail -40
echo "== 요약"; cat "$RESULTS" | grep -E "^(RESULT|NGINX|WINDOW|METRICS|CANARY_SUMMARY)" || true
echo "결과 파일: $RESULTS"
[ "$FAILS" -eq 0 ] || { echo "FAILS=$FAILS"; exit 1; }
