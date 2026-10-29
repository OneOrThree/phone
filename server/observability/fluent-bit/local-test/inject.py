"""Docker json-file 형식 줄을 stdout 으로 낸다(시각을 과거로 위조 — Loki 순서 위반 시험용). 인자: RUN COUNT AGE_SECONDS"""
import json, sys, time, uuid
run, count, age = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
NS = uuid.UUID("00000000-0000-0000-0000-000000002555")
t = time.time() - age
for i in range(count):
    app = {"schema_version": 1, "log_id": str(uuid.uuid5(NS, f"{run}-{i}")), "log_kind": "application",
           "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t)), "level": "INFO", "logger": "harness",
           "thread": "main", "message": f"inject {run}-{i}", "service": "data-api", "env": "dev"}
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t + i)) + ".000000000Z"
    print(json.dumps({"log": json.dumps(app) + "\n", "stream": "stdout", "time": stamp}), flush=True)
