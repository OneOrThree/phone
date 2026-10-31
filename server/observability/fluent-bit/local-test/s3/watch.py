"""시나리오 동안 Loki 와 S3 를 2초마다 따로 조회해 log_id 별 «처음 본 시각»과 «본 횟수»를 기록한다. 사용: watch.py OUT.json RUN [RUN...]
SIGTERM 으로 끝내면 마지막 상태를 쓴다. Loki 는 같은 스트림·같은 시각·같은 본문을 저장 시 합치므로 Loki 쪽 중복은 과소 계수될 수 있다."""
import hashlib, json, signal, sys, time
import sinks

out, runs = sys.argv[1], sys.argv[2:]
sel = '{env=~".+"} |~ "event (%s)-"' % "|".join(runs)
state = {"loki": {}, "s3": {}, "s3_objects": {}, "errors": {"loki": 0, "s3": 0}}
seen_lines, seen_keys, stop = set(), set(), False
signal.signal(signal.SIGTERM, lambda *_: globals().__setitem__("stop", True))
signal.signal(signal.SIGINT, lambda *_: globals().__setitem__("stop", True))
start_ns = int((time.time() - 30) * 1e9)


def note(sink, rec):
    e = state[sink].setdefault(rec["log_id"], {"first": time.time(), "count": 0, "emitted_ms": rec.get("emitted_ms")})
    e["count"] += 1


def flush():
    tmp = out + ".tmp"
    json.dump(state, open(tmp, "w"))
    import os; os.replace(tmp, out)


while not stop:
    try:
        for _, ts, line in sinks.loki_query(sel, start_ns):
            h = (ts, hashlib.md5(line.encode()).hexdigest())
            if h in seen_lines: continue
            seen_lines.add(h)
            try: rec = json.loads(line)
            except ValueError: continue
            if "log_id" in rec: note("loki", rec)
    except Exception:
        state["errors"]["loki"] += 1
    try:
        for key, size in sinks.s3_list():
            if key in seen_keys: continue
            recs = sinks.s3_records(key)
            seen_keys.add(key)
            state["s3_objects"][key] = {"first": time.time(), "bytes": size, "records": len(recs)}
            for rec in recs:
                if "log_id" in rec: note("s3", rec)
    except Exception:
        state["errors"]["s3"] += 1
    flush()
    time.sleep(2)
flush()
