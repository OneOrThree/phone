"""watch.py 상태와 기대 집합(RUN:COUNT)을 대조해 누락·중복·도착 지연(p50/최대, 초)을 낸다.
사용: report.py STATE.json LABEL RUN:COUNT [...] [--allow-loss]   누락>0 또는 중복>0 이면 종료 코드 1(--allow-loss 면 0)."""
import json, statistics, sys, uuid

NS = uuid.UUID("00000000-0000-0000-0000-000000002556")
args = [a for a in sys.argv[1:] if a != "--allow-loss"]
allow_loss = "--allow-loss" in sys.argv
state, label, specs = json.load(open(args[0])), args[1], args[2:]
expected = {}
for spec in specs:
    run, n = spec.split(":")
    expected.update({str(uuid.uuid5(NS, f"{run}-{i}")): run for i in range(int(n))})
bad = 0
for sink in ("loki", "s3"):
    got = state[sink]
    seen = [k for k in expected if k in got]
    missing = len(expected) - len(seen)
    dup = sum(got[k]["count"] - 1 for k in seen)
    delays = sorted(got[k]["first"] - got[k]["emitted_ms"] / 1000 for k in seen if got[k].get("emitted_ms"))
    p50 = f"{statistics.median(delays):.1f}" if delays else "-"
    mx = f"{delays[-1]:.1f}" if delays else "-"
    p95 = f"{delays[int(len(delays) * 0.95) - 1]:.1f}" if len(delays) >= 20 else "-"
    print(f"RESULT\t{label}\t{sink}\texpected={len(expected)}\treceived={len(seen)}\tmissing={missing}\tduplicates={dup}\tdelay_p50={p50}s\tdelay_p95={p95}s\tdelay_max={mx}s")
    bad += (missing > 0) + (dup > 0)
print(f"INFO\t{label}\ts3_objects={len(state['s3_objects'])}\twatch_errors={state['errors']}")
sys.exit(0 if (allow_loss or not bad) else 1)
