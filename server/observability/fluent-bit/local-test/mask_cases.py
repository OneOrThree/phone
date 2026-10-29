"""logs.lua 사전 자르기 꼬리 입력표(GROMO-2584). 사용: mask_cases.py [logs.lua 경로] [입력표 경로]
네 서비스 공통 입력표(server/data-api/src/test/resources/log-contract-vectors.tsv)의 cut 줄을 JSON 이 아닌 앱 줄로 만들어
로컬 Fluent Bit 컨테이너(네트워크 없음)의 finalize(raw 경로)에 통과시키고, message 가 Java 와 같은 기대값인지 단언한다.
'|' 가 사전 자르기 지점(MESSAGE_LIMIT*2 바이트)에 오도록 앞을 «secret=xxx…»(마스킹되면 secret=**** 로 줄어든다)로 채워
잘린 꼬리가 출력 16 KiB 안에 들어오게 한다 — Java LogContractVectorsTest 의 provider 단언과 같은 방식. 어긋나면 종료 코드 1."""
import json, os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
LUA = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "../logs.lua"))
TABLE = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else
                        os.path.join(HERE, "../../../data-api/src/test/resources/log-contract-vectors.tsv"))
PRE_CUT = 16384 * 2  # logs.lua MESSAGE_LIMIT * 2
PAD = "secret="

cases = []
for line in open(TABLE, encoding="utf-8"):
    if line.startswith("#") or not line.strip():
        continue
    kind, given, expected = line.rstrip("\n").split("\t")
    if kind != "cut":
        continue
    head, rest = given.split("|")
    fill = PRE_CUT - len(PAD) - 1 - len(head.encode())
    cases.append((given, PAD + "x" * fill + " " + head + rest, PAD + "**** " + expected))

d = tempfile.mkdtemp()
shutil.copy(LUA, f"{d}/logs.lua")
open(f"{d}/in.log", "w", encoding="utf-8").write(
    "".join(json.dumps({"log": log, "stream": "stdout", "_svc": "data-api"}) + "\n" for _, log, _ in cases))
open(f"{d}/p.conf", "w").write("[PARSER]\n    Name j\n    Format json\n")
open(f"{d}/t.lua", "w").write('dofile("/t/logs.lua")\nfunction t(tag, ts, record) return finalize(tag, ts, record) end\n')
# 입력 줄이 32 KiB 를 넘으므로 tail 버퍼를 늘린다(기본 32k 면 파일을 건너뛴다).
open(f"{d}/c.conf", "w").write("[SERVICE]\n    Flush 1\n    Parsers_File /t/p.conf\n[INPUT]\n    Name tail\n    Path /t/in.log\n    Parser j\n"
                               "    Read_From_Head On\n    Exit_On_Eof On\n    Buffer_Chunk_Size 64k\n    Buffer_Max_Size 1M\n"
                               "[FILTER]\n    Name lua\n    Match *\n    script /t/t.lua\n    call t\n[OUTPUT]\n    Name stdout\n    Match *\n    Format json_lines\n")
out = subprocess.run(["docker", "run", "--rm", "--network", "none", "-v", f"{d}:/t:ro", "fluent/fluent-bit:4.2.8", "-c", "/t/c.conf"],
                     capture_output=True, text=True).stdout
got = [json.loads(l) for l in out.splitlines() if l.startswith("{")]
checks = [(f"{len(cases)}줄 모두 출력", len(got) == len(cases))]
for (given, _, expected), record in zip(cases, got):
    ok = record.get("message") == expected and record.get("truncated") is True and record.get("parse_error") is True
    checks.append((f"cut {given!r} -> {expected[len(PAD) + 5:]!r}" + ("" if ok else f" (실제 {record.get('message')!r})"), ok))
for name, ok in checks: print(("PASS" if ok else "FAIL"), name)
sys.exit(0 if all(ok for _, ok in checks) else 1)
