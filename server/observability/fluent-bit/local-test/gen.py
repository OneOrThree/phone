"""하네스 로그 생성기. 인자: RUN COUNT INTERVAL_MS [EXTRAS]. log_id 는 uuid5(RUN-i) 라 검사기가 기대 집합을 다시 만든다."""
import json, sys, time, uuid

run, count, interval = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) / 1000
extras = len(sys.argv) > 4
NS = uuid.UUID("00000000-0000-0000-0000-000000002555")
for i in range(count):
    rec = {"schema_version": 1, "log_id": str(uuid.uuid5(NS, f"{run}-{i}")), "log_kind": "access" if i % 10 == 0 else "application",
           "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "level": "INFO",
           "logger": "harness", "thread": "main", "message": f"event {run}-{i}",
           "service": "data-api", "env": "dev", "version": "harness", "instance_id": "gen",
           "request_id": f"req-{run}-{i}"}
    if i % 50 == 7:
        rec["exception"] = "java.lang.IllegalStateException: boom\n\tat a.B.c(B.java:1)\n\tat a.B.d(B.java:2)\nCaused by: x.Y: why"
    print(json.dumps(rec, ensure_ascii=False), flush=True)
    time.sleep(interval)
if extras:
    print("plain text line email=alice@example.com password=hunter2 phone 010-1234-5678 rrn 900101-1234567", flush=True)
    print("X" * 20000, flush=True)
    print('{"unrelated":"json without our schema","token":"abc"}', flush=True)
