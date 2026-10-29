"""Nginx 하네스 구동기. 사용: nginx_traffic.py PORT N OUT.json   → 기대 edge_request_id 와 금지 문자열을 OUT 에 쓴다.
요청마다 query 에 토큰·이메일·코드, Referer 에 토큰, 경로에 토큰 세그먼트를 넣는다(수집 결과에 원문이 남으면 실패)."""
import http.client, json, sys, uuid

port, n, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
SECRET = "SECRETTOKEN"
expected, kinds = [], {}
def call(method, path, headers=None, body=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse(); r.read()
    edge = r.getheader("X-Edge-Id")
    c.close()
    return r.status, edge

for i in range(n):
    tag = uuid.uuid4().hex[:8]
    q = f"token={SECRET}{tag}&email=person{tag}@example.com&code=C0DE{tag}&phone=010-1234-5678"
    for kind, (m, p, h, b) in {
        "ok": ("GET", f"/ok?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}"}, None),
        "up": ("GET", f"/up/x?{q}", {}, None),
        "502": ("GET", f"/api/y?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}"}, None),
        "502-path": ("GET", f"/api/PATHTOKEN{tag}ABCDEFGHIJKLMNOP", {}, None),   # upstream 연결 실패 → error 로그의 upstream URL 경로에 토큰
        "413": ("POST", f"/upload?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}"}, "x" * 4096),
        "404-path": ("GET", f"/invitations/PATHTOKEN{tag}ABCDEFGHIJKLMNOP", {}, None),
    }.items():
        status, edge = call(m, p, h, b)
        expected.append(edge); kinds[edge] = [kind, status]
json.dump({"expected": expected, "kinds": kinds, "forbidden": [SECRET, "REFSECRET", "@example.com", "person", "C0DE", "1234-5678", "PATHTOKEN", "token="]}, open(out, "w"))
print(f"sent {len(expected)} requests to :{port}")
