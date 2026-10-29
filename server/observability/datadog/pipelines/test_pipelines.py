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
    """한 파이프라인을 근사 실행한다. 가정(문서 명시 문장 없음, 원격 미검증):
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

    def test_approx_unmapped_lines_keep_collected_status(self):
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


class PartialApplyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.record = self.tmp / "record.json"
        env = mock.patch.dict(os.environ, {manage.CONFIRM_ENV: "yes"})
        env.start()
        self.addCleanup(env.stop)

    def execute(self, fail_on):
        with mock.patch.object(manage, "Api", lambda: FakeApi(fail_on)), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                manage.main(["apply", "--execute", "--record-out", str(self.record)])
        self.assertNotEqual(cm.exception.code, 0)
        self.assertIn("부분 적용", str(cm.exception.code))
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


if __name__ == "__main__":
    unittest.main()
