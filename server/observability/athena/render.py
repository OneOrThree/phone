#!/usr/bin/env python3
"""GROMO-2560 — Athena SQL 템플릿의 {{자리}} 를 채워 표준 출력으로 낸다. 결과를 Athena 콘솔에 붙여 실행한다.

  python3 render.py by-request.sql --env prod --from 2026-10-29T13:15:00Z --to 2026-10-29T13:30:00Z --request-id R1
  python3 render.py create-table.sql --bucket <버킷> --start-date 2026-10-01

파티션 조건은 여기서 만든다: [from − 여유, to + 여유] 가 걸치는 (archive_date, archive_hour) 목록. 객체 시간 파티션은 «객체 첫
레코드» 시각이라 레코드가 앞·뒤 시간 객체에 들어 있을 수 있다(2556 런북). 기본 여유 1시간, 수집 장애가 길었으면 그만큼 늘린다.
값은 SQL 리터럴로 넣기 전에 형식을 검사한다(ID 는 로그 스키마의 허용 문자만) — 문자열을 이어 붙여 만든 SQL 이 깨지지 않게.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ENVS = ("dev", "staging", "prod", "unknown")
SERVICES = ("data-api", "business-api", "notification", "realtime", "nginx", "canary")
DEFAULT_SERVICES = "data-api,business-api,notification,realtime,nginx"
LEVELS = ("ERROR", "WARN", "INFO", "DEBUG", "TRACE")
ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}")  # 로그 스키마 §2.1 의 ID 형식
KEYS = ("request_id", "trace", "event_id", "message_id")


def literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    if not ID.fullmatch(value):
        raise ValueError(f"ID 형식이 아님: {value!r}")
    return f"'{value}'"


def instant(text: str) -> datetime:
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError(f"시각에 시간대(Z)가 없음: {text}")
    return value.astimezone(timezone.utc)


def partitions(start: datetime, end: datetime, margin_hours: int) -> str:
    """[start, end) 를 덮는 시간 파티션 ± margin. 날짜별로 묶어 (date AND hour IN …) OR … 로 낸다."""
    first = start.replace(minute=0, second=0, microsecond=0) - timedelta(hours=margin_hours)
    last = (end - timedelta(microseconds=1)).replace(minute=0, second=0, microsecond=0) + timedelta(hours=margin_hours)
    days: dict[str, list[str]] = {}
    hour = first
    while hour <= last:
        days.setdefault(hour.strftime("%Y-%m-%d"), []).append(hour.strftime("%H"))
        hour += timedelta(hours=1)
    dates = ", ".join(f"'{d}'" for d in days)
    groups = " OR ".join(f"(archive_date = '{d}' AND archive_hour IN ({', '.join(repr(h) for h in hs)}))"
                         for d, hs in days.items())
    return f"archive_date IN ({dates}) AND ({groups})"


def render(template: str, values: dict[str, str]) -> str:
    missing = sorted(set(re.findall(r"\{\{(\w+)\}\}", template)) - values.keys())
    if missing:
        raise ValueError(f"값이 없는 자리: {', '.join(missing)}")
    return re.sub(r"\{\{(\w+)\}\}", lambda m: values[m.group(1)], template)


def values_from(args: argparse.Namespace, template: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if args.bucket is not None:
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", args.bucket):
            raise ValueError(f"버킷 이름 형식이 아님: {args.bucket}")
        out["bucket"] = args.bucket
    if args.start_date is not None:
        out["start_date"] = datetime.strptime(args.start_date, "%Y-%m-%d").strftime("%Y-%m-%d")
    if args.env is not None:
        if args.env not in ENVS:
            raise ValueError(f"env 는 {ENVS} 중 하나")
        out["env"] = f"'{args.env}'"
    services = args.services.split(",")
    if not set(services) <= set(SERVICES):
        raise ValueError(f"service 는 {SERVICES} 안에서")
    out["services"] = ", ".join(f"'{s}'" for s in services)
    if args.start is not None and args.end is not None:
        start, end = instant(args.start), instant(args.end)
        if end <= start:
            raise ValueError("--to 가 --from 보다 뒤여야 한다")
        if not 0 <= args.margin_hours <= 24 * 90:
            raise ValueError("--margin-hours 는 0..2160")
        out["partitions"] = partitions(start, end, args.margin_hours)
        out["from"] = "'" + start.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z'"
        out["to"] = "'" + end.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z'"
    for key in KEYS + ("operation_id",):
        out[key] = literal(getattr(args, key))
    if "{{request_id}}" in template and all(getattr(args, k) is None for k in KEYS):
        raise ValueError("원인 키(--request-id·--trace·--event-id·--message-id)를 하나 이상 준다")
    if "{{operation_id}}" in template and args.operation_id is None:
        raise ValueError("--operation-id 가 필요하다")
    if args.levels:
        levels = args.levels.split(",")
        if not set(levels) <= set(LEVELS):
            raise ValueError(f"level 은 {LEVELS} 안에서")
        out["level_filter"] = "level IN (" + ", ".join(f"'{lv}'" for lv in levels) + ")"
    else:
        out["level_filter"] = "TRUE"
    out["late_seconds"] = str(int(args.late_seconds))
    out["skew_ms"] = str(int(args.skew_ms))
    return out


def build(argv: list[str]) -> str:
    """인자를 읽어 채운 SQL 을 돌려준다. 형식이 틀리면 ValueError. 로컬 하네스도 이 함수를 그대로 쓴다."""
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("template")
    p.add_argument("--env")
    p.add_argument("--from", dest="start")
    p.add_argument("--to", dest="end")
    p.add_argument("--services", default=DEFAULT_SERVICES)
    p.add_argument("--margin-hours", type=int, default=1, help="객체 시간 파티션 앞뒤 여유(기본 1)")
    p.add_argument("--request-id")
    p.add_argument("--trace")
    p.add_argument("--event-id")
    p.add_argument("--message-id")
    p.add_argument("--operation-id")
    p.add_argument("--levels")
    p.add_argument("--late-seconds", type=int, default=300, help="이보다 늦게 수집된 줄을 late_arrival 로 표시(기본 300)")
    p.add_argument("--skew-ms", type=int, default=1000, help="생산 로그보다 이만큼 이른 소비 쪽 줄을 시계 차이 의심으로 표시")
    p.add_argument("--bucket")
    p.add_argument("--start-date")
    args = p.parse_args(argv)
    path = Path(args.template)
    if not path.exists():
        path = Path(__file__).with_name(args.template)
    template = path.read_text(encoding="utf-8")
    return render(template, values_from(args, template))


def main(argv: list[str]) -> int:
    try:
        sys.stdout.write(build(argv))
    except ValueError as error:
        print(f"render.py: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
