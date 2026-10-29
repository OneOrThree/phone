#!/usr/bin/env python3
"""Datadog Logs Pipelines(v1) 백업·계획·적용·롤백 — GROMO-2572.

이 디렉터리의 정의(kafka-exporter.json·postgres.json)를 Datadog 에 반영한다. stdlib 만 쓴다.

  backup   --out F                          GET pipelines·pipeline-order 를 파일로 (읽기)
  plan     [--backup-file F [--order-file O]]  로컬 정의 vs 현재 상태 비교 (읽기)
  apply    [--backup-file F] [--record-out R] [--execute]
  rollback --record R [--backup-file F] [--disable-only] [--execute]

apply·rollback 은 기본이 dry-run 이다. 실제 쓰기는 `--execute` 와 환경변수
GROMO_DD_PIPELINE_APPLY=yes 가 **둘 다** 있을 때만 하고, 그때는 `--backup-file` 대신 실시간 상태를 읽는다.
`--backup-file` 은 이 스크립트의 backup 결과 또는 Datadog MCP execute_code 응답
(listLogsPipelines·getLogsPipelineOrder, camelCase·jsonrpc 래핑)을 그대로 받는다 — 네트워크 없이 plan·dry-run 을 돌리는 용도.

키: DD_API_KEY·DD_APP_KEY, 사이트: DD_SITE(기본 us5.datadoghq.com). 키 값은 출력하지 않는다.
"""

import argparse
import datetime
import difflib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFINITIONS = ("kafka-exporter.json", "postgres.json")
CONFIRM_ENV = "GROMO_DD_PIPELINE_APPLY"
PIPELINES = "/api/v1/logs/config/pipelines"
ORDER = "/api/v1/logs/config/pipeline-order"
# 갱신 비교·PUT 본문에 쓰는 필드. id·type·is_read_only 는 서버가 정한다.
BODY_KEYS = ("name", "is_enabled", "filter", "description", "processors")
# Datadog 공식 사이트 목록의 Site Parameter(https://docs.datadoghq.com/getting_started/site/, 2026-10-29 확인).
# 이 밖의 값이면 키가 엉뚱한 호스트로 나가므로 거절한다. 새 사이트가 생기면 여기에 추가한다.
SITES = frozenset({
    "datadoghq.com", "us3.datadoghq.com", "us5.datadoghq.com", "datadoghq.eu",
    "ap1.datadoghq.com", "ap2.datadoghq.com", "uk1.datadoghq.com", "ddog-gov.com", "us2.ddog-gov.com",
})


class ApiError(SystemExit):
    """API 호출 실패. status 는 HTTP 코드(없으면 None). unknown 이면 쓰기 요청이 응답 없이 끝나 서버 반영 여부를 모른다."""

    def __init__(self, msg, status=None, unknown=False):
        super().__init__(msg)
        self.status, self.unknown = status, unknown


def save_json(path, obj):
    """임시 파일 후 rename — 중간에 죽어도 파일이 깨지지 않는다."""
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_definitions():
    return [json.loads((HERE / n).read_text(encoding="utf-8")) for n in DEFINITIONS]


def sources_in(query):
    """필터 쿼리의 source 값 집합. `source:a`, `source:(a OR b)` 만 해석한다."""
    out = set()
    for m in re.finditer(r"source:(\([^)]*\)|[^\s()]+)", query or ""):
        out |= {t for t in re.split(r"\s+OR\s+", m.group(1).strip("()").strip()) if t}
    return out


def _snake(key):
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", key).lower()


def normalize(obj):
    """SDK(camelCase) 응답을 REST(snake_case) 키로 맞춘다."""
    if isinstance(obj, dict):
        return {_snake(k): normalize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [normalize(v) for v in obj]
    return obj


def _unwrap(doc):
    """MCP execute_code 응답(jsonrpc → content[0].text → {outcome, value})이면 value 를 꺼낸다."""
    if isinstance(doc, dict) and "jsonrpc" in doc:
        doc = json.loads(doc["result"]["content"][0]["text"])
    if isinstance(doc, dict) and "outcome" in doc and "value" in doc:
        doc = doc["value"]
    return normalize(doc)


def load_state(backup_file, order_file=None):
    doc = _unwrap(json.loads(Path(backup_file).read_text(encoding="utf-8")))
    if isinstance(doc, list):
        pipelines, order = doc, None
    else:
        pipelines, order = doc["pipelines"], (doc.get("pipeline_order") or {}).get("pipeline_ids")
    origin = f"backup-file:{backup_file}"
    if order_file:
        order = _unwrap(json.loads(Path(order_file).read_text(encoding="utf-8")))["pipeline_ids"]
        origin += f" + order-file:{order_file}"
    if order is None:
        order = [p["id"] for p in pipelines]
        origin += " (order 는 목록 순서로 추정)"
    return {"pipelines": pipelines, "order": order, "origin": origin}


class Api:
    def __init__(self):
        self.site = os.environ.get("DD_SITE", "us5.datadoghq.com")
        if self.site not in SITES:
            sys.exit(f"DD_SITE 허용 목록에 없음: {self.site!r} (허용: {', '.join(sorted(SITES))})")
        missing = [k for k in ("DD_API_KEY", "DD_APP_KEY") if not os.environ.get(k)]
        if missing:
            sys.exit(f"환경변수 없음: {', '.join(missing)}")
        self._headers = {
            "DD-API-KEY": os.environ["DD_API_KEY"],
            "DD-APPLICATION-KEY": os.environ["DD_APP_KEY"],
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(f"https://api.{self.site}{path}", data=data, headers=self._headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:  # URLError·OSError 의 하위 클래스라 먼저 잡는다
            raise ApiError(f"{method} {path} → HTTP {e.code}: {e.read()[:500].decode(errors='replace')}", status=e.code, unknown=method != "GET" and e.code >= 500)  # 쓰기의 게이트웨이 5xx 는 서버가 이미 처리했을 수 있다
        except OSError as e:  # URLError·타임아웃·연결 끊김. 쓰기면 서버가 이미 처리했을 수 있다
            raise ApiError(f"{method} {path} → 응답 없음({type(e).__name__}: {e})", unknown=method != "GET")
        return json.loads(raw) if raw.strip() else None

    def state(self):
        return {
            "pipelines": self.call("GET", PIPELINES),
            "order": self.call("GET", ORDER)["pipeline_ids"],
            "origin": f"live:{self.site}",
        }


def body(pipeline):
    return {k: pipeline[k] for k in BODY_KEYS if k in pipeline}


def plan_actions(defs, state):
    by_name = {p["name"]: p for p in state["pipelines"]}
    actions = []
    for d in defs:
        cur = by_name.get(d["name"])
        if cur is None:
            actions.append(("create", d, None))
        elif cur.get("is_read_only"):
            sys.exit(f"'{d['name']}' 은 read-only 파이프라인이다 — 이름을 바꾸거나 수동 확인")
        elif body(cur) == body(d):
            actions.append(("noop", d, cur))
        else:
            actions.append(("update", d, cur))
    return actions


def overlaps(defs, state):
    names = {d["name"] for d in defs}
    lines = []
    for d in defs:
        mine = sources_in(d["filter"]["query"])
        for p in state["pipelines"]:
            shared = mine & sources_in((p.get("filter") or {}).get("query"))
            if p["name"] not in names and shared:
                lines.append(f"  겹침: '{d['name']}' ↔ '{p['name']}' ({p['id']}) source={sorted(shared)}")
    return lines


def print_plan(defs, state, actions):
    names = {p["id"]: p["name"] for p in state["pipelines"]}
    print(f"상태 출처: {state['origin']}")
    print(f"현재 파이프라인 {len(state['pipelines'])}개, 순서:")
    for i, pid in enumerate(state["order"], 1):
        print(f"  {i}. {names.get(pid, '?')} ({pid})")
    print("동작:")
    for kind, d, cur in actions:
        print(f"  {kind:6} '{d['name']}' filter={d['filter']['query']!r}" + (f" id={cur['id']}" if cur else ""))
        if kind == "update":
            a = json.dumps(body(cur), indent=2, sort_keys=True, ensure_ascii=False).splitlines()
            b = json.dumps(body(d), indent=2, sort_keys=True, ensure_ascii=False).splitlines()
            for line in difflib.unified_diff(a, b, "현재", "로컬", lineterm="", n=1):
                print("      " + line)
    found = overlaps(defs, state)
    print("필터 겹침(같은 source 를 처리하는 다른 파이프라인 — status remapper 는 먼저 만나는 하나만 적용):")
    print("\n".join(found) if found else "  없음")
    print("순서: 이 스크립트는 pipeline-order 를 바꾸지 않는다. 새 파이프라인 위치는 생성 후 다시 조회해 기록한다.")


def cmd_backup(args):
    out = Path(args.out)
    if out.exists():
        sys.exit(f"이미 있음: {out}")
    api = Api()
    st = api.state()
    out.write_text(json.dumps({
        "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "site": api.site,
        "pipelines": st["pipelines"],
        "pipeline_order": {"pipeline_ids": st["order"]},
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"백업: {out} (파이프라인 {len(st['pipelines'])}개, 순서 {len(st['order'])}개)")


def _state(args, execute):
    if execute:
        if args.backup_file:
            sys.exit("--execute 는 --backup-file 과 함께 쓸 수 없다(실시간 상태로만 쓴다)")
        if os.environ.get(CONFIRM_ENV) != "yes":
            sys.exit(f"--execute 에는 {CONFIRM_ENV}=yes 도 필요하다")
        api = Api()
        return api, api.state()
    if args.backup_file:
        return None, load_state(args.backup_file, getattr(args, "order_file", None))
    api = Api()
    return api, api.state()


def cmd_plan(args):
    _, st = _state(args, execute=False)
    defs = load_definitions()
    print_plan(defs, st, plan_actions(defs, st))


def cmd_apply(args):
    api, st = _state(args, execute=args.execute)
    defs = load_definitions()
    actions = plan_actions(defs, st)
    print_plan(defs, st, actions)
    if args.record_out and Path(args.record_out).exists():
        sys.exit(f"이미 있음: {args.record_out}")
    if args.execute and not args.record_out:
        sys.exit("--execute 에는 --record-out 이 필요하다(롤백 근거)")
    record = {
        "dry_run": not args.execute,
        "partial": False,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "state_origin": st["origin"],
        "order_before": st["order"],
        "previous_record": args.previous_record,
        "created": [],
        "updated": [],
        "order_after": None,
        # 단계별 결과: ok / failed / unknown(쓰기 응답 없음, 반영 여부 불명) / not-run. created·updated 에는 성공한 것만 들어가므로 rollback 은 그것만 되돌린다.
        "steps": [{"step": f"{k}:{d['name']}", "result": "not-run"} for k, d, _ in actions if k != "noop"]
        + [{"step": "order-after", "result": "not-run"}],
    }
    steps = iter(record["steps"])

    def save():
        if args.record_out:
            save_json(args.record_out, record)

    def write(step, method, path, payload, pending=None):
        """쓰기 하나. 실패하면 기록에 남기고 부분 적용 안내 후 비정상 종료한다(자동 되돌리기 없음)."""
        try:
            return api.call(method, path, payload) if args.execute else None
        except SystemExit as e:
            unknown = getattr(e, "unknown", False)
            step["result"] = "unknown" if unknown else "failed"
            step["error"] = str(e.code)
            if pending is not None and not unknown:  # 확실한 실패면 서버는 그대로다 — 롤백 대상에서 뺀다. 결과 불명이면 남긴다
                for lst in (record["created"], record["updated"]):
                    if pending in lst:
                        lst.remove(pending)
            changed = bool(record["created"] or record["updated"])
            record["partial"] = changed
            save()
            if unknown:
                msg = ("결과 불명 — 요청이 서버에 반영됐는지 모른다. 서버 상태를 직접 조회해 같은 이름 파이프라인이 있는지 확인한다. "
                       "있으면 같은 명령을 다시 실행해도 된다(plan_actions 가 이름으로 찾아 update 로 처리한다, 중복 생성 없음). "
                       "다시 실행할 때는 `--previous-record` 에 이 기록을 주면 결과 불명 생성을 안내한다.")
                if changed:
                    msg += (f" 이 기록으로 `rollback --record {args.record_out}` 하면 성공한 단계와, 결과 불명 생성은 "
                            "같은 이름의 파이프라인(정확히 1개·정의 일치일 때만)을 찾아 되돌린다.")
            elif changed:
                msg = f"부분 적용 — 되돌리려면 `rollback --record {args.record_out}` (성공한 단계만 되돌린다)."
            else:
                msg = "변경 없음 — 롤백 불필요."
            sys.exit(f"{e.code}\n{msg} 기록: {args.record_out}")

    save()
    if args.previous_record:
        prev = json.loads(Path(args.previous_record).read_text(encoding="utf-8"))
        for c in prev.get("created", []):
            if c.get("pending"):
                print(f"이전 기록의 결과 불명 생성: '{c['name']}' — 그 기록으로 rollback 가능: "
                      f"`rollback --record {args.previous_record}` (이름으로 찾아 정의가 같을 때만 되돌린다)")
    print("요청" + (" (실행)" if args.execute else " (dry-run, 보내지 않음)") + ":")
    for kind, d, cur in actions:
        if kind == "noop":
            print(f"  (변경 없음) '{d['name']}'")
            continue
        step = next(steps)
        if kind == "create":
            print(f"  POST {PIPELINES}  name='{d['name']}' processors={len(d['processors'])}")
            # POST 전에 pending 으로 먼저 저장한다 — 서버에 반영된 뒤 응답만 유실돼도 rollback 이 이름으로 찾아 회수한다
            entry = {"name": d["name"], "id": None, "pending": True}
            record["created"].append(entry)
            save()
            res = write(step, "POST", PIPELINES, d, pending=entry)
            entry["id"] = res["id"] if res else f"<new:{d['name']}>"
            del entry["pending"]
        else:
            print(f"  PUT  {PIPELINES}/{cur['id']}  name='{d['name']}'")
            # PUT 전에 previous 를 저장한다 — 반영된 뒤 응답만 유실돼도 롤백이 이전 정의를 알 수 있어야 한다
            entry = {"name": d["name"], "id": cur["id"], "previous": body(cur)}
            record["updated"].append(entry)
            save()
            write(step, "PUT", f"{PIPELINES}/{cur['id']}", d, pending=entry)
        step["result"] = "ok"
        save()
    step = next(steps)
    if args.execute:
        record["order_after"] = write(step, "GET", ORDER, None)["pipeline_ids"]
        step["result"] = "ok"
        print(f"적용 후 순서: {record['order_after']}")
    save()
    if args.record_out:
        print(f"기록: {args.record_out}")


def restored_order(order_before, current, removed):
    """백업 순서를 기준으로, 지금 남아 있는 ID 만으로 순서를 다시 만든다. 백업 이후 생긴 ID 는 뒤에 둔다."""
    alive = [i for i in current if i not in removed]
    return [i for i in order_before if i in alive] + [i for i in alive if i not in order_before]


def _verify(api, pid, name):
    """롤백 전 확인: 서버의 pid 가 기록의 이름과 같은지. 'ok' | 'gone'(404) | 'mismatch'."""
    try:
        cur = api.call("GET", f"{PIPELINES}/{pid}")
    except ApiError as e:
        if e.status == 404:
            return "gone", None
        raise
    return ("ok" if cur.get("name") == name else "mismatch"), cur


def find_pending(name, pipelines):
    """id 없는 pending 생성 항목을 이름으로 찾는다. (pipeline|None, 중단 사유|None). 정확히 1개·비 read-only·로컬 정의와 같을 때만 대상."""
    found = [p for p in pipelines if p.get("name") == name]
    if not found:
        return None, None
    if len(found) > 1:
        return None, f"같은 이름 {len(found)}개({[p['id'] for p in found]}) — 어느 쪽인지 알 수 없다"
    p, local = found[0], next((d for d in load_definitions() if d["name"] == name), None)
    if p.get("is_read_only") or local is None or body(p) != body(local):
        return None, f"{p['id']} 가 로컬 정의와 다르거나 read-only 라 우리가 만든 것인지 확신할 수 없다"
    return p, None


def cmd_rollback(args):
    record = json.loads(Path(args.record).read_text(encoding="utf-8"))
    if record.get("dry_run") and args.execute:
        sys.exit("dry-run 기록으로는 --execute 할 수 없다")
    api, st = _state(args, execute=args.execute)
    print(f"상태 출처: {st['origin']}")
    if record.get("partial"):
        print("부분 적용 기록 — 성공한 단계만 되돌린다: " + ", ".join(f"{s['step']}={s['result']}" for s in record.get("steps", [])))
    done = record.setdefault("rollback", {})  # id(또는 'order') → 결과. 중단 뒤 재실행하면 끝난 항목은 건너뛴다
    print("요청" + (" (실행)" if args.execute else " (dry-run, 보내지 않음)") + ":")
    removed, problems = set(), []

    def mark(key, result):
        done[key] = result
        if args.execute:
            save_json(args.record, record)

    def items():
        for c in record["created"]:
            yield c, "disable" if args.disable_only else "delete"
        for u in record["updated"]:
            yield u, "restore"

    try:
        for it, act in items():
            pid, name = it["id"], it["name"]
            key = pid or f"pending:{name}"  # 결과 불명 생성은 id 가 없어 이름으로 기록한다
            if key in done:
                print(f"  (건너뜀) '{name}' {key} — 이전 롤백에서 {done[key]}")
                if act == "delete" and pid:
                    removed.add(pid)
                continue
            if pid is None:
                print(f"  GET    {PIPELINES}  결과 불명 생성 '{name}' 을 같은 이름으로 찾기 (정확히 1개·정의 일치일 때만 회수)")
                found, why = find_pending(name, st["pipelines"])
                if why:
                    print(f"  중단   '{name}': {why} — 건드리지 않음")
                    problems.append(key)
                    continue
                if found is None:
                    print(f"  생성 안 됨 — 건너뜀 '{name}' (같은 이름 없음)")
                    mark(key, "not-created")
                    continue
                pid = found["id"]
            print(f"  GET    {PIPELINES}/{pid}  이름이 '{name}' 인지 확인 (404 면 이미 없음으로 건너뜀, 다르면 이 항목 중단)")
            verdict, cur = _verify(api, pid, name) if args.execute else ("ok", None)
            if verdict == "mismatch":
                print(f"  중단   {pid}: 서버 이름 {cur.get('name')!r} != 기록 {name!r} — 건드리지 않음")
                problems.append(pid)
                continue
            if act == "delete":
                removed.add(pid)
            if verdict == "gone":
                print(f"  이미 없음 {pid} ('{name}')" + (" — 복원 대상 없음(경고): 이전 정의를 되돌릴 수 없다" if act == "restore" else ""))
                mark(key, "already-gone")
                continue
            if act == "disable":
                print(f"  PUT    {PIPELINES}/{pid}  is_enabled=false  ('{name}')")
                if args.execute:
                    api.call("PUT", f"{PIPELINES}/{pid}", {**body(cur), "is_enabled": False})
                mark(key, "disabled")
            elif act == "delete":
                print(f"  DELETE {PIPELINES}/{pid}  ('{name}')")
                if args.execute:
                    api.call("DELETE", f"{PIPELINES}/{pid}")
                mark(key, "deleted")
            elif cur is not None and body(cur) == it["previous"]:
                print(f"  (건너뜀) '{name}' {pid} — 이미 이전 정의")
                mark(key, "already-previous")
            else:
                print(f"  PUT    {PIPELINES}/{pid}  이전 정의로 복원  ('{name}')")
                if args.execute:
                    api.call("PUT", f"{PIPELINES}/{pid}", it["previous"])
                mark(key, "restored")
        if problems:
            sys.exit(f"이름이 기록과 다른 항목 {problems} — 순서 복원 없이 중단. 사람이 확인한 뒤 기록을 고치거나 직접 처리한다.")
        if "order" in done:
            print("  (건너뜀) 순서 — 이전 롤백에서 끝남")
            return
        current = api.call("GET", ORDER)["pipeline_ids"] if args.execute else st["order"]
        want = restored_order(record["order_before"], current, removed)
        if want == [i for i in current if i not in removed]:
            print("  순서: 백업과 같음 — PUT 없음")
        else:
            print(f"  PUT    {ORDER}  {want}")
            if args.execute:
                api.call("PUT", ORDER, {"pipeline_ids": want})
        mark("order", "ok")
    except SystemExit as e:
        if args.execute and e.code:
            print(f"롤백 중단: {e.code}\n같은 기록으로 다시 실행하면 끝난 항목은 건너뛰고 이어서 진행한다.", file=sys.stderr)
        raise


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backup")
    b.add_argument("--out", required=True)
    b.set_defaults(fn=cmd_backup)
    for name, fn in (("plan", cmd_plan), ("apply", cmd_apply), ("rollback", cmd_rollback)):
        s = sub.add_parser(name)
        s.add_argument("--backup-file")
        s.add_argument("--order-file")
        s.set_defaults(fn=fn)
        if name != "plan":
            s.add_argument("--execute", action="store_true")
        if name == "apply":
            s.add_argument("--record-out")
            s.add_argument("--previous-record")
        if name == "rollback":
            s.add_argument("--record", required=True)
            s.add_argument("--disable-only", action="store_true")
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
