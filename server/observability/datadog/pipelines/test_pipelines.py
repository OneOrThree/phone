"""GROMO-2572 파이프라인 정의의 로컬 근사 검증.

**Datadog Grok 실행이 아닌 근사 검증이다.** JSON 정의의 grok 규칙을 아래 작은 변환기로 Python 정규식으로 옮기고,
lookup 표와 Status Remapper 문서 규칙을 Python 으로 흉내 내 fixture 의 기대 status 를 단언한다.
변환기는 쓰는 matcher 만 지원하고, 모르는 matcher·filter 가 나오면 실패한다.
Datadog 원격 validation·apply 는 하지 않는다(docs/architecture/server-log-observability/datadog-severity-pipeline.md).

실행: python3 -m unittest discover -s server/observability/datadog/pipelines -p 'test_*.py'
"""

import contextlib
import io
import json
import os
import re
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import manage

HERE = Path(__file__).resolve().parent


class Unsupported(Exception):
    pass


# --- grok → Python 정규식 근사 변환 (문서: https://docs.datadoghq.com/logs/log_configuration/parsing/) ---

TOKEN = re.compile(r'%\{(?P<m>\w+)(?:\((?P<args>(?:"(?:\\.|[^"\\])*"|[^)"])*)\))?(?::(?P<x>[\w.]*))?(?::(?P<f>[^}]*))?\}')
SIMPLE = {  # 문서의 matcher 설명을 옮긴 근사치
    "word": r"\b\w+\b",
    "notSpace": r"\S+",
    "integer": r"[+-]?\d+",
    "number": r"[+-]?(?:\d+(?:\.\d+)?|\.\d+)",
    "data": r"(?s:.*)",  # "any string including spaces and newlines"
}
CAST = {"integer": int, "number": float}
DATE = {"yyyy": r"\d{4}", "MM": r"\d{2}", "dd": r"\d{2}", "HH": r"\d{2}", "mm": r"\d{2}", "ss": r"\d{2}"}


# 경고: regex("…") 안에 `\d` 등 이스케이프를 쓰면 이 변환기(\\·\" 만 풂)와 Datadog 해석이 갈릴 수 있다 — 그때는 UI 샘플로 확인한다.
def _string_args(args):
    """regex("…")·date("…") 인자. 문자열 리터럴의 \\\\·\\" 만 푼다(문서 예 `regex("\\\\w")` → 정규식 \\w)."""
    return [re.sub(r'\\(.)', lambda m: m.group(1) if m.group(1) in '\\"' else m.group(0), s)
            for s in re.findall(r'"((?:\\.|[^"\\])*)"', args or "")]


def _date_regex(pattern):
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if not c.isalpha():
            out.append(re.escape(c))
            i += 1
            continue
        j = i
        while j < len(pattern) and pattern[j] == c:
            j += 1
        run = pattern[i:j]
        if c == "S":
            out.append(r"\d{%d}" % len(run))
        elif run in DATE:
            out.append(DATE[run])
        else:
            raise Unsupported(f"date 패턴 {run}")
        i = j
    return "".join(out)


def translate(rule_body):
    out, attrs, pos = [], [], 0
    literals = TOKEN.split(rule_body)[::TOKEN.groups + 1]
    if any("%{" in chunk for chunk in literals):
        raise Unsupported("해석 못 한 %{ 토큰")
    for m in TOKEN.finditer(rule_body):
        out.append(rule_body[pos:m.start()])
        pos = m.end()
        name = m["m"]
        if m["f"]:
            raise Unsupported(f"filter {m['f']}")
        if name == "regex":
            pat = _string_args(m["args"])[0]
        elif name == "date":
            pat = _date_regex(_string_args(m["args"])[0])
        elif name in SIMPLE and m["args"] is None:
            pat = SIMPLE[name]
        else:
            raise Unsupported(f"matcher {name}")
        if m["x"]:
            out.append(f"(?P<g{len(attrs)}>{pat})")
            attrs.append((m["x"], name))
        else:
            out.append(f"(?:{pat})")
    out.append(rule_body[pos:])
    return re.compile("".join(out)), attrs


def compile_rules(grok):
    if grok.get("support_rules", "").strip():
        raise Unsupported("support_rules")
    rules = []
    for line in grok["match_rules"].splitlines():
        if line.strip():
            name, _, rule = line.partition(" ")
            rules.append((name, *translate(rule)))
    return rules


def parse(rules, text):
    """문서: 규칙은 로그 전체에 맞아야 하고, 위에서부터 처음 맞는 규칙 하나만 쓴다."""
    for _, rx, attrs in rules:
        m = rx.fullmatch(text)
        if m:
            return {a: CAST.get(kind, str)(m[f"g{i}"]) for i, (a, kind) in enumerate(attrs)}
    return {}


# --- Status Remapper 문서 규칙 (https://docs.datadoghq.com/logs/log_configuration/processors/log_status_remapper/) ---

SYSLOG = ["emerg", "alert", "critical", "error", "warning", "notice", "info", "debug"]
RANK = {s: i for i, s in enumerate(SYSLOG)}


def remap_status(value):
    if isinstance(value, int) and 0 <= value <= 7:
        return SYSLOG[value]
    s = str(value).lower()
    if s.startswith(("emerg", "f")):
        return "emerg"
    if s.startswith("a"):
        return "alert"
    if s.startswith("c"):
        return "critical"
    if s.startswith("err"):
        return "error"
    if s.startswith("w"):
        return "warning"
    if s.startswith("n"):
        return "notice"
    if s.startswith("i"):
        return "info"
    if s.startswith(("d", "t", "v")):
        return "debug"
    if s.startswith(("o", "s")):
        return "ok"
    return "info"  # "All others map to info (6)"


def simulate(pipeline, message, initial_status):
    """한 파이프라인을 근사 실행한다. 이 함수에 기대는 단언은 «가정 의존(default_lookup 생략·remapper source 부재)». 가정(문서 명시 문장 없음, 원격 미검증):
    lookup 은 source 속성이 없거나 표에 없고 default_lookup 이 없으면 target 을 만들지 않고,
    status remapper 는 sources 속성이 하나도 없으면 status 를 바꾸지 않는다."""
    attrs, status, remapped = {"message": message}, initial_status, False
    for p in pipeline["processors"]:
        if not p.get("is_enabled"):
            continue
        kind = p["type"]
        if kind == "grok-parser":
            if p["source"] in attrs:
                attrs.update(parse(compile_rules(p["grok"]), attrs[p["source"]]))
        elif kind == "lookup-processor":
            if p["source"] in attrs:
                table = dict(row.split(",", 1) for row in p["lookup_table"])
                value = table.get(str(attrs[p["source"]]), p.get("default_lookup"))
                if value is not None:
                    attrs[p["target"]] = value
        elif kind == "status-remapper":
            hit = next((s for s in p["sources"] if s in attrs), None)
            if not remapped and hit:  # first write wins
                status, remapped = remap_status(attrs[hit]), True
        else:
            raise Unsupported(f"processor {kind}")
    return status, attrs


def definition(name):
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def fixtures(name):
    return [json.loads(l) for l in (HERE / "fixtures" / name).read_text(encoding="utf-8").splitlines() if l.strip()]


CASES = (("kafka-exporter.json", "kafka-exporter.jsonl"), ("postgres.json", "postgres.jsonl"))


class ApproxConverterTest(unittest.TestCase):
    """근사 변환기 자체 점검 — Datadog Grok 실행이 아니다."""

    def test_approx_converter_reproduces_datadog_doc_glog_example(self):
        # 문서 Parsing > Glog format 의 규칙·예시 줄·추출 결과
        rule = r'%{regex("\\w"):level}%{date("MMdd HH:mm:ss.SSSSSS"):timestamp}\s+%{number:logger.thread_id} %{notSpace:logger.name}:%{number:logger.lineno}\] %{data:msg}'
        got = parse([("kube_scheduler", *translate(rule))], "W0424 11:47:41.605188       1 authorization.go:47] Authorization is disabled")
        self.assertEqual((got["level"], got["logger.name"], got["msg"]), ("W", "authorization.go", "Authorization is disabled"))

    def test_approx_converter_rejects_unknown_matcher_and_filter(self):
        for rule in ("%{ipOrHost:x}", "%{data::json}", "%{word:x:lowercase}"):
            with self.subTest(rule=rule), self.assertRaises(Unsupported):
                translate(rule)


class StatusRemapperRuleTest(unittest.TestCase):
    """Status Remapper 문서 규칙 근사 — 원문 레벨을 그대로 넘기면 안 되는 이유."""

    def test_raw_levels_fall_into_documented_traps(self):
        trap = {"E": "info", "F": "emerg", "FATAL": "emerg", "PANIC": "info", "LOG": "info"}
        self.assertEqual({k: remap_status(k) for k in trap}, trap)

    def test_lookup_values_are_read_as_intended(self):
        want = {"debug": "debug", "info": "info", "notice": "notice", "warning": "warning",
                "error": "error", "critical": "critical", "emergency": "emerg"}
        for name, _ in CASES:
            lookup = next(p for p in definition(name)["processors"] if p["type"] == "lookup-processor")
            for row in lookup["lookup_table"]:
                value = row.split(",", 1)[1]
                with self.subTest(pipeline=name, row=row):
                    self.assertEqual(remap_status(value), want[value])


class PipelineDefinitionTest(unittest.TestCase):

    def test_filters(self):
        self.assertEqual(manage.sources_in(definition("kafka-exporter.json")["filter"]["query"]), {"kafka-exporter"})
        self.assertEqual(manage.sources_in(definition("postgres.json")["filter"]["query"]), {"postgres", "postgresql"})

    def test_lookup_tables_are_explicit_without_default(self):
        """가정 의존(default_lookup 생략): 생략하면 미인식 값에 target 이 생기지 않는다는 가정 위에서 의미가 있다."""
        want = {
            "kafka-exporter.json": {"I": "info", "W": "warning", "E": "error", "F": "critical"},
            "postgres.json": {**{f"DEBUG{i}": "debug" for i in range(1, 6)}, "LOG": "info", "INFO": "info",
                              "NOTICE": "notice", "WARNING": "warning", "ERROR": "error",
                              "FATAL": "critical", "PANIC": "emergency"},
        }
        for name, table in want.items():
            lookup = next(p for p in definition(name)["processors"] if p["type"] == "lookup-processor")
            with self.subTest(pipeline=name):
                self.assertEqual(dict(r.split(",", 1) for r in lookup["lookup_table"]), table)
                self.assertNotIn("default_lookup", lookup)  # 미인식 값을 info 로 내리지 않는다

    def test_processors_are_chained_grok_lookup_remapper(self):
        for name, _ in CASES:
            d = definition(name)
            grok, lookup, remap = d["processors"]
            with self.subTest(pipeline=name):
                self.assertEqual([p["type"] for p in d["processors"]], ["grok-parser", "lookup-processor", "status-remapper"])
                self.assertTrue(all(p["is_enabled"] for p in d["processors"]) and d["is_enabled"])
                extracted = {a for _, _, attrs in compile_rules(grok["grok"]) for a, _ in attrs}
                self.assertIn(lookup["source"], extracted)
                self.assertEqual(remap["sources"], [lookup["target"]])
                self.assertLessEqual(len(grok["samples"]), 5)  # API: "up to 5"

    def test_grok_samples_are_covered_by_fixtures(self):
        for name, fx in CASES:
            messages = {f["message"] for f in fixtures(fx)}
            grok = definition(name)["processors"][0]
            with self.subTest(pipeline=name):
                self.assertLessEqual(set(grok["samples"]), messages)


class ApproxFixtureTest(unittest.TestCase):
    """fixture 줄별 기대 status — Datadog Grok 실행이 아닌 근사 검증."""

    def run_all(self):
        for name, fx in CASES:
            d = definition(name)
            for f in fixtures(fx):
                self.assertIn(f["source"], manage.sources_in(d["filter"]["query"]), f["id"])
                status, attrs = simulate(d, f["message"], f["initial_status"])
                yield d, f, status, attrs

    def test_approx_fixture_statuses(self):
        for _, f, status, _ in self.run_all():
            with self.subTest(id=f["id"]):
                self.assertIn(f["origin"], ("docker-real", "synthetic"))
                self.assertEqual(f["initial_status"], {"stderr": "error", "stdout": "info"}[f["stream"]])
                self.assertEqual(status, f["expected_status"])

    def test_approx_two_normal_false_positives_become_info(self):
        got = {f["id"]: (f["initial_status"], status) for _, f, status, _ in self.run_all()}
        self.assertEqual(got["exp-real-info"], ("error", "info"))
        self.assertEqual(got["pg-real-checkpoint-complete"], ("error", "info"))

    def test_approx_real_and_synthetic_errors_are_not_downgraded(self):
        hard = re.compile(r"^[EF]\d{4} |\] (ERROR|FATAL|PANIC):")
        seen = 0
        for _, f, status, _ in self.run_all():
            if hard.search(f["message"]):
                seen += 1
                with self.subTest(id=f["id"]):
                    self.assertLessEqual(RANK[status], RANK["error"])
        self.assertEqual(seen, 7)  # 실제 E 2·F 2 + 합성 ERROR·FATAL·PANIC

    def test_approx_unmapped_lines_keep_collected_status_assumption_dependent(self):
        """가정 의존(default_lookup 생략·remapper source 부재): DETAIL·연속 줄이 error 로 남는다는 단언은 두 가정이 참일 때만 성립한다. Datadog 동작의 증거가 아니다."""
        stderr_kept = 0
        for d, f, status, attrs in self.run_all():
            target = next(p["target"] for p in d["processors"] if p["type"] == "lookup-processor")
            if target not in attrs:
                with self.subTest(id=f["id"]):
                    self.assertEqual(status, f["initial_status"])
                stderr_kept += f["stream"] == "stderr"
        self.assertGreaterEqual(stderr_kept, 10)


class ManageOfflineTest(unittest.TestCase):
    """manage.py 의 오프라인 경로. urlopen 이 불리면 실패한다."""

    def setUp(self):
        patcher = mock.patch("urllib.request.urlopen", side_effect=AssertionError("네트워크 호출 금지"))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.tmp = Path(tempfile.mkdtemp())
        listing = [  # MCP execute_code(listLogsPipelines) 와 같은 camelCase·jsonrpc 래핑
            {"id": "K", "name": "Kafka", "isEnabled": True, "isReadOnly": True, "filter": {"query": "source:kafka"}, "processors": []},
            {"id": "P", "name": "Postgres", "isEnabled": True, "isReadOnly": True, "filter": {"query": "source:postgresql"}, "processors": []},
        ]
        wrap = {"jsonrpc": "2.0", "result": {"content": [{"type": "text", "text": json.dumps({"outcome": "success", "value": listing})}]}}
        self.backup = self.tmp / "backup.json"
        self.backup.write_text(json.dumps(wrap))

    def run_main(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            manage.main(list(argv))
        return buf.getvalue()

    def test_plan_creates_both_and_reports_postgresql_overlap(self):
        out = self.run_main("plan", "--backup-file", str(self.backup))
        self.assertEqual(out.count("create"), 2)
        self.assertIn("'GROMO PostgreSQL severity' ↔ 'Postgres' (P) source=['postgresql']", out)
        self.assertNotIn("↔ 'Kafka'", out)  # source:kafka 는 kafka-exporter 와 다른 값

    def test_apply_dry_run_record_then_rollback_dry_run(self):
        record = self.tmp / "record.json"
        self.run_main("apply", "--backup-file", str(self.backup), "--record-out", str(record))
        rec = json.loads(record.read_text())
        self.assertTrue(rec["dry_run"])
        self.assertEqual(rec["order_before"], ["K", "P"])
        out = self.run_main("rollback", "--record", str(record), "--backup-file", str(self.backup))
        self.assertEqual(out.count("DELETE"), 2)
        self.assertIn("순서: 백업과 같음", out)
        with self.assertRaises(SystemExit):
            self.run_main("rollback", "--record", str(record), "--execute")

    def test_execute_needs_env_gate_and_live_state(self):
        with mock.patch.dict(os.environ, {manage.CONFIRM_ENV: ""}):
            with self.assertRaises(SystemExit):
                self.run_main("apply", "--execute", "--record-out", str(self.tmp / "r.json"))
        with mock.patch.dict(os.environ, {manage.CONFIRM_ENV: "yes"}):
            with self.assertRaises(SystemExit):
                self.run_main("apply", "--execute", "--backup-file", str(self.backup))

    def test_restored_order_keeps_backup_order_and_appends_newcomers(self):
        self.assertEqual(manage.restored_order(["a", "b", "c"], ["a", "new", "c", "b", "x"], {"new"}), ["a", "b", "c", "x"])


class DuplicateNameTest(unittest.TestCase):
    def setUp(self):
        self.defs = manage.load_definitions()
        name = self.defs[0]["name"]
        self.dup = [{"id": i, "name": name, "filter": self.defs[0]["filter"]} for i in ("A", "B")]
        self.state = {"pipelines": self.dup, "order": ["A", "B"], "origin": "t"}
        self.tmp = Path(tempfile.mkdtemp())

    def test_two_same_name_aborts_plan_and_apply_without_writes(self):
        backup = self.tmp / "b.json"
        backup.write_text(json.dumps({"pipelines": self.dup, "pipeline_order": {"pipeline_ids": ["A", "B"]}}))
        api = mock.Mock()
        for argv in (["plan"], ["apply", "--record-out", str(self.tmp / "r.json")]):
            with mock.patch.object(manage, "Api", lambda: api), contextlib.redirect_stdout(io.StringIO()) as buf:
                with self.assertRaises(SystemExit):
                    manage.main(argv + ["--backup-file", str(backup)])
            self.assertIn("동명 중복", buf.getvalue())
        api.call.assert_not_called()
        self.assertIn("동명 중복", json.loads((self.tmp / "r.json").read_text())["aborted"])

    def test_overlap_lists_other_same_name_pipeline_but_not_the_update_target(self):
        one = {"id": "A", "name": self.defs[0]["name"], "filter": self.defs[0]["filter"]}
        other = {"id": "B", "name": self.defs[0]["name"], "filter": self.defs[0]["filter"]}
        st = {"pipelines": [one], "order": ["A"], "origin": "t"}
        self.assertEqual(manage.duplicates(self.defs, st), {})
        self.assertEqual([k for k, _, _ in manage.plan_actions(self.defs, st)][0], "update")
        self.assertFalse([l for l in manage.overlaps(self.defs, st, manage.plan_actions(self.defs, st)) if "(A)" in l])
        st["pipelines"].append(other)  # 동명 2개면 plan_actions 는 동작을 만들지 않는다 — 겹침은 두 ID 모두 나온다
        lines = manage.overlaps(self.defs, st, [("update", self.defs[0], one)])
        self.assertTrue(any("(B)" in l for l in lines) and not any("(A)" in l for l in lines))


class FakeApi:
    """네트워크 없는 전송. fail_on=(method, n) 이면 그 method 의 n 번째 호출이 HTTP 실패(SystemExit)한다."""

    def __init__(self, fail_on=None):
        self.fail_on, self.counts, self.calls = fail_on, {}, []

    def state(self):
        return {"pipelines": [], "order": ["K"], "origin": "fake"}

    def call(self, method, path, body=None):
        n = self.counts[method] = self.counts.get(method, 0) + 1
        self.calls.append((method, path))
        if self.fail_on == (method, n):
            raise SystemExit(f"{method} {path} → HTTP 500")
        if method == "POST":
            return {"id": f"NEW{n}"}
        return {"pipeline_ids": ["K", "NEW1", "NEW2"]} if method == "GET" else None


class UnknownApi(FakeApi):
    """n 번째 POST 가 응답 없이 끝난다(서버 반영 여부 불명)."""

    def call(self, method, path, body=None):
        if self.fail_on == (method, self.counts.get(method, 0) + 1):
            self.counts[method] = self.counts.get(method, 0) + 1
            raise manage.ApiError(f"{method} {path} → 응답 없음(TimeoutError)", unknown=True)
        return super().call(method, path, body)


class PartialApplyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.record = self.tmp / "record.json"
        env = mock.patch.dict(os.environ, {manage.CONFIRM_ENV: "yes"})
        env.start()
        self.addCleanup(env.stop)

    def execute(self, fail_on, expect="부분 적용", api=FakeApi):
        with mock.patch.object(manage, "Api", lambda: api(fail_on)), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                manage.main(["apply", "--execute", "--record-out", str(self.record)])
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn(expect, str(cm.exception.code))
        return json.loads(self.record.read_text())

    def rollback_dry_run(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            manage.main(["rollback", "--record", str(self.record), "--backup-file", str(self.backup())])
        return buf.getvalue()

    def backup(self):
        f = self.tmp / "b.json"
        f.write_text(json.dumps({"pipelines": [], "pipeline_order": {"pipeline_ids": ["K", "NEW1", "NEW2"]}}))
        return f

    def test_second_create_fails_record_keeps_first_id_and_rollback_deletes_only_it(self):
        rec = self.execute(("POST", 2))
        self.assertEqual([c["id"] for c in rec["created"]], ["NEW1"])
        self.assertEqual([s["result"] for s in rec["steps"]], ["ok", "failed", "not-run"])
        self.assertTrue(rec["partial"])
        out = self.rollback_dry_run()
        self.assertEqual(out.count("DELETE"), 1)
        self.assertIn("/NEW1", out)

    def test_order_lookup_fails_after_both_creates(self):
        rec = self.execute(("GET", 1))
        self.assertEqual([c["id"] for c in rec["created"]], ["NEW1", "NEW2"])
        self.assertEqual(rec["steps"][-1]["result"], "failed")
        self.assertEqual(self.rollback_dry_run().count("DELETE"), 2)

    def test_first_create_fails_says_no_change_and_no_rollback_needed(self):
        rec = self.execute(("POST", 1), expect="변경 없음 — 롤백 불필요")
        self.assertFalse(rec["partial"])
        self.assertEqual(rec["created"], [])

    def test_write_without_response_is_recorded_unknown_with_check_guidance(self):
        rec = self.execute(("POST", 2), expect="서버 상태를 직접 조회", api=UnknownApi)
        self.assertEqual([s["result"] for s in rec["steps"]], ["ok", "unknown", "not-run"])
        self.assertEqual([c["id"] for c in rec["created"]], ["NEW1", None])  # 둘째는 결과 불명 pending

    def test_api_call_turns_urlerror_and_timeout_into_unknown_for_writes_only(self):
        with mock.patch.dict(os.environ, {"DD_API_KEY": "k", "DD_APP_KEY": "a"}):
            api = manage.Api()
        for exc in (urllib.error.URLError("down"), TimeoutError("t")):
            with mock.patch("urllib.request.urlopen", side_effect=exc):
                with self.assertRaises(manage.ApiError) as w:
                    api.call("POST", manage.PIPELINES, {})
                self.assertTrue(w.exception.unknown)
                with self.assertRaises(manage.ApiError) as r:
                    api.call("GET", manage.PIPELINES)
                self.assertFalse(r.exception.unknown)

    def test_http_5xx_on_write_is_unknown_but_4xx_and_get_are_not(self):
        with mock.patch.dict(os.environ, {"DD_API_KEY": "k", "DD_APP_KEY": "a"}):
            api = manage.Api()
        for method, code, unknown in (("POST", 503, True), ("PUT", 502, True), ("POST", 400, False), ("GET", 503, False)):
            err = urllib.error.HTTPError("https://x", code, "e", {}, io.BytesIO(b"x"))
            with self.subTest(method=method, code=code), mock.patch("urllib.request.urlopen", side_effect=err):
                with self.assertRaises(manage.ApiError) as w:
                    api.call(method, manage.PIPELINES, {})
                self.assertEqual((w.exception.status, w.exception.unknown), (code, unknown))

    def test_rerun_after_unknown_create_is_update_not_duplicate(self):
        defs = manage.load_definitions()
        state = {"pipelines": [{"id": "X", "name": defs[0]["name"]}], "order": ["X"], "origin": "t"}
        kinds = {d["name"]: k for k, d, _ in manage.plan_actions(defs, state)}
        self.assertEqual(kinds[defs[0]["name"]], "update")

    def test_dd_site_outside_official_list_is_rejected(self):
        env = {"DD_API_KEY": "k", "DD_APP_KEY": "a"}
        for site in ("evil.example.com", "datadoghq.com.evil.io", "api.datadoghq.com/x"):
            with mock.patch.dict(os.environ, {**env, "DD_SITE": site}):
                with self.assertRaises(SystemExit):
                    manage.Api()
        for site in ("datadoghq.com", "us5.datadoghq.com", "datadoghq.eu", "ddog-gov.com"):
            with mock.patch.dict(os.environ, {**env, "DD_SITE": site}):
                self.assertEqual(manage.Api().site, site)


class RollbackExecuteApi:
    """서버 상태를 가진 가짜. pipelines={id: name}. fail_delete 이면 그 id 의 DELETE 가 한 번 응답 없이 끝난다."""

    def __init__(self, pipelines, fail_delete=None):
        self.pipelines, self.fail_delete, self.calls = dict(pipelines), fail_delete, []
        self.order = list(pipelines)

    def state(self):
        return {"pipelines": [], "order": self.order, "origin": "fake"}

    def call(self, method, path, body=None):
        self.calls.append((method, path))
        if path == manage.ORDER:
            return {"pipeline_ids": self.order}
        pid = path.rsplit("/", 1)[1]
        if pid not in self.pipelines:
            raise manage.ApiError(f"{method} {path} → HTTP 404", status=404)
        if method == "GET":
            return {"id": pid, "name": self.pipelines[pid]}
        if method == "DELETE":
            if self.fail_delete == pid:
                self.fail_delete = None
                raise manage.ApiError(f"DELETE {path} → HTTP 503", status=503)
            del self.pipelines[pid]
            self.order.remove(pid)
        return None


class RollbackExecuteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.record = self.tmp / "rec.json"
        self.record.write_text(json.dumps({
            "dry_run": False, "partial": False, "order_before": ["K"], "updated": [],
            "created": [{"name": "A", "id": "N1"}, {"name": "B", "id": "N2"}],
        }))
        env = mock.patch.dict(os.environ, {manage.CONFIRM_ENV: "yes"})
        env.start()
        self.addCleanup(env.stop)

    def run_rollback(self, api, *extra):
        with mock.patch.object(manage, "Api", lambda: api), contextlib.redirect_stdout(io.StringIO()) as buf:
            manage.main(["rollback", "--record", str(self.record), "--execute", *extra])
        return buf.getvalue()

    def test_rerun_after_second_delete_failed_skips_already_deleted_first(self):
        api = RollbackExecuteApi({"K": "k", "N1": "A", "N2": "B"}, fail_delete="N2")
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_rollback(api)
        self.assertEqual(json.loads(self.record.read_text())["rollback"], {"N1": "deleted"})
        out = self.run_rollback(api)
        self.assertIn("건너뜀", out)
        self.assertEqual(api.pipelines, {"K": "k"})
        self.assertEqual(api.calls.count(("DELETE", f"{manage.PIPELINES}/N1")), 1)

    def test_404_is_treated_as_already_gone(self):
        api = RollbackExecuteApi({"K": "k", "N2": "B"})  # N1 은 이미 없음
        out = self.run_rollback(api)
        self.assertIn("이미 없음", out)
        self.assertEqual(json.loads(self.record.read_text())["rollback"]["N1"], "already-gone")
        self.assertEqual(api.pipelines, {"K": "k"})

    def test_name_mismatch_stops_that_item_and_never_deletes_it(self):
        api = RollbackExecuteApi({"K": "k", "N1": "다른 파이프라인", "N2": "B"})
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_rollback(api)
        self.assertIn("N1", api.pipelines)
        self.assertNotIn(("DELETE", f"{manage.PIPELINES}/N1"), api.calls)
        self.assertNotIn("N2", api.pipelines)  # 나머지 항목은 계속 진행


class UpdateLostResponseTest(unittest.TestCase):
    """PUT 이 서버에 반영된 뒤 응답만 유실 → 기록에 previous 가 남고, 롤백이 복원하며 두 번째 실행은 건너뛴다."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.record = self.tmp / "rec.json"
        self.defn = manage.load_definitions()[0]
        self.old = {**manage.body(self.defn), "description": "옛 정의"}
        env = mock.patch.dict(os.environ, {manage.CONFIRM_ENV: "yes"})
        env.start()
        self.addCleanup(env.stop)

    def server(self, lose_put_response=True):
        outer = self
        stored = {"P1": {"id": "P1", **self.old}}

        class Api:
            calls = []

            def state(self_):
                return {"pipelines": [dict(stored["P1"], name=outer.defn["name"])], "order": ["P1"], "origin": "fake"}

            def call(self_, method, path, body=None):
                self_.calls.append((method, path))
                if path == manage.ORDER:
                    return {"pipeline_ids": ["P1"]}
                if path.rsplit("/", 1)[1] not in stored:
                    raise manage.ApiError("404", status=404)
                if method == "GET":
                    return stored["P1"]
                stored["P1"] = {"id": "P1", **body}  # 서버에 반영
                if lose_put_response and method == "PUT" and self_.calls.count(("PUT", path)) == 1:
                    raise manage.ApiError("PUT → 응답 없음(TimeoutError)", unknown=True)
                return None

        api = Api()
        api.stored = stored
        return api

    def run_cmd(self, api, *argv):
        with mock.patch.object(manage, "Api", lambda: api), contextlib.redirect_stdout(io.StringIO()) as buf:
            manage.main(list(argv))
        return buf.getvalue()

    def test_previous_survives_lost_put_response_and_rollback_restores_once(self):
        api = self.server()
        with self.assertRaises(SystemExit):
            self.run_cmd(api, "apply", "--execute", "--record-out", str(self.record))
        rec = json.loads(self.record.read_text())
        self.assertEqual(rec["steps"][0]["result"], "unknown")
        self.assertEqual(rec["updated"][0]["previous"], self.old)
        self.assertEqual(api.stored["P1"]["description"], self.defn["description"])  # 서버엔 반영됨
        self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertEqual(manage.body(api.stored["P1"]), self.old)
        puts = api.calls.count(("PUT", f"{manage.PIPELINES}/P1"))
        out = self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertIn("건너뜀", out)
        self.assertEqual(api.calls.count(("PUT", f"{manage.PIPELINES}/P1")), puts)

    def test_unreflected_update_is_skipped_as_already_previous(self):
        api = self.server(lose_put_response=False)
        self.record.write_text(json.dumps({"dry_run": False, "order_before": ["P1"], "created": [],
                                           "updated": [{"name": self.defn["name"], "id": "P1", "previous": self.old}]}))
        out = self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertIn("이미 이전 정의", out)
        self.assertNotIn(("PUT", f"{manage.PIPELINES}/P1"), api.calls)

    def test_updated_404_prints_no_target_warning(self):
        api = self.server(lose_put_response=False)
        self.record.write_text(json.dumps({"dry_run": False, "order_before": [], "created": [],
                                           "updated": [{"name": "x", "id": "GONE", "previous": {}}]}))
        self.assertIn("복원 대상 없음", self.run_cmd(api, "rollback", "--record", str(self.record), "--execute"))


class CreateLostResponseTest(unittest.TestCase):
    """POST 가 서버에 반영된 뒤 응답만 유실 → 기록에 pending 생성 → rollback 이 이름으로 찾아 회수한다."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.record = self.tmp / "rec.json"
        self.defs = manage.load_definitions()
        env = mock.patch.dict(os.environ, {manage.CONFIRM_ENV: "yes"})
        env.start()
        self.addCleanup(env.stop)

    def server(self, lose_first_post=True):
        outer, stored, order = self, {}, ["K"]

        class Api:
            calls = []

            def state(self_):
                return {"pipelines": [{"id": i, **b} for i, b in stored.items()], "order": order, "origin": "fake"}

            def call(self_, method, path, body=None):
                self_.calls.append((method, path))
                if path == manage.ORDER:
                    return {"pipeline_ids": order}
                if method == "POST":
                    pid = f"S{len(stored) + 1}"
                    stored[pid] = body
                    order.append(pid)
                    if lose_first_post and self_.calls.count(("POST", path)) == 1:
                        raise manage.ApiError("POST → 응답 없음(TimeoutError)", unknown=True)
                    return {"id": pid}
                if path == manage.PIPELINES:
                    return self_.state()["pipelines"]
                pid = path.rsplit("/", 1)[1]
                if pid not in stored:
                    raise manage.ApiError("404", status=404)
                if method == "GET":
                    return {"id": pid, **stored[pid]}
                del stored[pid]
                order.remove(pid)

        api = Api()
        api.stored = stored
        return api

    def run_cmd(self, api, *argv):
        with mock.patch.object(manage, "Api", lambda: api), contextlib.redirect_stdout(io.StringIO()) as buf:
            manage.main(list(argv))
        return buf.getvalue()

    def apply_lost(self, api):
        with self.assertRaises(SystemExit):
            self.run_cmd(api, "apply", "--execute", "--record-out", str(self.record))
        return json.loads(self.record.read_text())

    def test_lost_post_leaves_pending_entry_and_rollback_recovers_by_name_then_is_idempotent(self):
        api = self.server()
        rec = self.apply_lost(api)
        self.assertEqual(rec["created"], [{"name": self.defs[0]["name"], "id": None, "pending": True}])
        self.assertEqual(list(api.stored), ["S1"])  # 서버엔 반영됨
        dry = self.run_cmd(api, "rollback", "--record", str(self.record))  # dry-run 도 회수 계획을 출력
        self.assertIn("DELETE", dry)
        self.assertIn("/S1", dry)
        self.assertEqual(list(api.stored), ["S1"])
        self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertEqual(api.stored, {})
        out = self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertIn("건너뜀", out)
        self.assertEqual(api.calls.count(("DELETE", f"{manage.PIPELINES}/S1")), 1)

    def test_rerun_apply_is_noop_but_points_to_previous_record(self):
        api = self.server()
        self.apply_lost(api)
        api.stored["S1"] = manage.body(self.defs[0])  # 서버 정의 == 로컬 → noop
        out = self.run_cmd(api, "apply", "--previous-record", str(self.record))
        self.assertIn("이전 기록의 결과 불명 생성", out)
        self.assertIn("변경 없음", out)

    def test_two_pipelines_with_same_name_abort_that_item(self):
        api = self.server()
        self.apply_lost(api)
        api.stored["S2"] = manage.body(self.defs[0])
        api.stored["S1"] = manage.body(self.defs[0])
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertEqual(set(api.stored), {"S1", "S2"})
        self.assertNotIn("DELETE", {m for m, _ in api.calls})

    def test_definition_mismatch_aborts_and_zero_matches_is_skipped(self):
        api = self.server()
        self.apply_lost(api)
        api.stored["S1"] = {**manage.body(self.defs[0]), "description": "누군가 바꿈"}
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertIn("S1", api.stored)
        api.stored.clear()  # 서버에 반영 안 된 경우
        out = self.run_cmd(api, "rollback", "--record", str(self.record), "--execute")
        self.assertIn("생성 안 됨 — 건너뜀", out)

    def test_definite_post_failure_removes_pending_entry(self):
        with mock.patch.object(manage, "Api", lambda: FakeApi(("POST", 1))), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                manage.main(["apply", "--execute", "--record-out", str(self.record)])
        self.assertEqual(json.loads(self.record.read_text())["created"], [])


class AbortedRecordRollbackTest(unittest.TestCase):
    """쓰기 전 중단된 기록(동명 중복 등)으로 rollback 해도 KeyError 없이 «되돌릴 것 없음»으로 끝난다."""

    def test_rollback_of_aborted_record_exits_cleanly_without_api(self):
        tmp = Path(tempfile.mkdtemp())
        rec = tmp / "rec.json"
        rec.write_text(json.dumps({"dry_run": True, "aborted": "동명 중복 파이프라인: {'A': ['1', '2']}", "created": [], "updated": [], "partial": False}))
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("네트워크 호출 금지")), \
                mock.patch.object(manage, "Api", side_effect=AssertionError("Api 금지")), contextlib.redirect_stdout(io.StringIO()) as buf:
            manage.main(["rollback", "--record", str(rec)])
        self.assertIn("중단 기록 — 되돌릴 것 없음", buf.getvalue())


class ServerDefaultsComparisonTest(unittest.TestCase):
    """서버가 채우는 기본값(SERVER_DEFAULTS)은 같음 판정에서 무시하고, 실제 내용 차이는 update 로 잡는다.
    서버 응답 모양은 Logs Pipelines API 문서의 선택 필드 기본값 기준의 합성 fixture 다(실제 응답 캡처 아님)."""

    def served(self, d):
        s = json.loads(json.dumps(d))
        s.update(id="S1", type="pipeline", is_read_only=False)
        for p in s["processors"]:
            if p["type"] == "lookup-processor":
                p["default_lookup"] = None
            if p["type"] == "status-remapper":
                p["samples"] = []
        return s

    def test_defaults_filled_by_server_are_noop(self):
        d = manage.load_definitions()[0]
        s = self.served(d)
        st = {"pipelines": [s], "order": ["S1"], "origin": "t"}
        self.assertEqual([a[0] for a in manage.plan_actions([d], st)], ["noop"])

    def test_empty_description_and_support_rules_equal_absent(self):
        d = json.loads(json.dumps(manage.load_definitions()[0]))
        d["description"] = ""
        d["processors"][0]["grok"]["support_rules"] = ""
        s = self.served(d)
        del s["description"]
        del s["processors"][0]["grok"]["support_rules"]
        self.assertTrue(manage.same(s, d))

    def test_real_difference_is_still_update(self):
        d = manage.load_definitions()[0]
        s = self.served(d)
        s["processors"][1]["source"] = "other.level"
        s["is_enabled"] = False
        self.assertFalse(manage.same(s, d))
        st = {"pipelines": [s], "order": ["S1"], "origin": "t"}
        self.assertEqual([a[0] for a in manage.plan_actions([d], st)], ["update"])

    def test_false_is_enabled_is_not_ignored(self):
        self.assertNotIn("is_enabled", manage.SERVER_DEFAULTS)


if __name__ == "__main__":
    unittest.main()
