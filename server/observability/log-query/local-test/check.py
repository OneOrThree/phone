"""GROMO-2560 로컬 조회 검사. run.sh 가 check 컨테이너(외부 네트워크 없음) 안에서 실행한다. 종료 코드 0 = 모든 기대 집합 일치.

1. fixture/records.jsonl(+ 같은 시각 bulk 1200줄)을 S3 키 레이아웃 그대로 gzip JSONL 객체로 쓰고(/data), Loki 에 push 한다.
2. Loki: 대시보드 JSON 에서 패널 LogQL 을 «그대로» 꺼내 변수만 치환해 실행하고, 행 이름 집합을 fixture/expected.json 과 비교한다.
3. Grafana: 프로비저닝된 대시보드가 API 로 열리는지, 같은 LogQL 이 Grafana 백엔드(/api/ds/query)로도 같은 줄 수를 내는지.
4. Trino: create-table.sql 의 열 목록으로 로컬 테이블을 만들고(형식 OPENX_JSON = Athena 의 OpenX SerDe), render.py 로 채운
   by-*.sql 을 그대로 실행해 기대 집합·표시 열(중복·늦은 도착·시계 차이·공유 구성원)을 비교한다.
"""
import base64
import collections
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/athena")
import render  # noqa: E402

LOKI, GRAFANA, TRINO = "http://loki:3100", "http://grafana:3000", "http://trino:8080"
DASH_DIR, FIX, ATHENA, DATA = "/dashboards", "/w/fixture", "/athena", "/data"
PANEL = {"general": 1, "general_count": 2, "cause": 3, "cause_count": 4, "links": 5, "operation": 6, "operation_count": 7, "split": 9}
FIXTURE_BASE = datetime(2026, 10, 29, 13, 20, tzinfo=timezone.utc)
NS = uuid.UUID("00000000-0000-0000-0000-000000002560")
failures = []


def check(ok, what, detail=""):
    print(("PASS " if ok else "FAIL ") + what + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        failures.append(what)


def http(url, body=None, headers=None, method=None, timeout=60):
    data = body if body is None or isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def wait(what, probe, limit=180):
    deadline, last = time.time() + limit, None
    while True:
        try:
            if probe():
                return
        except Exception as error:  # 기동 중 연결 거부 등
            last = error
        if time.time() > deadline:
            raise SystemExit(f"{what} 이 {limit}s 안에 준비되지 않음: {last}")
        time.sleep(2)


# ---------- fixture ----------
def iso(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def event_time(rec):
    return iso(rec.get("timestamp") or rec["observed_at"])


def fid(rec):
    return rec["message"].split()[0]


def fixture_rows():
    with open(f"{FIX}/records.jsonl", encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    for svc in ("data-api", "notification"):  # 같은 시각(밀리초까지)에 몰린 1200줄 — 상한·분할 시험
        for i in range(600):
            rows.append({"_object": f"bulk-{svc}", "schema_version": 1, "log_id": str(uuid.uuid5(NS, f"bulk-{svc}-{i}")),
                         "log_kind": "application", "timestamp": "2026-10-29T13:20:10.000Z", "level": "INFO", "logger": "fixture",
                         "thread": "main", "message": f"bulk {svc} {i:04d}", "service": svc, "env": "dev", "version": "fixture",
                         "instance_id": f"{svc}-1", "observed_at": "2026-10-29T13:20:11Z", "request_id": "req-bulk"})
    return rows


def write_objects(rows):
    """Fluent Bit S3 출력과 같은 키: 객체 시간 파티션 = 객체 «첫 레코드» event time(UTC)."""
    objects = collections.defaultdict(list)
    for row in rows:
        objects[row["_object"]].append(row)
    partitions = set()
    for name, recs in objects.items():
        env, svc = recs[0]["env"], recs[0]["service"]
        assert all(r["service"] == svc and r["env"] == env for r in recs), f"객체 {name} 에 다른 서비스가 섞임"
        first = event_time(recs[0])
        part = (env, svc, first.strftime("%Y-%m-%d"), first.strftime("%H"))
        path = f"{DATA}/system_log/v2/env={env}/service={svc}/date={part[2]}/hour={part[3]}"
        os.makedirs(path, exist_ok=True)
        with gzip.open(f"{path}/fixture-{name}-{uuid.uuid5(NS, name).hex[:8]}.json.gz", "wt", encoding="utf-8") as f:
            for rec in recs:
                f.write(json.dumps({k: v for k, v in rec.items() if k != "_object"}, ensure_ascii=False) + "\n")
        partitions.add(part)
    return sorted(partitions)


def push_loki(rows, shift):
    """Fluent Bit Loki 출력처럼 env·service·log_kind 는 라벨로 빼고 나머지를 JSON 줄로. 시각은 Loki 수용창 안으로 옮긴다."""
    streams = collections.defaultdict(list)
    for row in rows:
        rec = {k: v for k, v in row.items() if k != "_object"}
        if "timestamp" in rec:
            rec["timestamp"] = (iso(rec["timestamp"]) + shift).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
        rec["observed_at"] = (iso(rec["observed_at"]) + shift).strftime("%Y-%m-%dT%H:%M:%SZ")
        key = (rec.pop("env"), rec.pop("service"), rec.pop("log_kind"))
        ns = int(event_time(rec).timestamp() * 1000) * 1_000_000
        streams[key].append((ns, json.dumps(rec, ensure_ascii=False)))
    body = {"streams": [{"stream": {"env": e, "service": s, "log_kind": k}, "values": [[str(t), line] for t, line in sorted(v)]}
                        for (e, s, k), v in streams.items()]}
    http(f"{LOKI}/loki/api/v1/push", body, {"Content-Type": "application/json"})


# ---------- Loki · 대시보드 ----------
def load_dashboard(name="log-investigation.json"):
    with open(f"{DASH_DIR}/{name}", encoding="utf-8") as f:
        return json.load(f)


def panels_by_id(dash):
    return {p["id"]: p for p in dash["panels"]}


DEFAULT_VARS = {"env": "dev", "service": ".+", "level": ".*", "request_id": "", "origin": "", "event_id": "", "message_id": "",
                "operation_id": "", "delivery_id": "", "attempt": "", "dd_site": "us5.datadoghq.com"}


def var_names(dash):
    return {v["name"] for v in dash["templating"]["list"]}


def check_variables(dash):
    """패널 쿼리·링크의 $name·${name}·var-name 이 templating.list 최상위 변수여야 한다(내장 __* 제외). 하네스 기본값도 정의된 변수만."""
    defined = var_names(dash)
    text = json.dumps(dash, ensure_ascii=False)
    used = {n for n in re.findall(r"\$\{?(\w+)|var-(\w+)=", text) for n in n if n and not n.startswith("__")}
    check(not used - defined, "대시보드가 쓰는 변수 전부가 templating.list 최상위에 정의됨", f"미정의={sorted(used - defined)}")
    check(not set(DEFAULT_VARS) - defined, "하네스 DEFAULT_VARS 가 정의된 변수만 담음", f"미정의={sorted(set(DEFAULT_VARS) - defined)}")


def interpolate(expr, values, range_s):
    """Grafana 처럼 $name·${name} 을 치환한다. All 은 대시보드의 allValue(.+ / .*). 정의 안 된 변수면 KeyError = 실패."""
    v = dict(DEFAULT_VARS, **values, __range=f"{range_s}s")
    return re.sub(r"\$\{?(\w+)\}?", lambda m: v[m.group(1)], expr)


class Loki:
    def __init__(self, start, end):
        self.start_ns, self.end_ns = int(start.timestamp() * 1e9), int(end.timestamp() * 1e9)
        self.range_s = int((end - start).total_seconds())

    def get(self, path, **q):
        return http(f"{LOKI}{path}?{urllib.parse.urlencode(q)}")["data"]

    def lines(self, expr, limit, start_ns=None, end_ns=None):
        data = self.get("/loki/api/v1/query_range", query=expr, limit=limit, direction="backward",
                        start=start_ns or self.start_ns, end=end_ns or self.end_ns)
        return [json.loads(v[1]) for s in data["result"] for v in s["values"]]

    def instant(self, expr):
        return self.get("/loki/api/v1/query", query=expr, time=self.end_ns)["result"]

    def count(self, expr):
        result = self.instant(expr)
        return int(float(result[0]["value"][1])) if result else 0


def counter(recs):
    return dict(collections.Counter(fid(r) for r in recs))


def target_of(panel):
    (t,) = panel["targets"]
    return t


def check_loki(dash, expected, loki):
    panels = panels_by_id(dash)
    for case in expected["loki"]:
        t = target_of(panels[PANEL[case["panel"]]])
        recs = loki.lines(interpolate(t["expr"], case["vars"], loki.range_s), t["maxLines"])
        got = counter(recs)
        check(got == case["rows"], f"Loki {case['name']} — {len(recs)}줄", f"got={got} want={case['rows']}")
        count_panel = panels[PANEL[case["panel"] + "_count"]] if case["panel"] + "_count" in PANEL else None
        if count_panel:  # 줄 수 패널이 표와 같은 필터를 쓰는지
            n = loki.count(interpolate(target_of(count_panel)["expr"], case["vars"], loki.range_s))
            check(n == len(recs), f"Loki {case['name']} — 줄 수 패널 = 표 줄 수", f"{n} vs {len(recs)}")

    link_expr = target_of(panels[PANEL["links"]])["expr"]
    for case in expected["links"]:
        got = sorted([r["metric"].get("operation_id"), r["metric"].get("delivery_id"), r["metric"].get("attempt")]
                     for r in loki.instant(interpolate(link_expr, case["vars"], loki.range_s)))
        check(got == sorted(case["operations"]), f"Loki {case['name']}", f"got={got}")

    # 상한: 같은 시각에 1200줄 — 표는 1000줄에서 끊기고, 줄 수 패널은 전체를 세며, 서비스별 분할은 각자 상한 안이다.
    lim = expected["limit"]
    t = target_of(panels[PANEL["cause"]])
    recs = loki.lines(interpolate(t["expr"], lim["vars"], loki.range_s), t["maxLines"])
    total = loki.count(interpolate(target_of(panels[PANEL["cause_count"]])["expr"], lim["vars"], loki.range_s))
    red = [s["value"] for s in panels[PANEL["cause_count"]]["fieldConfig"]["defaults"]["thresholds"]["steps"] if s["color"] == "red"]
    print(f"상한 시험: 표 {len(recs)}줄 / 줄 수 패널 {total} / 빨강 기준 {red} / maxLines {t['maxLines']}")
    check(len(recs) == t["maxLines"] and total == lim["total"] and red == [t["maxLines"]] and total >= red[0],
          "상한 도달 — 표는 maxLines 에서 끊기고 줄 수 패널이 «일부»(빨강)를 표시")
    stamps = {r["timestamp"] for r in recs}
    one_ms = int(iso(next(iter(stamps))).timestamp() * 1e9)
    narrow = loki.lines(interpolate(t["expr"], lim["vars"], loki.range_s), t["maxLines"], one_ms, one_ms + 1_000_000)
    check(len(stamps) == 1 and len(narrow) == t["maxLines"], "같은 timestamp 초과 — 1ms 창으로 좁혀도 상한(시간 분할로 해결 불가)",
          f"stamps={len(stamps)} narrow={len(narrow)}")
    split_panel = panels[PANEL["split"]]
    check(split_panel.get("repeat") == "service", "분할 패널이 service 변수로 반복")
    per = {}
    for svc in loki.get("/loki/api/v1/label/service/values", start=loki.start_ns, end=loki.end_ns):
        st = target_of(split_panel)
        n = len(loki.lines(interpolate(st["expr"], dict(lim["vars"], service=svc), loki.range_s), st["maxLines"]))
        if n:
            per[svc] = n
    print(f"서비스별 분할: {per}")
    check(per == lim["per_service"] and all(n < st["maxLines"] for n in per.values()),
          "서비스별 분할 — 각 서비스가 상한 안에서 전부 나온다(합 = 전체)")


def check_links(dash):
    panels = panels_by_id(dash)
    links = {}
    for p in dash["panels"]:
        for o in p.get("fieldConfig", {}).get("overrides", []):
            for prop in o["properties"]:
                if prop["id"] == "links":
                    links.setdefault((p["id"], o["matcher"]["options"]), []).extend(x["url"] for x in prop["value"])
    for pid in (PANEL["cause"], PANEL["links"]):
        (url,) = links[(pid, "operation_id")]
        check("var-operation_id=${__value.raw}" in url and "var-delivery_id=${__data.fields.delivery_id}" in url
              and "var-attempt=${__data.fields.attempt}" in url
              and url.startswith("/d/" + dash["uid"] + "/"), f"패널 {pid} operation_id 클릭 → ④ 변수 설정 링크")
    for pid in (PANEL["cause"], PANEL["operation"]):
        (dd,) = links[(pid, "dd_trace_id")]
        check(dd.startswith("https://${dd_site}/") and "datadoghq" not in dd, f"패널 {pid} dd_trace_id → Datadog (호스트는 변수)")
        (prom,) = links[(pid, "Time")]
        check(prom.startswith(f"/d/{load_dashboard('gromo-overview.json')['uid']}/") and "time=${__value.time}" in prom,
              f"패널 {pid} Time → gromo-overview 같은 시각 구간")
    check(all(target_of(panels[i])["maxLines"] == 1000 for i in (PANEL["general"], PANEL["cause"], PANEL["operation"], PANEL["split"])),
          "로그 패널 maxLines 가 모두 1000(줄 수 패널 빨강 기준과 같다)")
    # Loki 조회는 라벨로 먼저 줄인다: 모든 표현식이 {env=~"$env", ...} 선택자로 시작(sum/count 안쪽 포함)
    exprs = [t["expr"] for p in dash["panels"] for t in p.get("targets", [])]
    check(all(re.search(r'\{env=~"\$env", service(=~"\$service"|="notification")\}', e) for e in exprs),
          "모든 LogQL 이 env·service 라벨 선택자로 시작")


# ---------- Grafana ----------
def grafana(path, body=None):
    auth = base64.b64encode(b"admin:admin").decode()
    return http(f"{GRAFANA}{path}", body, {"Authorization": f"Basic {auth}", "Content-Type": "application/json"})


def check_grafana(dash, expected, loki):
    uids = sorted(load_dashboard(n)["uid"] for n in os.listdir(DASH_DIR) if n.endswith(".json"))
    wait("Grafana 대시보드 프로비저닝", lambda: len(grafana("/api/search?type=dash-db")) >= len(uids), 120)
    for uid in uids:
        try:
            got = grafana(f"/api/dashboards/uid/{uid}")["dashboard"]
            check(got["uid"] == uid, f"Grafana 대시보드 로드 {uid} (패널 {len(got.get('panels', []))})")
            if uid == dash["uid"]:
                check(var_names(dash) <= var_names(got) and "attempt" in var_names(got), "Grafana API 응답 templating.list 에 attempt 등 전체 변수 등록",
                      f"got={sorted(var_names(got))}")
        except urllib.error.HTTPError as error:
            check(False, f"Grafana 대시보드 로드 {uid}", f"HTTP {error.code}")
    panels = panels_by_id(dash)
    case = expected["loki"][0]
    t = target_of(panels[PANEL["cause"]])
    expr = interpolate(t["expr"], case["vars"], loki.range_s)
    body = {"queries": [{"refId": "A", "datasource": {"type": "loki", "uid": "loki"}, "expr": expr, "queryType": "range",
                         "maxLines": t["maxLines"]}],
            "from": str(loki.start_ns // 1_000_000), "to": str(loki.end_ns // 1_000_000)}
    frames = grafana("/api/ds/query", body)["results"]["A"]["frames"]
    names = [f["name"] for f in frames[0]["schema"]["fields"]] if frames else []
    rows = sum(len(f["data"]["values"][0]) for f in frames if f["data"]["values"])
    want = sum(case["rows"].values())
    print(f"Grafana /api/ds/query 프레임 필드: {names}, 줄 {rows}")
    check(rows == want, f"Grafana 백엔드로 같은 LogQL — {case['name']} 줄 수", f"{rows} vs {want}")
    check({"labels", "Time", "Line"} <= set(names), "Loki 로그 프레임에 표 변환이 쓰는 labels·Time·Line 필드가 있다", str(names))


# ---------- Trino (Athena 대용) ----------
def trino(sql):
    out = http(f"{TRINO}/v1/statement", sql.strip().rstrip(";").encode(),
               {"X-Trino-User": "check", "X-Trino-Catalog": "hive", "X-Trino-Schema": "logs"}, method="POST")
    columns, rows = None, []
    while True:
        if out.get("error"):
            raise RuntimeError(out["error"].get("message"))
        if columns is None and out.get("columns"):
            columns = [c["name"] for c in out["columns"]]
        rows += out.get("data") or []
        if not out.get("nextUri"):
            break
        time.sleep(0.05)
        out = http(out["nextUri"])
    return [dict(zip(columns, r)) for r in rows] if columns else []


TYPES = {"string": "varchar", "int": "integer", "bigint": "bigint", "boolean": "boolean"}


def trino_type(hive):
    if hive.startswith("struct<"):
        return "row(" + ", ".join(f"{n} {trino_type(t)}" for n, t in (f.split(":", 1) for f in hive[7:-1].split(","))) + ")"
    return TYPES[hive]


def trino_table(ddl, partitions):
    """Athena DDL(Hive 문법)은 Trino 가 못 읽는다 — 같은 열 목록·같은 SerDe 계열·같은 위치 템플릿으로 옮겨 만든다."""
    m = re.search(r"CREATE EXTERNAL TABLE IF NOT EXISTS (\w+) \((.*?)\n\)\nPARTITIONED BY \((.*?)\)\n", ddl, re.S)
    name, cols, parts = m.group(1), m.group(2), m.group(3)
    col = lambda spec: re.fullmatch(r"\s*`(\w+)`\s+(\S+)\s*", spec).groups()
    data_cols = [col(line.rstrip(",")) for line in cols.strip().splitlines()]
    part_cols = [col(s) for s in parts.split(",")]
    assert "ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'" in ddl
    prop = lambda key: re.search(rf"'{re.escape(key)}' = '([^']*)'", ddl).group(1)
    location = re.search(r"LOCATION 's3://[^/]+(/[^']*)'", ddl).group(1).rstrip("/")
    template = re.sub(r"^s3://[^/]+", "", prop("storage.location.template")).rstrip("/")
    # SERDEPROPERTIES 는 Trino 의 extra_properties(= 메타스토어 serde 파라미터)로 옮긴다 — 로컬 OPENX_JSON 이 같은 옵션을 읽는다(탐침으로 확인).
    serde = dict(re.findall(r"'([^']+)'\s*=\s*'([^']*)'", (re.search(r"WITH SERDEPROPERTIES \((.*?)\)\n", ddl, re.S) or [None, ""])[1]))
    extra = f", extra_properties = MAP(ARRAY[{', '.join(repr(k) for k in serde)}], ARRAY[{', '.join(repr(v) for v in serde.values())}])" if serde else ""
    assert serde.get("ignore.malformed.json") == "true", "create-table.sql 에 ignore.malformed.json 이 없다"
    trino("CREATE SCHEMA IF NOT EXISTS hive.logs WITH (location = 'local:///warehouse/logs')")
    trino(f"DROP TABLE IF EXISTS {name}")
    columns = ", ".join(f'"{n}" {trino_type(t)}' for n, t in data_cols + part_cols)
    trino(f"CREATE TABLE {name} ({columns}) WITH (format = 'OPENX_JSON', external_location = 'local://{location}', "
          f"partitioned_by = ARRAY[{', '.join(repr(n) for n, _ in part_cols)}]{extra})")
    # partition projection 대신: 존재하는 객체 디렉터리만, 투영 값 집합 안인지 확인하고 템플릿으로 위치를 만들어 등록한다.
    enum = {c: prop(f"projection.{c}.values").split(",") for c in ("env", "service", "archive_hour")}
    names = [n for n, _ in part_cols]
    for env, svc, day, hour in partitions:
        values = dict(env=env, service=svc, archive_date=day, archive_hour=hour)
        assert env in enum["env"] and svc in enum["service"] and hour in enum["archive_hour"], values
        where = re.sub(r"\$\{(\w+)\}", lambda x: values[x.group(1)], template)
        trino(f"CALL hive.system.register_partition('logs', '{name}', ARRAY[{', '.join(repr(n) for n in names)}], "
              f"ARRAY[{', '.join(repr(values[n]) for n in names)}], 'local://{where}')")
    return name, len(data_cols)


def check_sql(expected, partitions):
    ddl = render.build([f"{ATHENA}/create-table.sql", "--bucket", "fixture-bucket", "--start-date", "2026-10-01"])
    name, ncols = trino_table(ddl, partitions)
    n = trino(f"SELECT count(*) AS n FROM {name}")[0]["n"]
    print(f"Trino 테이블 {name}: 데이터 열 {ncols}, 파티션 {len(partitions)}, 행 {n}")
    # ignore.malformed.json: 깨진 JSON 줄이 든 객체(canary 파티션)가 있어도 질의가 실패하지 않고 나머지 줄을 읽는다(깨진 줄은 전부 NULL 행).
    try:
        rows = trino("SELECT count(*) AS n, count(log_id) AS ok FROM ops_logs WHERE service = 'canary'")[0]
        check(rows["n"] == 3 and rows["ok"] == 2, "깨진 JSON 줄이 든 객체 조회 — 실패하지 않고 정상 2줄 + 전부 NULL 1행", str(rows))
    except RuntimeError as error:
        check(False, "깨진 JSON 줄이 든 객체 조회", str(error))
    # 파티션 범위 주석(첫 줄)의 date·hour 목록이 WHERE 의 archive_date·archive_hour 값과 같은지 — 0행일 때 «어디까지 봤나»를 믿을 수 있는지.
    for margin in ([], ["--margin-hours", "0"]):
        sql = render.build([f"{ATHENA}/by-request.sql"] + expected["sql_window"] + ["--request-id", "req-r1"] + margin)
        head, _, body = sql.partition("\n")
        want = [(d, tuple(h.split(","))) for d, h in re.findall(r"date=(\S+) hour=([\d,]+)", head)]
        got = [(d, tuple(re.findall(r"'(\d\d)'", hs)))
               for d, hs in re.findall(r"\(archive_date = '([\d-]+)' AND archive_hour IN \(([^)]*)\)\)", body)]
        check(head.startswith("-- render.py 파티션 범위") and want and want == got,
              f"render.py 파티션 범위 주석 = WHERE ({' '.join(margin) or '기본 여유'})", f"header={want} where={got}")
    for case in expected["sql"]:
        sql = render.build([f"{ATHENA}/{case['template']}"] + expected["sql_window"] + case["args"])
        try:
            rows = trino(sql)
        except RuntimeError as error:
            check(False, f"SQL {case['name']}", str(error))
            continue
        got = dict(collections.Counter(fid(r) for r in rows))
        check(got == case["rows"], f"SQL {case['name']} — {len(rows)}행", f"got={got} want={case['rows']}")
        for f, flags in case.get("flags", {}).items():
            mine = [r for r in rows if fid(r) == f]
            bad = [{k: r.get(k) for k in flags} for r in mine if any(r.get(k) != v for k, v in flags.items())]
            check(mine and not bad, f"SQL {case['name']} — {f} {flags}", f"rows={len(mine)} got={bad[:2]}")


def main():
    expected = json.load(open(f"{FIX}/expected.json", encoding="utf-8"))
    dash = load_dashboard()
    rows = fixture_rows()
    partitions = write_objects(rows)
    bad = f"{DATA}/system_log/v2/env=dev/service=canary/date=2026-10-29/hour=13"
    os.makedirs(bad, exist_ok=True)
    with gzip.open(f"{bad}/fixture-malformed-00000000.json.gz", "wt", encoding="utf-8") as f:
        f.write('{"log_id": "canary-1", "service": "canary"}\n{"log_id": "canary-2" BROKEN\n{"log_id": "canary-3"}\n')
    partitions.append(("dev", "canary", "2026-10-29", "13"))
    print(f"fixture: {len(rows)}행, S3 객체 파티션 {partitions}")

    wait("Loki", lambda: urllib.request.urlopen(f"{LOKI}/ready", timeout=3).status == 200)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    shift = (now - timedelta(minutes=50)) - FIXTURE_BASE  # 초 단위 이동 — observed_at(초 해상도)이 어긋나지 않게
    push_loki(rows, shift)
    loki = Loki(FIXTURE_BASE + shift - timedelta(minutes=50), now + timedelta(minutes=1))
    wait("Loki 적재", lambda: loki.count('sum(count_over_time({env="dev"} [3h]))') == len(rows), 60)
    check_variables(dash)
    check_loki(dash, expected, loki)
    check_links(dash)

    wait("Grafana", lambda: grafana("/api/health")["database"] == "ok")
    check_grafana(dash, expected, loki)

    wait("Trino", lambda: trino("SELECT 1 AS x")[0]["x"] == 1, 240)
    check_sql(expected, partitions)

    print(f"\n실패 {len(failures)}건" + ("" if not failures else ": " + " / ".join(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
