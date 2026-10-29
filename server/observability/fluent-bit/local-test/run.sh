#!/usr/bin/env bash
# 로컬 수집기 하네스. 실행: server/observability/fluent-bit/local-test/run.sh   (끝나면 down -v)
set -uo pipefail
cd "$(dirname "$0")"
C="docker compose -p obs2562-collector -f docker-compose.yml"
ok=0; fail() { echo "FAIL: $*"; ok=1; }
clean() { docker rm -f gen_a gen_b gen_c decoy-other-project >/dev/null 2>&1; $C --profile gen down -v --remove-orphans >/dev/null 2>&1; }
trap clean EXIT
clean
$C up -d loki fluent-bit
for _ in $(seq 60); do curl -sf http://127.0.0.1:13100/ready >/dev/null && break; sleep 2; done
sleep 5
gen() { $C --profile gen run -d --name "gen_$1" data-api "$1" "$2" "$3" ${4:-} >/dev/null; }
settle() { sleep "${1:-12}"; }

echo "== (a) 정상 N=500 + 다른 프로젝트의 같은 서비스 이름 + 허용 밖 서비스(decoy)"
docker run -d --name decoy-other-project --label com.docker.compose.project=other-project \
  --label com.docker.compose.service=data-api alpine sh -c 'for i in $(seq 50); do echo "{\"schema_version\":1,\"log_kind\":\"application\",\"log_id\":\"decoy-$i\"}"; done' >/dev/null
gen a 500 5 extras; settle
python3 check.py a:500

echo "== (b) 전송 중 Fluent Bit docker restart"
gen b 500 40
sleep 6; docker restart "$($C ps -q fluent-bit)" >/dev/null
settle 25
python3 check.py a:500 b:500

echo "== (c) 전송 중 컨테이너 삭제 후 재생성(볼륨 유지)"
gen c 500 40
sleep 5; $C stop fluent-bit >/dev/null; $C rm -f fluent-bit >/dev/null
sleep 3; $C up -d fluent-bit >/dev/null
settle 25
python3 check.py a:500 b:500 c:500

echo "== (d) 라벨 집합"
python3 - <<'PY'
import json, time, urllib.request
START = int((time.time() - 3600) * 1e9)
labels = json.load(urllib.request.urlopen(f"http://127.0.0.1:13100/loki/api/v1/labels?start={START}"))["data"]
print("labels:", sorted(labels))
for l in ("env", "service", "log_kind"):
    print(l, json.load(urllib.request.urlopen(f"http://127.0.0.1:13100/loki/api/v1/label/{l}/values?start={START}"))["data"])
extra = set(labels) - {"env", "service", "log_kind"}
print("EXTRA_LABELS:", sorted(extra)); raise SystemExit(1 if extra else 0)
PY
[ $? -eq 0 ] || fail "라벨 집합이 env,service,log_kind 가 아님"

echo "== (e) 마스킹·parse_error·truncated·decoy·멀티라인"
python3 - <<'PY' || fail "(e)"
import json, sys
sys.path.insert(0, ".")
from check import lines
pairs = lines('{env=~".+"}')
recs = [r for r, _ in pairs]  # env·service·log_kind 는 Loki 라벨로 옮겨져 줄 본문에서는 빠진다
raw = [r for r, s in pairs if r.get("parse_error")]
assert all(s["log_kind"] == "raw" for r, s in pairs if r.get("parse_error"))
print("raw lines:", len(raw), [ ("raw", r.get("truncated"), r.get("original_size_bytes"), len(r["message"])) for r in raw])
plain = next(r for r in raw if r["message"].startswith("plain text"))
print("masked:", plain["message"])
assert "hunter2" not in plain["message"] and "alice@" not in plain["message"] and "1234-5678" not in plain["message"].replace("-****-", "") and "1234567" not in plain["message"]
big = next(r for r in raw if r.get("truncated")); assert big["original_size_bytes"] == 20000 and len(big["message"]) == 16384
other = next(r for r in raw if "unrelated" in r["message"]); print("non-schema json kept as raw: parse_error =", other["parse_error"])
assert not any(str(r.get("log_id", "")).startswith("decoy") for r in recs), "다른 프로젝트 로그가 들어옴"
exc = [r for r in recs if "exception" in r]; assert exc and "\n\tat a.B.c" in exc[0]["exception"]
print("exception records:", len(exc), "observed_at present on all:", all("observed_at" in r for r in recs))
assert all("observed_at" in r for r in recs)
print("decoy leaked: 0; fluent-bit 자기 로그 재수집:", sum(1 for r in recs if "fluent" in str(r.get("message", "")).lower()))
PY
echo "== Fluent Bit 지표"; curl -s http://127.0.0.1:12020/api/v1/metrics | python3 -c "import json,sys; d=json.load(sys.stdin); print({k:d['output']['loki.1'].get(k) for k in ('proc_records','retried_records','dropped_records','errors')})" 2>/dev/null || true
exit $ok
