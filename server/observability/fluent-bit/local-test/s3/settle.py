"""watch.py 상태가 기대 집합을 두 sink 모두에서 채우면(또는 TIMEOUT 초가 지나면) 끝난다. 채운 뒤 8초 더 기다려 늦은 중복을 본다.
사용: settle.py STATE.json TIMEOUT RUN:COUNT [...]"""
import json, sys, time, uuid

NS = uuid.UUID("00000000-0000-0000-0000-000000002556")
state_path, timeout, specs = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
expected = {str(uuid.uuid5(NS, f"{r}-{i}")) for r, n in (s.split(":") for s in specs) for i in range(int(n))}
end = time.time() + timeout
done_at = None
while time.time() < end:
    try:
        st = json.load(open(state_path))
        if all(expected <= set(st[s]) for s in ("loki", "s3")):
            done_at = done_at or time.time()
            if time.time() - done_at >= 8: break
    except (OSError, ValueError):
        pass
    time.sleep(2)
print(f"SETTLE\tcomplete={done_at is not None}\twaited={timeout - max(0, end - time.time()):.0f}s")
