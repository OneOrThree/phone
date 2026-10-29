"""하네스 로그 생성기. 인자: RUN COUNT INTERVAL_MS [extras|huge]. log_id 는 uuid5(RUN-i) 라 검사기가 기대 집합을 다시 만든다.
i % 100 == 7 인 줄은 exception 이 40 KiB 라 Docker 가 16 KiB 로 3조각 내는 «앱 JSON 재조립» 경로를 탄다(BIG_EXCEPTION_EVERY).
huge: 1 MiB 짜리 단어 문자 열 한 줄(마스킹 O(n²) 회귀 시험)."""
import json, sys, time, uuid

run, count, interval = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) / 1000
mode = sys.argv[4] if len(sys.argv) > 4 else ""
extras = mode == "extras"
NS = uuid.UUID("00000000-0000-0000-0000-000000002555")
for i in range(count):
    rec = {"schema_version": 1, "log_id": str(uuid.uuid5(NS, f"{run}-{i}")), "log_kind": "access" if i % 10 == 0 else "application",
           "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "level": "INFO",
           "logger": "harness", "thread": "main", "message": f"event {run}-{i}",
           "service": "data-api", "env": "dev", "version": "harness", "instance_id": "gen",
           "request_id": f"req-{run}-{i}"}
    if i % 100 == 7:
        frame = "\tat a.B.c(B.java:1)\n"
        rec["exception"] = "java.lang.IllegalStateException: boom\n" + frame * (40 * 1024 // len(frame)) + "Caused by: x.Y: why"
    elif i % 50 == 7:
        rec["exception"] = "java.lang.IllegalStateException: boom\n\tat a.B.c(B.java:1)\n\tat a.B.d(B.java:2)\nCaused by: x.Y: why"
    print(json.dumps(rec, ensure_ascii=False), flush=True)
    time.sleep(interval)
if extras:
    print("plain text line email=alice@example.com password=hunter2 phone 010-1234-5678 rrn 900101-1234567", flush=True)
    print("X" * 20000, flush=True)
    print('{"unrelated":"json without our schema","token":"abc"}', flush=True)
    # 스키마는 맞고 log_kind 만 모르는 값: raw 로 보관돼야 하고(라벨 값 weird 금지) 값은 가려져야 한다.
    print('{"schema_version":1,"log_kind":"weird","log_id":"unk-e2e","message":"password=pw-unk"}', flush=True)
    print('secrets token=tok-111 "refresh_token":"ref-666" Authorization: Bearer bear-444 api_key=key-555 access_token: acc-777 client_secret=sec-888 password=pw-999 {"token":"tok-222"} refresh=tok-333 apiKey=tok-000', flush=True)
if mode == "huge":
    print("X" * 1048576, flush=True)
