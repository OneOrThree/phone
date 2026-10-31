"""Kafka 로그 링크 분리 검증 (GROMO-2573). 외부 연결 없음."""
import json, re, unittest
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
DASH = HERE / "gromo-dev-architecture.json"
DETAIL = "상세 조사"  # 로그·APM 링크 note 의 머리글
LINK = re.compile(r"\[([^\]]+)\]\((https://[^)\s]+)\)")


def widgets(d):
    return [w["definition"] for w in d["widgets"]]


def widget_by_title(d, title):
    """위젯을 제목으로 찾는다. 제목이 없는 note 는 첫 `### ` 머리글을 제목으로 본다. 순번에 기대지 않는다."""
    found = []
    for df in widgets(d):
        head = re.search(r"^###? (.+)$", df.get("content", ""), re.M)
        if (df.get("title") or (head and head.group(1))) == title:
            found.append(df)
    assert len(found) == 1, f"제목 {title!r} 위젯 {len(found)}개"
    return found[0]


def log_queries(d):
    out = {}
    for label, url in LINK.findall(widget_by_title(d, DETAIL).get("content", "")):
        u = urlparse(url)
        if u.path == "/logs" and "kafka" in url:
            out[label] = parse_qs(u.query)["query"][0]
    return out


def metric_queries(d):
    return sorted(r[k] for df in widgets(d) for r in df.get("requests", [])
                  for k in ("q",) if k in r)


def apm_queries(d):
    """«상세 조사» note 안 APM 링크의 query (정렬)."""
    c = widget_by_title(d, DETAIL).get("content", "")
    return sorted(parse_qs(urlparse(u).query)["query"][0]
                  for u in re.findall(r"\((https://[^)\s]*/apm/services[^)\s]*)\)", c))


def tokens(q):
    """괄호를 떼고 공백으로 나눈 검색 토큰."""
    return q.replace("(", " ").replace(")", " ").split()


class KafkaLogLinks(unittest.TestCase):
    def setUp(self):
        self.d = json.loads(DASH.read_text(encoding="utf-8"))
        self.q = log_queries(self.d)

    def test_two_links_distinct(self):
        self.assertEqual(set(self.q), {"Kafka 브로커 로그", "Kafka Exporter 로그", "Kafka JMX Exporter 로그"})
        b, e = self.q["Kafka 브로커 로그"], self.q["Kafka Exporter 로그"]
        self.assertNotEqual(b, e)

    def test_each_selects_only_own_component(self):
        b, e = self.q["Kafka 브로커 로그"], self.q["Kafka Exporter 로그"]
        self.assertIn("container_name:phone-kafka", b)
        self.assertIn("source:kafka", tokens(b))
        self.assertNotIn("exporter", b)
        self.assertIn("container_name:gromo-kafka-exporter", e)
        self.assertIn("source:kafka-exporter", e)
        self.assertNotIn("phone-kafka", e)
        self.assertNotIn("source:kafka", tokens(e))
        for q in (b, e):
            self.assertIn("service:gromo-kafka-dev", q)

    def test_jmx_exporter_link_overlaps_neither_broker_nor_exporter(self):
        j = self.q["Kafka JMX Exporter 로그"]
        self.assertIn("container_name:gromo-kafka-jmx-exporter", j)
        self.assertIn("source:jmx-exporter", j)
        self.assertIn("service:gromo-kafka-dev", j)
        for other in (self.q["Kafka 브로커 로그"], self.q["Kafka Exporter 로그"]):
            self.assertFalse((set(tokens(j)) & set(tokens(other))) - {"env:dev", "service:gromo-kafka-dev", "OR"})
        self.assertNotIn("phone-kafka", j)
        self.assertNotIn("source:kafka", tokens(j))
        self.assertNotIn("source:kafka-exporter", j)

    def test_metrics_unchanged(self):
        before = json.loads((HERE / "fixtures" / "metric-queries-before.json").read_text(encoding="utf-8"))
        self.assertEqual(before, metric_queries(self.d))

    def test_apm_links_unchanged(self):
        before = json.loads((HERE / "fixtures" / "apm-queries-before.json").read_text(encoding="utf-8"))
        self.assertEqual(before, apm_queries(self.d))


if __name__ == "__main__":
    unittest.main()
