"""Nginx 하네스 구동기. 사용: nginx_traffic.py PORT N OUT.json   → 기대 edge_request_id 와 금지 문자열을 OUT 에 쓴다.
요청마다 query 에 토큰·이메일·코드, Referer 에 토큰, 경로에 토큰 세그먼트를 넣는다(수집 결과에 원문이 남으면 실패).
trunc-* 는 Nginx 가 error 한 줄을 약 2 KiB 에서 잘라 request·upstream·referrer·open() 경로의 닫는 따옴표가 없어지는 경우다."""
import base64, http.client, json, sys, uuid

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
    q = f"token={SECRET}{tag}&email=person{tag}@example.com&code=C0DE{tag}&phone=010-1234-5678&invite=INV1TE{tag}"
    basic = base64.b64encode(f"USERSECRET{tag}:pw".encode()).decode()
    for kind, (m, p, h, b) in {
        "ok": ("GET", f"/ok?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}"}, None),
        "up": ("GET", f"/up/x?{q}", {}, None),
        "502": ("GET", f"/api/y?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}"}, None),
        "502-path": ("GET", f"/api/PATHTOKEN{tag}ABCDEFGHIJKLMNOP", {}, None),   # upstream 연결 실패 → error 로그의 upstream URL 경로에 토큰
        "413": ("POST", f"/upload?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}"}, "x" * 4096),
        "404-path": ("GET", f"/invitations/PATHTOKEN{tag}ABCDEFGHIJKLMNOP", {}, None),
        "404-hex": ("GET", "/invitations/c0ffeec0-ffeec0ffeec0-ffeec0ff-eec0ffee-c0ffeec0ffee", {}, None),  # UUID 꼴이 아닌 긴 hex
        "401-user": ("GET", "/auth/", {"Authorization": f"Basic {basic}"}, None),                     # user "<이름>" was not found
        "trunc-req": ("GET", f"/api/y?{q}&pad={'A' * 2100}", {}, None),                             # request: "… 에서 잘림
        "trunc-up": ("GET", f"/api/PATHTOKEN{tag}ABCDEFGHIJKLMNOP?{q}&pad={'A' * 1200}", {}, None),  # request 는 닫히고 upstream: "… 에서 잘림
        "trunc-ref": ("GET", f"/api/y?{q}", {"Referer": f"http://ref.example/?token=REFSECRET{tag}&code=C0DE{tag}&pad={'A' * 2100}"}, None),
        "trunc-path": ("GET", f"/invitations/PATHTOKEN{tag}{'B' * 2100}", {}, None),                  # open() "… 에서 잘림
    }.items():
        status, edge = call(m, p, h, b)
        expected.append(edge); kinds[edge] = [kind, status]
json.dump({"expected": expected, "kinds": kinds, "forbidden": [SECRET, "REFSECRET", "@example.com", "person", "C0DE", "1234-5678", "PATHTOKEN", "token=", "INV1TE", "USERSECRET", "c0ffee"]}, open(out, "w"))
print(f"sent {len(expected)} requests to :{port}")
