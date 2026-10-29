#!/usr/bin/env bash
# 로컬 수집기 하네스. 실행: server/observability/fluent-bit/local-test/run.sh   (끝나면 down -v)
# 판정은 전부 단언이다(출력만 하고 넘어가지 않는다). 대기는 고정 sleep 이 아니라 기대 수 도달까지 폴링(상한 시간).
set -uo pipefail
cd "$(dirname "$0")"
C="docker compose -p obs2562-collector -f docker-compose.yml"
ok=0; fail() { echo "FAIL: $*"; ok=1; }
clean() { docker rm -f gen_a gen_b gen_c gen_f gen_g gen_h decoy-other-project >/dev/null 2>&1; $C --profile gen down -v --remove-orphans >/dev/null 2>&1; }
trap clean EXIT
clean
WAIT=${WAIT:-90}   # 폴링 상한(초)
HUGE_LIMIT=${HUGE_LIMIT:-30}   # 1 MiB 줄이 Loki 에 보이기까지 허용 시간(초)
metric() { curl -s http://127.0.0.1:12020/api/v1/metrics | python3 -c "import json,sys; d=json.load(sys.stdin)['output']; print(next(iter(d.values())).get('$1',0))" 2>/dev/null || echo 0; }
# Fluent Bit 을 멈추기 전에 drop 수를 합산해 둔다(컨테이너를 다시 만들면 지표가 0 으로 돌아간다).
DROPPED_TOTAL=0
acc_drop() { DROPPED_TOTAL=$((DROPPED_TOTAL + $(metric dropped_records))); }
$C up -d loki fluent-bit
for _ in $(seq 60); do curl -sf http://127.0.0.1:13100/ready >/dev/null && break; sleep 2; done
for _ in $(seq 30); do curl -sf http://127.0.0.1:12020/api/v1/metrics >/dev/null && break; sleep 1; done
gen() { $C --profile gen run -d --name "gen_$1" data-api "$1" "$2" "$3" ${4:-} >/dev/null; }

echo "== (a) 정상 N=500 + 다른 프로젝트의 같은 서비스 이름 + 허용 밖 서비스(decoy)"
docker run -d --name decoy-other-project --label com.docker.compose.project=other-project \
  --label com.docker.compose.service=data-api alpine sh -c 'for i in $(seq 50); do echo "{\"schema_version\":1,\"log_kind\":\"application\",\"log_id\":\"decoy-$i\"}"; done' >/dev/null
gen a 500 5 extras
python3 check.py --wait $WAIT a:500 || fail "(a) 누락·중복"

echo "== (b) 전송 중 Fluent Bit docker restart"
gen b 500 40
sleep 6; acc_drop; docker restart "$($C ps -q fluent-bit)" >/dev/null
python3 check.py --wait $WAIT a:500 b:500 || fail "(b) 누락·중복"

echo "== (c) 전송 중 컨테이너 삭제 후 재생성(볼륨 유지)"
gen c 500 40
sleep 5; acc_drop; $C stop fluent-bit >/dev/null; $C rm -f fluent-bit >/dev/null
sleep 3; $C up -d fluent-bit >/dev/null
python3 check.py --wait $WAIT a:500 b:500 c:500 || fail "(c) 누락·중복"

echo "== (f) 수집기 중단 중 앱 컨테이너 재생성(새 컨테이너·새 파일)"
acc_drop; $C stop fluent-bit >/dev/null
docker rm -f gen_f >/dev/null 2>&1
gen f 300 2; sleep 5
$C start fluent-bit >/dev/null
python3 check.py --wait $WAIT a:500 b:500 c:500 f:300 || fail "(f) 누락·중복"
for _ in $(seq 30); do curl -sf http://127.0.0.1:12020/api/v1/metrics >/dev/null && break; sleep 1; done

echo "== (h) 1 MiB 단어 문자 한 줄 — 마스킹이 입력 길이에 2차로 늘면 수집기가 멈춘다"
T0=$(date +%s)
gen h 1 0 huge
python3 - "$HUGE_LIMIT" "$T0" <<'PY' || fail "(h) 1 MiB 줄이 ${HUGE_LIMIT}s 안에 처리되지 않음"
import sys, time
sys.path.insert(0, ".")
from check import lines
limit, t0 = int(sys.argv[1]), int(sys.argv[2])
while time.time() - t0 < limit + 30:
    hit = [r for r, _ in lines('{log_kind="raw"}') if r.get("original_size_bytes") == 1048576]
    if hit:
        took = time.time() - t0
        print(f"1 MiB 줄: 도착까지 {took:.1f}s (생성·Docker 기록 포함), message={len(hit[0]['message'])}B truncated={hit[0].get('truncated')}")
        assert len(hit[0]["message"]) == 16384 and hit[0].get("truncated") is True
        raise SystemExit(0 if took <= limit else 1)
    time.sleep(1)
print("1 MiB 줄이 도착하지 않음"); raise SystemExit(1)
PY

echo "== (g) Loki 순서 위반: 같은 스트림 최신 시각보다 오래된 줄(Docker time 을 과거로 위조해 파일에 덧붙임)"
DROP_BEFORE_G=$((DROPPED_TOTAL + $(metric dropped_records)))
echo "drop(g 이전 누적, 기대 0): $DROP_BEFORE_G"
[ "$DROP_BEFORE_G" -eq 0 ] || fail "(g 이전) 기대 시나리오 밖 drop $DROP_BEFORE_G"
gen g 20 50
python3 check.py --wait $WAIT g:20 || fail "(g) 정상 줄"
GID=$(docker inspect -f '{{.Id}}' gen_g)
append() { python3 inject.py "$@" | docker run --rm -i -v /var/lib/docker/containers:/c alpine sh -c "cat >> /c/$GID/$GID-json.log"; }
# 설계 V21: timestamp 를 바꿔 은폐하지 않는다. Loki 가 수용창(max_chunk_age 2h 의 절반) 밖 줄을 거절하면 그대로 잃는다는 것을
# 숫자로 고정한다 — 아래 기대값이 바뀌면(Loki·Fluent Bit 버전 변경 등) 실패해서 README 의 문구를 다시 확인하게 한다.
append o30 20 1800     # 30분 전: 수용창 안
append o3h 20 10800    # 3시간 전: 수용창 밖 — 청크 전체가 400
sleep 8
append mixold 5 10800; append mixnew 5 0   # 같은 청크에 오래된 5 + 방금 5 — 거절이 새 줄까지 끌고 가는지
sleep 10
python3 - <<'PY' || fail "(g) 순서 위반 시나리오의 수신 수가 기대와 다름"
import sys; sys.path.insert(0, ".")
from check import evaluate
want = {"o30": 20, "o3h": 0, "mixold": 0, "mixnew": 5}
rows, _ = evaluate([f"{k}:{n}" for k, n in (("o30", 20), ("o3h", 20), ("mixold", 5), ("mixnew", 5))])
print("\n".join(rows))
got = {r.split()[0].split("=")[1]: int(r.split("received=")[1].split()[0]) for r in rows}
assert got == want, (got, want)
PY
G_DROPPED=$(metric dropped_records); G_ERRORS=$(metric errors)
LOKI_DISCARDED=$(curl -s http://127.0.0.1:13100/metrics | awk '/^loki_discarded_samples_total\{reason="too_far_behind"/ {print $2}')
echo "Fluent Bit: proc=$(metric proc_records) retried=$(metric retried_records) dropped=$G_DROPPED errors=$G_ERRORS"
echo "Loki: loki_discarded_samples_total{too_far_behind}=$LOKI_DISCARDED  (보낸 오래된 줄 = 20 + 5)"
$C logs fluent-bit 2>&1 | grep 'status=400' | head -3
# Fluent Bit dropped_records 는 400 을 받은 «청크 단위»로 센다. 같은 청크에 수용창 안 줄(o30)과 밖 줄(o3h)이 섞이면 Loki 는 안쪽 줄은
# 저장하고 바깥 줄만 거절하지만 Fluent Bit 은 그 청크 전체를 dropped 로 센다. 그래서 dropped·errors 는 tail 타이밍에 따라
# 20·25·40·45… 로 달라지며 «잃은 줄 수»가 아니다. 아래 범위 단언은 유실을 잡지 못한다 — 상한 50 은 g 에서 보낸 줄 전부라 전부 버려져도
# 통과한다. 실제 유실 판정의 정본은 위 수신 수(got == want), 아래 Loki 거절 25, 마지막의 TOTAL_DROPPED == G_DROPPED(g 밖 drop 0)이고,
# 셋 중 하나라도 어긋나면 fail 이다. 범위 단언은 집계 방식이 바뀐 것(버전 변경 등)을 알리는 용도다:
# 하한 = o3h 청크 20, 상한 = g 에서 보낸 줄 수 합 20+20+5+5 = 50, errors 는 1 이상·4(append 횟수) 이하.
[ "$G_DROPPED" -ge 20 ] && [ "$G_DROPPED" -le 50 ] || fail "(g) Fluent Bit dropped=$G_DROPPED (기대 20~50, 청크 단위 집계)"
[ "$G_ERRORS" -ge 1 ] && [ "$G_ERRORS" -le 4 ] || fail "(g) Fluent Bit errors=$G_ERRORS (기대 1~4, 청크 수)"
[ "${LOKI_DISCARDED%.*}" -eq 25 ] || fail "(g) Loki 거절 $LOKI_DISCARDED (기대 25)"

echo "== (d) 라벨 집합·service 값 집합"
python3 - <<'PY'
import json, time, urllib.request
START = int((time.time() - 4 * 3600) * 1e9)
def q(p): return json.load(urllib.request.urlopen(f"http://127.0.0.1:13100/loki/api/v1/{p}{'&' if '?' in p else '?'}start={START}"))["data"]
labels = q("labels"); print("labels:", sorted(labels))
vals = {l: sorted(q(f"label/{l}/values")) for l in ("env", "service", "log_kind")}; print(vals)
errors = []
if set(labels) - {"env", "service", "log_kind"}: errors.append(f"허용 밖 라벨 {sorted(set(labels) - {'env', 'service', 'log_kind'})}")
# canary(fluent-bit 합성 입력, 60초마다, 기본 켜짐)는 정상 도착이다 — 기대 집합에 명시적으로 포함한다. canary 가 «없어도» 통과한다:
# 여기서는 라벨 값 집합만 보고, canary 의 도착·누락 판정은 local-test/s3/canary.py(run-s3.sh) 책임이다.
if sorted(vals["service"]) not in (["data-api"], ["canary", "data-api"]): errors.append(f"service 값 집합이 {{data-api[, canary]}} 가 아님: {vals['service']}")
if vals["env"] != ["dev"]: errors.append(f"env 값 집합이 {{dev}} 가 아님: {vals['env']}")
if not set(vals["log_kind"]) <= {"application", "access", "raw"}: errors.append(f"log_kind 허용 밖: {vals['log_kind']}")
print("ERRORS:", errors); raise SystemExit(1 if errors else 0)
PY
[ $? -eq 0 ] || fail "(d) 라벨 집합"

echo "== (e) 마스킹·parse_error·truncated·decoy·멀티라인·40 KiB 앱 JSON 재조립"
python3 - <<'PY' || fail "(e)"
import json, sys, uuid
sys.path.insert(0, ".")
from check import lines, NS
pairs = lines('{env=~".+"}')
recs = [r for r, _ in pairs]  # env·service·log_kind 는 Loki 라벨로 옮겨져 줄 본문에서는 빠진다
raw = [r for r, s in pairs if r.get("parse_error")]
assert all(s["log_kind"] == "raw" for r, s in pairs if r.get("parse_error"))
print("raw lines:", len(raw), [("raw", r.get("truncated"), r.get("original_size_bytes"), len(r["message"])) for r in raw])
plain = next(r for r in raw if r["message"].startswith("plain text"))
print("masked:", plain["message"])
assert "hunter2" not in plain["message"] and "alice@" not in plain["message"] and "1234-5678" not in plain["message"].replace("-****-", "") and "1234567" not in plain["message"]
big = next(r for r in raw if r.get("truncated") and r["original_size_bytes"] == 20000); assert len(big["message"]) == 16384
other = next(r for r in raw if "unrelated" in r["message"]); print("non-schema json kept as raw: parse_error =", other["parse_error"])
assert "abc" not in other["message"], "raw 경로의 token 값이 가려지지 않음: " + other["message"]
secrets = next(r for r in raw if r["message"].startswith("secrets"))
print("masked secrets:", secrets["message"])
for leaked in ("tok-111", "tok-222", "tok-333", "bear-444", "key-555", "ref-666", "acc-777", "sec-888", "pw-999", "tok-000"):
    assert leaked not in secrets["message"], f"{leaked} 가 가려지지 않음"
# 사전 자르기 + 마스킹 뒤 자르기: 원본 길이는 원본 기준
assert not any(str(r.get("log_id", "")).startswith("decoy") for r in recs), "다른 프로젝트 로그가 들어옴"
assert not any("fluent" in str(r.get("message", "")).lower() or "[engine]" in str(r.get("message", "")) for r in recs), "Fluent Bit 자기 로그 재수집"
# 16 KiB 를 넘는 앱 JSON 줄: Docker 가 3조각으로 쪼갠 것을 되살려 parse_error 없는 application 레코드로 들어와야 한다.
expected_big = {str(uuid.uuid5(NS, f"{run}-{i}")) for run, n in (("a", 500), ("b", 500), ("c", 500), ("f", 300)) for i in range(n) if i % 100 == 7}
byid = {r["log_id"]: r for r in recs if "log_id" in r}
miss = expected_big - byid.keys(); assert not miss, f"40 KiB 줄 {len(miss)}개 누락"
for k in expected_big:
    r = byid[k]; assert "parse_error" not in r and len(r.get("exception", "")) >= 40000, (k, r.get("parse_error"), len(r.get("exception", "")))
print(f"40 KiB 앱 JSON 줄 {len(expected_big)}개: 전부 parse_error 없이 exception>=40000B 로 수신")
exc = [r for r in recs if "exception" in r]; assert exc and any("\n\tat a.B.c" in r["exception"] for r in exc)
assert all("observed_at" in r for r in recs)
print("exception records:", len(exc), "/ observed_at 전부 있음 / decoy 0 / 자기 로그 0")
PY

echo "== Fluent Bit drop 판정"
TOTAL_DROPPED=$((DROPPED_TOTAL + $(metric dropped_records)))
echo "재시작 전 누적 drop=$DROPPED_TOTAL / 최종 dropped=$(metric dropped_records) / 합계=$TOTAL_DROPPED (기대 = (g) 의 $G_DROPPED 뿐)"
[ "$TOTAL_DROPPED" -eq "$G_DROPPED" ] || fail "기대 시나리오 밖 drop (합계 $TOTAL_DROPPED, (g) $G_DROPPED)"
exit $ok
