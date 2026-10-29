"""canary 도착 검사. Loki 조회와 S3 객체 조회를 «각각 따로» 해서, 합성 canary(log_id)가 두 곳에 도착한 시각과 지연을 잰다.
사용: canary.py SECONDS [--max-delay SEC]   종료 코드: 지난 canary 중 어느 한 곳에도 --max-delay 안에 안 온 것이 있으면 1.
운영 적용(설계): Loki/S3 조회를 각각 주기적으로 실행해 «마지막 canary 도착 시각»을 지표로 내고, 한쪽만 늦으면 그 sink 의 경보를 낸다."""
import calendar, json, sys, time
import sinks

duration = int(sys.argv[1])
max_delay = float(sys.argv[sys.argv.index("--max-delay") + 1]) if "--max-delay" in sys.argv else 600.0
canaries, seen_keys = {}, set()  # log_id -> {emitted, loki, s3}
t_end = time.time() + duration
start_ns = int((time.time() - 30) * 1e9)


def ts_of(rec):
    return calendar.timegm(time.strptime(rec["timestamp"][:19], "%Y-%m-%dT%H:%M:%S")) + int(rec["timestamp"][20:23]) / 1000


while time.time() < t_end:
    try:  # Loki 쪽
        for _, _, line in sinks.loki_query('{service="canary"}', start_ns):
            rec = json.loads(line)
            c = canaries.setdefault(rec["log_id"], {"emitted": ts_of(rec)})
            c.setdefault("loki", time.time())
    except Exception as e:
        print("loki query error:", e)
    try:  # S3 쪽 — Loki 결과와 무관하게 객체를 직접 읽는다
        for key, _ in sinks.s3_list("system_log/v2/env=dev/service=canary/"):
            if key in seen_keys: continue
            seen_keys.add(key)
            for rec in sinks.s3_records(key):
                canaries.setdefault(rec["log_id"], {"emitted": ts_of(rec)}).setdefault("s3", time.time())
    except Exception as e:
        print("s3 query error:", e)
    time.sleep(2)

bad = 0
now = time.time()
for k in ("loki", "s3"):  # 관측 시간 동안 sink 한쪽이라도 canary 를 하나도 못 받았으면 실패(빈 집합 통과 방지)
    if not any(k in c for c in canaries.values()):
        print(f"CANARY_NONE\t{k}\t관측 {duration}s 동안 수신 0"); bad += 1
for lid, c in sorted(canaries.items(), key=lambda kv: kv[1]["emitted"]):
    d = {k: (round(c[k] - c["emitted"], 1) if k in c else None) for k in ("loki", "s3")}
    late = [k for k in ("loki", "s3") if (d[k] is None and now - c["emitted"] > max_delay) or (d[k] is not None and d[k] > max_delay)]
    bad += bool(late)
    print(f"CANARY\t{lid}\tloki_delay={d['loki']}\ts3_delay={d['s3']}" + (f"\tMISSING_IN={late}" if late else ""))
for k in ("loki", "s3"):
    xs = sorted(c[k] - c["emitted"] for c in canaries.values() if k in c)
    print(f"CANARY_SUMMARY\t{k}\tcount={len(xs)}\tp50={xs[len(xs)//2]:.1f}s\tmax={xs[-1]:.1f}s" if xs else f"CANARY_SUMMARY\t{k}\tcount=0")
sys.exit(1 if bad else 0)
