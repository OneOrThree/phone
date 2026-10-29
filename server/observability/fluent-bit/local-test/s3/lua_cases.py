"""logs.lua 오프라인 입력표. 사용: lua_cases.py [logs.lua 경로] — 로컬 Fluent Bit 컨테이너(네트워크 없음)로 줄을 통과시켜 단언한다.
세 형태: ① 파싱 실패한 combined 줄의 client IP·user·referer·query ② 프로토콜 없는(HTTP/0.9) error 로그 request 의 query
③ combined 줄 원본 시각 보존(시간대 포함). 하나라도 어긋나면 종료 코드 1."""
import json, os, shutil, subprocess, sys, tempfile
LUA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "../../logs.lua"))
A = lambda log: {"log": log, "stream": "stdout", "_svc": "nginx", "_src": "access"}
E = lambda log: {"log": log, "stream": "stderr", "_svc": "nginx", "_src": "error"}
rows = [
    A('203.0.113.42 - - [29/Oct/2026:10:00:00 +0900] "-" 400 0 "-" "-"'),
    A('203.0.113.43 - alice [29/Oct/2026:10:00:00 +0900] "GET /x?token=TOK123 HTTP/0.9x" 400 0 "http://r/?t=REFSECRET" "UA-SECRET'),
    A('203.0.113.44 - - [29/Oct/2026:10:00:00 +0900] "GET /x?token=TOK456" 400 0 "http://r/?t=REFSECRET" "ua"'),
    E('2026/10/29 10:00:00 [error] 1#1: *1 open() failed, client: 203.0.113.9, server: x, request: "GET /reset?invite=INVITE123", host: "h"'),
    A('203.0.113.45 - - [01/Jan/2020:00:00:00 +0900] "GET /a?b=1 HTTP/1.1" 200 5 "-" "ua"'),
    A('203.0.113.45 - - [29/Feb/2024:23:59:59 -0500] "GET /a HTTP/1.1" 200 5 "-" "ua"'),
    A('203.0.113.46 - - [29/Oct/2026:10:00:00 +0900] "get /reset?invite=LOWER99 HTTP/1.1" 400 0 "-" "ua'),
    A('203.0.113.47 - - [29/Oct/2026:10:00:00 +0900] "/reset?code=NOMETH77" 400 0 "-" "ua'),
    E('2026/10/29 10:00:00 [error] 1#1: *2 open() failed, client: 203.0.113.9, server: x, request: "GET / HTTP/1.1", host: "h", referrer: "https://r/"?invite=INVITE123"'),
    E('2026/10/29 10:00:00 [error] 1#1: *3 open() failed, client: 203.0.113.9, server: x, request: "GET /api/x"?invite=INVITE123 HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *4 open() failed, client: 203.0.113.9, server: x, request: "GET /api/x"#FRAG456 HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *5 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.9, server: x, request: "GET /a HTTP/1.1", upstream: "http://10.0.0.1:8080/p"?code=UPSECRET1 x", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *6 open() "/var/www/a"?k=OPENSECRET2 failed (2: No such file or directory), client: 203.0.113.9, server: x, request: "GET / HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *7 open() "/var/www/html/index.html" failed (2: No such file or directory), client: 203.0.113.9, server: x, request: "GET /notification-preferences HTTP/1.1", host: "h"'),
    # ⑥ 퍼센트 인코딩된 query·fragment(소문자 %3f 포함) — request·open() 경로·upstream·access
    E('2026/10/29 10:00:00 [error] 1#1: *8 open() failed, client: 203.0.113.9, server: x, request: "GET /api/x%3Finvite=ENCQ111 HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *9 open() failed, client: 203.0.113.9, server: x, request: "GET /api/x%3finvite=ENCQ222 HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *10 open() failed, client: 203.0.113.9, server: x, request: "GET /api/x%23frag=ENCF333 HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *11 connect() failed, client: 203.0.113.9, server: x, request: "GET /a HTTP/1.1", upstream: "http://10.0.0.1:8080/p%3Fcode=ENCU444", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *12 open() "/var/www/a%3Fk=ENCO555" failed (2: No such file or directory), client: 203.0.113.9, server: x, request: "GET / HTTP/1.1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *13 open() failed, client: 203.0.113.9, server: x, request: "GET /api/x"%3Finvite=ENCQ666 HTTP/1.1", host: "h"'),
    A('203.0.113.48 - - [29/Oct/2026:10:00:00 +0900] "GET /a%3Ftoken=ENCA777 HTTP/0.9x" 400 0 "-" "ua'),
    # ⑦ 정상 경로(인코딩된 다른 문자)는 그대로
    E('2026/10/29 10:00:00 [error] 1#1: *14 open() failed, client: 203.0.113.9, server: x, request: "GET /a%20b/c%2Fd%253F HTTP/1.1", host: "h"'),
    # ⑧ upstream URL userinfo
    E('2026/10/29 10:00:00 [error] 1#1: *15 connect() failed, client: 203.0.113.9, server: x, request: "GET /a HTTP/1.1", upstream: "http://svcuser:UPPASS666@10.0.0.1:8080/p", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *16 connect() failed, client: 203.0.113.9, server: x, request: "GET /a HTTP/1.1", upstream: "http://svcuser:UPPASS777@10.0.0.1:8080/p?q=1", host: "h"'),
    E('2026/10/29 10:00:00 [error] 1#1: *17 connect() failed, client: 203.0.113.9, server: x, request: "GET /a HTTP/1.1", upstream: "http://svcuser:UPPASS888@10.0.0.1:8080/p'),
    E('2026/10/29 10:00:00 [error] 1#1: *18 no live upstreams while connecting to upstream, client: 203.0.113.9, server: x, request: "GET /a"x HTTP/1.1", upstream: "http://svcuser:UPPASS999@backend/p", host: "h"'),
    # ⑨ '/' 없는 토큰 — 한계 유지(런북 §4.1). 비밀 꼴 토큰은 남고, 호스트 이름(숫자 포함 20자 이상)은 가려지지 않아야 한다.
    E('2026/10/29 10:00:00 [error] 1#1: *19 client sent invalid header NOSLASHTOKEN1234567890abcdef, client: 203.0.113.9, server: x, host: "gromo-dev-app.asia-northeast3-a.c.oneorthree2.internal"'),
]
d = tempfile.mkdtemp()
shutil.copy(LUA, f"{d}/logs.lua")
open(f"{d}/in.log", "w").write("".join(json.dumps(r) + "\n" for r in rows))
open(f"{d}/p.conf", "w").write("[PARSER]\n    Name j\n    Format json\n")
open(f"{d}/t.lua", "w").write('dofile("/t/logs.lua")\nfunction t(tag, ts, record) return finalize(tag, ts, record) end\n')
open(f"{d}/c.conf", "w").write("[SERVICE]\n    Flush 1\n    Parsers_File /t/p.conf\n[INPUT]\n    Name tail\n    Path /t/in.log\n    Parser j\n    Read_From_Head On\n    Exit_On_Eof On\n"
                               "[FILTER]\n    Name lua\n    Match *\n    script /t/t.lua\n    call t\n[OUTPUT]\n    Name stdout\n    Match *\n    Format json_lines\n")
out = subprocess.run(["docker", "run", "--rm", "--network", "none", "-v", f"{d}:/t:ro", "fluent/fluent-bit:4.2.8", "-c", "/t/c.conf"],
                     capture_output=True, text=True).stdout
got = [json.loads(l) for l in out.splitlines() if l.startswith("{")]
blob = json.dumps(got)
checks = [
    (f"{len(rows)}줄 모두 출력", len(got) == len(rows)),
    ("① client IP 잔존 없음", "203.0.113.4" not in blob),
    ("① user·referer·UA·query 잔존 없음", not any(x in blob for x in ("alice", "REFSECRET", "UA-SECRET", "TOK123", "TOK456"))),
    ("② HTTP/0.9 request 의 invite 잔존 없음", "INVITE123" not in blob and 'request: "GET /reset"' in got[3]["message"]),
    ("① 소문자 메서드·메서드 없는 줄의 query 잔존 없음", "LOWER99" not in blob and "NOMETH77" not in blob),
    ("④ 값 안에 따옴표가 있는 referrer 전체가 \"-\"", "INVITE123" not in json.dumps(got[8]) and got[8]["message"].endswith(', referrer: "-"')),
    ("⑤ 요청 URI 안 따옴표 + query 잔존 없음, 구조 유지", "INVITE123" not in json.dumps(got[9]) and 'request: "GET /api/x"' in got[9]["message"] and got[9]["message"].endswith('host: "h"')),
    ("⑤ 요청 URI 안 따옴표 + fragment 잔존 없음", "FRAG456" not in json.dumps(got[10])),
    ("⑤ upstream URL 안 따옴표 + query 잔존 없음", "UPSECRET1" not in json.dumps(got[11]) and "http://10.0.0.1:8080/p" in got[11]["message"]),
    ("⑤ open() 경로 안 따옴표 + query 잔존 없음", "OPENSECRET2" not in json.dumps(got[12]) and "(2: No such file or directory)" in got[12]["message"]),
    ("⑤ 정상 error 줄 구조 유지", '"/var/www/html/index.html" failed (2: No such file or directory)' in got[13]["message"] and "/notification-preferences" in got[13]["message"]),
    ("⑥ %3F/%3f/%23 인코딩 query·fragment 잔존 없음(request·open()·upstream·따옴표 안 URI·access fallback)",
     not any(x in json.dumps(got[i]) for i in range(14, 21) for x in ("ENCQ", "ENCF", "ENCU", "ENCO", "ENCA")) and 'request: "GET /api/x HTTP' in got[14]["message"]
     and 'request: "GET /api/x HTTP' in got[16]["message"] and "http://10.0.0.1:8080/p" in got[17]["message"] and '"/var/www/a" failed' in got[18]["message"]),
    ("⑦ 정상 인코딩 경로(%20·%2F·%253F) 유지", 'request: "GET /a%20b/c%2Fd%253F HTTP/1.1"' in got[21]["message"]),
    ("⑧ upstream userinfo(user:pass@) 잔존 없음, 호스트·경로 유지(닫힘·query·잘림·따옴표 안 URI 4형)",
     not any(x in json.dumps(got[i]) for i in range(22, 26) for x in ("svcuser", "UPPASS")) and "http://:redacted@10.0.0.1:8080/p" in got[22]["message"]
     and "http://:redacted@backend/p" in got[25]["message"]),
    ("⑨ '/' 없는 토큰은 한계 유지(비밀 꼴 토큰이 남는다) — 호스트 이름은 가려지지 않는다",
     "NOSLASHTOKEN1234567890abcdef" in got[26]["message"] and "gromo-dev-app.asia-northeast3-a.c.oneorthree2.internal" in got[26]["message"]),
    ("③ combined 원본 시각 보존(+0900)", got[4]["timestamp"] == "2019-12-31T15:00:00.000Z"),
    ("③ combined 원본 시각 보존(-0500, 윤일)", got[5]["timestamp"] == "2024-03-01T04:59:59.000Z"),
]
for name, ok in checks: print(("PASS" if ok else "FAIL"), name)
sys.exit(0 if all(ok for _, ok in checks) else 1)
