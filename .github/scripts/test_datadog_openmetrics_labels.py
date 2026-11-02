"""Datadog OpenMetrics 라벨(com.datadoghq.ad.checks)의 metrics 가 «.*» 같은 정규식으로 되돌아가지 않게 막는다. GROMO-2196.

정규식 항목은 일치하는 지표를 전부 가져와 커스텀 메트릭 과금(timeseries 당)이 튄다. Agent 의 OpenMetrics V2 는
re.escape 를 해도 그대로인 항목(영문·숫자·_)만 «정확한 이름»으로 비교하고 나머지는 정규식 검색으로 돌린다
(datadog_checks.base.checks.openmetrics.v2.transform.MetricTransformer) → 그 모양만 허용한다.
카운터는 파서가 이름에서 _total 을 떼므로 _total 로 끝나는 항목은 영영 맞지 않는다.
저장소 파일끼리만 비교하므로 PR 단계에서 돈다.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
LABEL = "com.datadoghq.ad.checks"
COMPOSE_FILES = sorted((ROOT / "server" / "scripts").glob("docker-compose*.yml"))
DOCKERFILES = sorted((ROOT / "server").glob("*/Dockerfile"))
# Agent 는 metrics 와 extra_metrics 를 합쳐 읽는다
METRIC_OPTIONS = ("metrics", "extra_metrics")


class _ComposeLoader(yaml.SafeLoader):
    """compose 전용 태그(!override·!reset)를 값 그대로 읽음"""


_ComposeLoader.add_multi_constructor("!", lambda loader, suffix, node: (
    loader.construct_mapping(node) if isinstance(node, yaml.MappingNode)
    else loader.construct_sequence(node) if isinstance(node, yaml.SequenceNode)
    else loader.construct_scalar(node)))


def labels() -> list[tuple[str, str]]:
    """(위치, 라벨 JSON 문자열) — Dockerfile LABEL 과 compose services.*.labels."""
    found = []
    for path in DOCKERFILES:
        for raw in re.findall(rf"{re.escape(LABEL)}='([^']*)'", path.read_text(encoding="utf-8")):
            found.append((str(path.relative_to(ROOT)), raw))
    for path in COMPOSE_FILES:
        services = (yaml.load(path.read_text(encoding="utf-8"), Loader=_ComposeLoader) or {}).get("services") or {}
        for name, service in services.items():
            value = (service or {}).get("labels") or {}
            if isinstance(value, list):
                value = dict(item.split("=", 1) for item in value if "=" in item)
            if LABEL in value:
                found.append((f"{path.relative_to(ROOT)} {name}", value[LABEL]))
    return found


def instances() -> list[tuple[str, dict]]:
    """(위치, openmetrics 인스턴스) — JSON 이 깨졌으면 Autodiscovery 도 못 읽으므로 여기서 실패한다."""
    return [(where, instance) for where, raw in labels()
            for instance in json.loads(raw).get("openmetrics", {}).get("instances", [])]


def problem(entry: object) -> str | None:
    if not isinstance(entry, str) or not entry:
        return "이름 문자열이 아님 — 정확한 지표 이름만 적는다"
    if re.escape(entry) != entry:
        return "정규식으로 취급됨 — 영문·숫자·_ 만 쓴 정확한 이름이어야 한다(.* 는 과금이 튄다)"
    if entry.endswith("_total"):
        return "_total 로 끝남 — 카운터는 Agent 가 _total 을 뗀 이름으로 매기므로 떼고 적는다"
    return None


class OpenMetricsLabelTest(unittest.TestCase):
    def test_정본_라벨을_찾는다(self) -> None:
        # 라벨이 통째로 사라지면 그 서비스 수집이 멈춘다. 아래 검사는 있는 라벨만 보므로 수집 대상을 전부 못 박는다.
        namespaces = {instance.get("namespace") for _, instance in instances()}
        self.assertEqual(namespaces, {"gromo", "gromo_realtime", "gromo_business", "gromo_notification",
                                      "gromo_kafka", "gromo_kafka_jmx"})

    def test_metrics_는_정규식이_아닌_정확한_이름_목록이다(self) -> None:
        found = []
        for where, instance in instances():
            entries = [entry for option in METRIC_OPTIONS for entry in instance.get(option, [])]
            if not entries:
                found.append(f"{where}: metrics 가 비었음 — 이름을 적거나 라벨을 지운다")
            found += [f"{where}: {entry!r} — {reason}" for entry in entries if (reason := problem(entry))]
        self.assertEqual(found, [])

    def test_판정_규칙(self) -> None:
        for entry in (".*", "^jvm_gc_pause_seconds$", "jvm_.+", "hikaricp_connections_timeout_total", "", 1, {"a": "b"}):
            with self.subTest(entry=entry):
                self.assertIsNotNone(problem(entry))
        for entry in ("jvm_gc_pause_seconds", "movement_tick_seconds_max", "kafka_brokers"):
            with self.subTest(entry=entry):
                self.assertIsNone(problem(entry))


if __name__ == "__main__":
    unittest.main()
