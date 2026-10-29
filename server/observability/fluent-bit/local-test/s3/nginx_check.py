"""Nginx 하네스 검사. 사용: nginx_check.py TRAFFIC.json [TRAFFIC.json ...] [--wait SEC]
Loki {service="nginx"} 와 S3 service=nginx 객체를 따로 읽어: 기대 edge_request_id 도착/누락/중복, 금지 문자열 잔존, 401류 아닌
/up 의 request_id(upstream) 연결, error 로그 정제를 확인한다. 하나라도 어긋나면 종료 코드 1."""
import collections, json, sys, time
import sinks

paths = [a for a in sys.argv[1:] if a.endswith(".json")]
wait = float(sys.argv[sys.argv.index("--wait") + 1]) if "--wait" in sys.argv else 90
t = [json.load(open(p)) for p in paths]
expected = [e for x in t for e in x["expected"]]
kinds = {k: v for x in t for k, v in x["kinds"].items()}
exp_path = {k: v for x in t for k, v in x.get("paths", {}).items()}
forbidden = sorted({f for x in t for f in x["forbidden"]})
start_ns = int((time.time() - 3600) * 1e9)
end = time.time() + wait
def collect():
    loki, s3 = [], []
    for labels, _, line in sinks.loki_query('{service="nginx"}', start_ns):  # env·service·log_kind 는 라벨로 옮겨져 본문에 없다
        loki.append({**json.loads(line), **{k: v for k, v in labels.items() if k in ("env", "service", "log_kind")}})
    for key, _ in sinks.s3_list("system_log/v2/env=dev/service=nginx/"): s3 += sinks.s3_records(key)
    return loki, s3
while True:
    try: loki, s3 = collect()
    except Exception as e: loki, s3 = [], []; print("query error", e)
    ids = lambda rs: collections.Counter(r.get("edge_request_id") for r in rs if r.get("log_kind") == "access")
    if (set(expected) <= set(ids(loki)) and set(expected) <= set(ids(s3))) or time.time() > end: break
    time.sleep(3)
bad = 0
for name, rs in (("loki", loki), ("s3", s3)):
    c = ids(rs); got = [e for e in expected if e in c]
    dup = sum(c[e] - 1 for e in got)
    leaks = sorted({f for r in rs for f in forbidden if f in json.dumps(r)})
    errs = [r for r in rs if r.get("log_kind") == "infrastructure"]
    raw = [r for r in rs if r.get("log_kind") == "raw"]
    up = [r for r in rs if r.get("edge_request_id") in kinds and kinds[r["edge_request_id"]][0] == "up"]
    linked = sum(1 for r in up if str(r.get("request_id", "")).startswith("up-"))
    s502 = sum(1 for r in rs if r.get("log_kind") == "access" and r.get("status_code") == 502)
    s413 = sum(1 for r in rs if r.get("log_kind") == "access" and r.get("status_code") == 413)
    # 정상 경로(긴 kebab·UUID.png·해시 파일)는 기대한 모양 그대로여야 한다 — 과차단 회귀
    path_bad = [(kinds[r["edge_request_id"]][0], r.get("http_path")) for r in rs if r.get("log_kind") == "access" and r.get("edge_request_id") in kinds
                and kinds[r["edge_request_id"]][0] in exp_path and r.get("http_path") != exp_path[kinds[r["edge_request_id"]][0]]]
    path_ok = sum(1 for r in rs if r.get("log_kind") == "access" and r.get("edge_request_id") in kinds and kinds[r["edge_request_id"]][0] in exp_path) - len(path_bad)
    # 따옴표 수가 홀수 = Nginx 가 잘라 닫는 따옴표가 없는 error 줄. 이 경우가 실제로 지나갔는지(0 이면 시험이 안 된 것) 본다.
    unclosed = sum(1 for r in errs if r.get("message", "").count('"') % 2 == 1)
    src = collections.Counter("docker" if "stream" in r else "host" for r in rs if r.get("log_kind") == "access" and r.get("edge_request_id") in kinds)
    print(f"NGINX\t{name}\texpected={len(expected)}\treceived={len(got)}\tmissing={len(expected)-len(got)}\tduplicates={dup}\tby_source={dict(src)}\t"
          f"status502={s502}\tstatus413={s413}\tupstream_id_linked={linked}/{len(up)}\terror_records={len(errs)}\tunclosed_quote_errors={unclosed}\traw_records={len(raw)}\tnormal_path_ok={path_ok}\tnormal_path_bad={path_bad[:3]}\tleaked={leaks}")
    if len(got) != len(expected) or dup or leaks or not errs or not unclosed or linked != len(up) or path_bad or not path_ok: bad = 1
    if name == "loki":
        for r in errs[:3]: print("  sample error:", r["message"][:200])
        for r in [r for r in errs if r.get("message", "").count('"') % 2 == 1][:4]: print("  sample unclosed:", r["message"][-160:])
        sample = next((r for r in rs if r.get("log_kind") == "access"), None); print("  sample access:", json.dumps(sample)[:300])
sys.exit(bad)
