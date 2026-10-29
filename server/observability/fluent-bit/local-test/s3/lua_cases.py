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
    ("6줄 모두 출력", len(got) == 6),
    ("① client IP 잔존 없음", "203.0.113.4" not in blob),
    ("① user·referer·UA·query 잔존 없음", not any(x in blob for x in ("alice", "REFSECRET", "UA-SECRET", "TOK123", "TOK456"))),
    ("② HTTP/0.9 request 의 invite 잔존 없음", "INVITE123" not in blob and 'request: "GET /reset"' in got[3]["message"]),
    ("③ combined 원본 시각 보존(+0900)", got[4]["timestamp"] == "2019-12-31T15:00:00.000Z"),
    ("③ combined 원본 시각 보존(-0500, 윤일)", got[5]["timestamp"] == "2024-03-01T04:59:59.000Z"),
]
for name, ok in checks: print(("PASS" if ok else "FAIL"), name)
sys.exit(0 if all(ok for _, ok in checks) else 1)
