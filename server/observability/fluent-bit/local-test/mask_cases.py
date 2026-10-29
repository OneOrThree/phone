"""logs.lua 사전 자르기 꼬리 입력표(GROMO-2584). 사용: mask_cases.py [logs.lua 경로] [입력표 경로]
네 서비스 공통 입력표(server/data-api/src/test/resources/log-contract-vectors.tsv)의 cut 줄을 JSON 이 아닌 앱 줄로 만들어
로컬 Fluent Bit 컨테이너(네트워크 없음)의 finalize(raw 경로)에 통과시키고, message 가 Java 와 같은 기대값인지 단언한다.
'|' 가 사전 자르기 지점(MESSAGE_LIMIT*2 바이트)에 오도록 앞을 «secret=xxx…»(마스킹되면 secret=**** 로 줄어든다)로 채워
잘린 꼬리가 출력 16 KiB 안에 들어오게 한다 — Java LogContractVectorsTest 의 provider 단언과 같은 방식. 어긋나면 종료 코드 1.
GROMO-2583 이 같은 경로에 두 종류를 더한다: ① 한글(3바이트)이 message 16 KiB 상한(16,384 = 3*5461+1)과 사전 자르기 상한(32,768 =
3*10922+2)에 걸칠 때 문자 경계에서 잘리는지, ② 모르는 log_kind(스키마는 맞음)가 raw 로 보관되고 값이 Loki 라벨로 새지 않는지."""
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

# (이름, 앱 줄, 레코드 판정). Docker 는 16 KiB 마다 줄을 쪼개 한글 한가운데를 가를 수 있어 종단 하네스(run.sh)로는 못 본다.
def app_json(kind):
    """parser 필터 통과 뒤 finalize 가 받는 모양 — 파싱된 필드 + Preserve_Key 로 남은 원문 log."""
    fields = {"schema_version": 1, "log_kind": kind, "log_id": "unk-1", "message": "password=pw-unk"}
    return {**fields, "log": json.dumps(fields)}
extra = [
    ("한글 5462자(16,386B) -> 5461자", "가" * 5462,
     lambda r: r.get("message") == "가" * 5461 and r.get("truncated") is True and r.get("original_size_bytes") == 3 * 5462),
    ("한글 20000자(60,000B, 사전 자르기도 글자 한가운데) -> 5461자", "가" * 20000,
     lambda r: r.get("message") == "가" * 5461 and r.get("truncated") is True and r.get("original_size_bytes") == 60000),
    ("모르는 log_kind -> raw, 값은 가려지고 원래 값은 레코드에 남지 않음", app_json("weird"),
     lambda r: r.get("log_kind") == "raw" and r.get("parse_error") is True and "pw-unk" not in r.get("message", "")
     and "log_id" not in r),
    ("log_kind 가 문자열이 아니면 -> raw", app_json(["application"]),
     lambda r: r.get("log_kind") == "raw" and r.get("parse_error") is True),
    ("알려진 log_kind=access 는 그대로 통과(대조군)", app_json("access"),
     lambda r: r.get("log_kind") == "access" and r.get("parse_error") is None),
]
d = tempfile.mkdtemp()
shutil.copy(LUA, f"{d}/logs.lua")
open(f"{d}/in.log", "w", encoding="utf-8").write(
    "".join(json.dumps({**(log if isinstance(log, dict) else {"log": log}), "stream": "stdout", "_svc": "data-api"}) + "\n"
            for log in [c[1] for c in cases] + [e[1] for e in extra]))
open(f"{d}/p.conf", "w").write("[PARSER]\n    Name j\n    Format json\n")
open(f"{d}/t.lua", "w").write('dofile("/t/logs.lua")\nfunction t(tag, ts, record) return finalize(tag, ts, record) end\n')
# 입력 줄이 32 KiB 를 넘으므로 tail 버퍼를 늘린다(기본 32k 면 파일을 건너뛴다).
open(f"{d}/c.conf", "w").write("[SERVICE]\n    Flush 1\n    Parsers_File /t/p.conf\n[INPUT]\n    Name tail\n    Path /t/in.log\n    Parser j\n"
                               "    Read_From_Head On\n    Exit_On_Eof On\n    Buffer_Chunk_Size 64k\n    Buffer_Max_Size 1M\n"
                               "[FILTER]\n    Name lua\n    Match *\n    script /t/t.lua\n    call t\n[OUTPUT]\n    Name stdout\n    Match *\n    Format json_lines\n")
out = subprocess.run(["docker", "run", "--rm", "--network", "none", "-v", f"{d}:/t:ro", "fluent/fluent-bit:4.2.8", "-c", "/t/c.conf"],
                     capture_output=True, text=True).stdout
got = [json.loads(l) for l in out.splitlines() if l.startswith("{")]
checks = [(f"{len(cases) + len(extra)}줄 모두 출력", len(got) == len(cases) + len(extra))]
for (given, _, expected), record in zip(cases, got):
    ok = record.get("message") == expected and record.get("truncated") is True and record.get("parse_error") is True
    checks.append((f"cut {given!r} -> {expected[len(PAD) + 5:]!r}" + ("" if ok else f" (실제 {record.get('message')!r})"), ok))
for (name, _, pred), record in zip(extra, got[len(cases):]):
    ok = pred(record)
    checks.append((name + ("" if ok else f" (실제 {json.dumps(record, ensure_ascii=False)[:200]})"), ok))
for name, ok in checks: print(("PASS" if ok else "FAIL"), name)
sys.exit(0 if all(ok for _, ok in checks) else 1)
