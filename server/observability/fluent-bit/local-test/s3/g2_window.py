"""Loki 3.3.2(dev 와 같은 설정) 수용창 직접 측정 — 수집기를 거치지 않고 push API 로 «스트림 최신 항목보다 N분 오래된» 항목을 밀어 넣는다.
사용: g2_window.py   로컬 Loki(23100) 에만 보낸다."""
import json, time, urllib.error, urllib.request
sinks_url = "http://127.0.0.1:23100/loki/api/v1/push"
labels = {"env": "dev", "service": "winprobe", "log_kind": "application"}
def push(age_min, tag):
    ts = int((time.time() - age_min * 60) * 1e9)
    body = json.dumps({"streams": [{"stream": labels, "values": [[str(ts), json.dumps({"log_id": tag, "message": tag})]]}]}).encode()
    req = urllib.request.Request(sinks_url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return r.status, ""
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:120]
print("WINDOW\thead(now)", push(0, "head"))
for age in (1, 10, 30, 59, 61, 90, 180):
    print(f"WINDOW\tage={age}min behind head", push(age, f"age{age}"))
