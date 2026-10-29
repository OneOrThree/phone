"""GROMO-2556 하네스 생성기. 인자: RUN COUNT INTERVAL_MS. log_id = uuid5(RUN-i) 라 검사기가 기대 집합을 다시 만든다.
emitted_ms 는 생성 시각(도착 지연의 기준)이다. trace 필드는 일부러 없다(trace 없는 로그도 보관돼야 한다)."""
import json, sys, time, uuid

NS = uuid.UUID("00000000-0000-0000-0000-000000002556")
run, count, interval = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) / 1000
for i in range(count):
    now = time.time()
    rec = {"schema_version": 1, "log_id": str(uuid.uuid5(NS, f"{run}-{i}")), "log_kind": "access" if i % 10 == 0 else "application",
           "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + f".{int(now * 1000) % 1000:03d}Z", "emitted_ms": int(now * 1000),
           "level": "INFO", "logger": "harness", "thread": "main", "message": f"event {run}-{i}",
           "service": "data-api", "env": "dev", "version": "harness", "instance_id": "gen", "request_id": f"req-{run}-{i}"}
    if i % 50 == 7:
        rec["exception"] = "java.lang.IllegalStateException: boom\n\tat a.B.c(B.java:1)\n\tat a.B.d(B.java:2)\nCaused by: x.Y: why"
    print(json.dumps(rec, ensure_ascii=False), flush=True)
    time.sleep(interval)
