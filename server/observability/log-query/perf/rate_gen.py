"""고정 속도 합성 로그 생성기(컨테이너 안에서 실행). 인자: RATE(줄/초) SECONDS. 10ms 틱마다 RATE/100 줄을 낸다.
각 줄은 스키마 v1 앱 JSON 한 줄이고 emitted_ms(생성기 시계, epoch ms)와 seq 를 넣는다. log_id 는 uuid5(RUN-seq)."""
import json, sys, time, uuid

rate, seconds = int(sys.argv[1]), int(sys.argv[2])
NS = uuid.UUID("00000000-0000-0000-0000-000000002560")
per_tick = rate // 100
pad = "x" * 120  # 줄 크기를 현실적인 수백 바이트로
seq, start = 0, time.monotonic()
for tick in range(seconds * 100):
    for _ in range(per_tick):
        now = time.time()
        print(json.dumps({"schema_version": 1, "log_id": str(uuid.uuid5(NS, f"{rate}-{seq}")), "log_kind": "application",
                          "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + f".{int(now * 1000) % 1000:03d}Z",
                          "level": "INFO", "logger": "perf", "thread": "main", "message": f"perf {seq} {pad}",
                          "service": "data-api", "env": "dev", "version": "perf", "instance_id": "gen",
                          "request_id": f"req-{seq}", "seq": seq, "emitted_ms": int(now * 1000)}), flush=False)
        seq += 1
    sys.stdout.flush()
    delay = start + (tick + 1) * 0.01 - time.monotonic()
    if delay > 0:
        time.sleep(delay)
print(f"DONE emitted={seq} elapsed={time.monotonic() - start:.2f}s", flush=True)
