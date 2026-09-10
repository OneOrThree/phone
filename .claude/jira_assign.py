#!/usr/bin/env python3
"""팀원 작업 지시용 Jira 티켓 생성 — /jira-assign 커맨드의 실행부.

두 가지 모드로 쓴다.

    python3 .claude/jira_assign.py meta
        도메인 옵션 · 담당자 · 활성 스프린트 · 릴리스 버전 · 열린 에픽을 조회해 출력한다.
        티켓 후보를 분류하기 전에 반드시 먼저 돌린다 (옵션은 늘고 줄고 개명된다).

    python3 .claude/jira_assign.py create <payload.json> [--dry-run]
        payload 의 티켓을 생성한다. --dry-run 은 필드 해석만 하고 API 를 치지 않는다.

payload.json 스키마 (모르는 키가 있으면 즉시 에러 — 오타가 조용히 무시되지 않게):

    {
      "sprint": true,                  # 선택, 기본 true — 활성 스프린트에 넣는다
      "tickets": [
        {
          "summary":  "동사형 한 줄",        # 필수, 대괄호 접두 금지
          "assignee": "안수빈",              # 필수, 표시 이름 (부분 일치 허용)
          "domain":   "그룹",                # 필수, 도메인 드롭다운 값
          "goal":     "왜 하는가 / 무엇을 만드는가",   # 필수
          "dod":      ["완료 조건 1", "완료 조건 2"],  # 필수, 1개 이상
          "deliverable":     "PR",           # 필수, 산출물 유형
          "output_location": "server/data-api ... PR",  # 필수, 결과물 남길 위치
          "estimate": "4h",                  # 필수, 예상 작업 시간 (30m/4h/1d/2.5d)
          "due":      "2026-09-14",          # 선택, 기본 = 활성 스프린트 종료일
          "refs":     ["docs/... — 설명"],   # 선택, 참고 자료
          "labels":   ["BE"],                # 선택
          "epic":     "GROMO-123",           # 선택
          "story_points": 3                  # 선택, 기본 = estimate 에서 환산
        }
      ]
    }

규약 정본: docs/conventions/jira-conventions.md
"""

import json
import os
import re
import sys
import uuid

import requests

DOMAIN_FIELD = "customfield_10342"
SPRINT_FIELD = "customfield_10020"
POINTS_FIELD = "customfield_10016"
TASK_TYPE_NAME = "작업"

TICKET_KEYS = {
    "summary", "assignee", "domain", "goal", "dod", "deliverable",
    "output_location", "estimate", "due", "refs", "labels", "epic",
    "story_points",
}
REQUIRED_KEYS = {
    "summary", "assignee", "domain", "goal", "dod", "deliverable",
    "output_location", "estimate",
}


# ---------------------------------------------------------------- 접속

def _env():
    missing = [k for k in ("JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_BASE_URL",
                           "JIRA_PROJECT_KEY") if not os.environ.get(k)]
    if missing:
        # settings.local.json 의 env 를 폴백으로 읽는다 (커맨드 밖에서 직접 실행할 때).
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "settings.local.json")
        try:
            with open(path, encoding="utf-8") as fp:
                env = json.load(fp).get("env", {})
            for k in missing:
                if env.get(k):
                    os.environ[k] = env[k]
        except OSError:
            pass
    missing = [k for k in ("JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_BASE_URL",
                           "JIRA_PROJECT_KEY") if not os.environ.get(k)]
    if missing:
        sys.exit("❌ Jira 크리덴셜 없음: " + ", ".join(missing) +
                 "\n   .claude/settings.local.json 의 env 섹션에 추가해주세요.")
    return (
        (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"]),
        os.environ["JIRA_BASE_URL"].rstrip("/"),
        os.environ["JIRA_PROJECT_KEY"],
    )


AUTH, BASE, PROJECT = _env()
API = f"{BASE}/rest/api/3"
AGILE = f"{BASE}/rest/agile/1.0"


def _get(url, **params):
    r = requests.get(url, auth=AUTH, params=params or None,
                     headers={"Accept": "application/json"}, timeout=30)
    if r.status_code >= 400:
        sys.exit(f"❌ GET {url} → {r.status_code}\n{r.text[:500]}")
    return r.json()


# ---------------------------------------------------------------- 메타데이터

def load_meta():
    """분류·생성에 필요한 실제 옵션을 전부 조회한다. 하드코딩하지 않는다."""
    types = _get(f"{API}/issue/createmeta/{PROJECT}/issuetypes")["issueTypes"]
    task_type = next((t["id"] for t in types if t["name"] == TASK_TYPE_NAME), None)
    if not task_type:
        sys.exit(f"❌ 이슈타입 '{TASK_TYPE_NAME}' 없음: "
                 f"{[t['name'] for t in types]}")

    ctx = _get(f"{API}/field/{DOMAIN_FIELD}/context")["values"][0]["id"]
    domains = {o["value"]: o["id"] for o in
               _get(f"{API}/field/{DOMAIN_FIELD}/context/{ctx}/option",
                    maxResults=200)["values"]}

    users = [{"accountId": u["accountId"], "name": u.get("displayName", "")}
             for u in _get(f"{API}/user/assignable/search",
                           project=PROJECT, maxResults=50)
             if u.get("active") and u.get("accountType") == "atlassian"]

    # 보드 type 으로 거르지 않는다 — 이 프로젝트의 스크럼 보드는 type 이 "simple" 이다.
    # 스프린트를 안 쓰는 보드는 400 을 주므로 조용히 넘긴다.
    sprint = None
    for board in _get(f"{AGILE}/board", projectKeyOrId=PROJECT)["values"]:
        r = requests.get(f"{AGILE}/board/{board['id']}/sprint", auth=AUTH,
                         params={"state": "active"}, timeout=30)
        if r.status_code >= 400:
            continue
        for s in r.json().get("values", []):
            sprint = {"id": s["id"], "name": s["name"],
                      "end": (s.get("endDate") or "")[:10]}
            break
        if sprint:
            break

    versions = [{"id": v["id"], "name": v["name"]} for v in
                _get(f"{API}/project/{PROJECT}/versions")
                if not v.get("released") and not v.get("archived")]

    epics = [{"key": i["key"], "summary": i["fields"]["summary"]} for i in
             _get(f"{API}/search/jql",
                  jql=f'project={PROJECT} AND issuetype=Epic AND statusCategory != Done '
                      f'ORDER BY created DESC',
                  fields="summary", maxResults=50).get("issues", [])]

    return {"task_type": task_type, "domains": domains, "users": users,
            "sprint": sprint, "versions": versions, "epics": epics}


def resolve_user(name, users):
    exact = [u for u in users if u["name"] == name]
    if len(exact) == 1:
        return exact[0]["accountId"]
    part = [u for u in users if name and name in u["name"]]
    if len(part) == 1:
        return part[0]["accountId"]
    known = ", ".join(u["name"] for u in users)
    if not part:
        sys.exit(f"❌ 담당자 '{name}' 를 찾을 수 없다. 배정 가능: {known}")
    sys.exit(f"❌ 담당자 '{name}' 가 모호하다: {[u['name'] for u in part]}")


# ---------------------------------------------------------------- 추정치

_EST = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(m|h|d)\s*$", re.I)


def estimate_hours(text):
    """'30m' · '4h' · '1d' · '2.5d' → 시간(float). 하루는 8시간."""
    m = _EST.match(str(text))
    if not m:
        sys.exit(f"❌ 예상 작업 시간 형식이 아니다: {text!r} (예: 30m · 4h · 1d · 2.5d)")
    value, unit = float(m.group(1)), m.group(2).lower()
    return value / 60 if unit == "m" else value if unit == "h" else value * 8


def hours_to_points(hours):
    """GROMO 수정 피보나치(1·2·3·5·8) 환산. 애매하면 최빈 3으로 수렴한다."""
    if hours <= 2:
        return 1
    if hours <= 5:
        return 2
    if hours <= 8:
        return 3
    if hours <= 24:
        return 5
    return 8


# ---------------------------------------------------------------- ADF 본문

_URL = re.compile(r"^(https?://\S+)(?:\s+[—-]\s+(.*))?$")


def _text(s):
    m = _URL.match(s.strip())
    if not m:
        return [{"type": "text", "text": s}]
    url, tail = m.group(1), m.group(2)
    node = [{"type": "text", "text": url,
             "marks": [{"type": "link", "attrs": {"href": url}}]}]
    if tail:
        node.append({"type": "text", "text": f" — {tail}"})
    return node


def _para(s):
    return {"type": "paragraph", "content": _text(s)}


def _heading(s):
    return {"type": "heading", "attrs": {"level": 3},
            "content": [{"type": "text", "text": s}]}


def _bullets(items):
    return {"type": "bulletList", "content": [
        {"type": "listItem", "content": [_para(i)]} for i in items]}


def _tasks(items):
    """완료 조건은 체크박스로 — 팀원이 진행 상황을 티켓 안에서 체크한다."""
    return {"type": "taskList", "attrs": {"localId": str(uuid.uuid4())},
            "content": [
                {"type": "taskItem",
                 "attrs": {"localId": str(uuid.uuid4()), "state": "TODO"},
                 "content": _text(i)} for i in items]}


def build_description(t, hours):
    body = [
        _heading("🎯 목표"), _para(t["goal"]),
        _heading("✅ 완료 조건"), _tasks(t["dod"]),
    ]
    if t.get("refs"):
        body += [_heading("📎 참고 자료"), _bullets(t["refs"])]
    body += [
        _heading("📦 산출물"),
        _bullets([f"유형: {t['deliverable']}",
                  f"남길 위치: {t['output_location']}"]),
        _heading("⏱ 예상 작업 시간"),
        _para(f"{t['estimate']} (약 {hours:g}시간)"),
    ]
    return {"version": 1, "type": "doc", "content": body}


# ---------------------------------------------------------------- 생성

def validate(t, meta):
    unknown = set(t) - TICKET_KEYS
    if unknown:
        sys.exit(f"❌ 알 수 없는 필드: {sorted(unknown)} (티켓: {t.get('summary')!r})")
    missing = [k for k in REQUIRED_KEYS if not t.get(k)]
    if missing:
        sys.exit(f"❌ 필수 필드 누락 {missing} (티켓: {t.get('summary')!r})")
    if t["summary"].lstrip().startswith("["):
        sys.exit(f"❌ 작업 summary 에 대괄호 접두 금지 (규약 §5): {t['summary']!r}")
    if t["domain"] not in meta["domains"]:
        sys.exit(f"❌ 도메인 '{t['domain']}' 은 옵션에 없다.\n"
                 f"   가능: {sorted(meta['domains'])}")
    if not isinstance(t["dod"], list) or not t["dod"]:
        sys.exit(f"❌ 완료 조건(dod)은 1개 이상의 리스트여야 한다: {t['summary']!r}")


def find_duplicates(summary):
    """같은 제목의 미완료 티켓을 찾는다. 같은 지시를 두 번 내리는 사고를 막는다."""
    escaped = summary.replace("\\", "\\\\").replace('"', '\\"')
    jql = (f'project={PROJECT} AND statusCategory != Done '
           f'AND summary ~ "\\"{escaped}\\""')
    try:
        found = _get(f"{API}/search/jql", jql=jql, fields="summary",
                     maxResults=5).get("issues", [])
    except SystemExit:
        return []          # 검색이 막혀도 생성 자체를 막지는 않는다
    return [i["key"] for i in found]


def build_fields(t, meta, use_sprint):
    hours = estimate_hours(t["estimate"])
    sprint = meta["sprint"]
    fields = {
        "project": {"key": PROJECT},
        "issuetype": {"id": meta["task_type"]},
        "summary": t["summary"],
        "description": build_description(t, hours),
        "assignee": {"id": resolve_user(t["assignee"], meta["users"])},
        DOMAIN_FIELD: {"id": meta["domains"][t["domain"]]},
        POINTS_FIELD: t.get("story_points") or hours_to_points(hours),
    }
    due = t.get("due") or (sprint or {}).get("end")
    if due:
        fields["duedate"] = due
    if t.get("labels"):
        fields["labels"] = t["labels"]
    if t.get("epic"):
        fields["parent"] = {"key": t["epic"]}
    if use_sprint:
        if not sprint:
            sys.exit("❌ 활성 스프린트가 없다. --no-sprint 로 다시 실행하거나 "
                     "보드에서 스프린트를 시작해주세요.")
        fields[SPRINT_FIELD] = sprint["id"]
    return fields


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("meta", "create"):
        sys.exit(__doc__)

    meta = load_meta()

    if sys.argv[1] == "meta":
        print(json.dumps(meta, ensure_ascii=False, indent=2))
        return

    if len(sys.argv) < 3:
        sys.exit("❌ payload.json 경로가 필요하다.")
    with open(sys.argv[2], encoding="utf-8") as fp:
        payload = json.load(fp)
    dry = "--dry-run" in sys.argv
    use_sprint = payload.get("sprint", True)
    tickets = payload.get("tickets") or []
    if not tickets:
        sys.exit("❌ payload 에 tickets 가 없다.")

    for t in tickets:
        validate(t, meta)

    if not dry and "--allow-dup" not in sys.argv:
        clashes = [(t["summary"], keys) for t in tickets
                   if (keys := find_duplicates(t["summary"]))]
        if clashes:
            for summary, keys in clashes:
                print(f"  ⚠️  같은 제목의 미완료 티켓 존재: {', '.join(keys)}  ← {summary}")
            sys.exit("❌ 중복 의심으로 중단했다. 제목을 바꾸거나 --allow-dup 을 붙여 다시 실행한다.")

    if meta["sprint"]:
        print(f"스프린트: {meta['sprint']['name']} "
              f"(id {meta['sprint']['id']}, 종료 {meta['sprint']['end']}) "
              f"— 포함 {'O' if use_sprint else 'X'}")

    ok, fail = [], []
    for t in tickets:
        fields = build_fields(t, meta, use_sprint)
        if dry:
            print(json.dumps({"fields": fields}, ensure_ascii=False, indent=2))
            continue
        r = requests.post(f"{API}/issue", auth=AUTH, json={"fields": fields},
                          timeout=30)
        if r.status_code < 300:
            key = r.json()["key"]
            print(f"  ✅ {key}  {t['summary']}  → {t['assignee']} "
                  f"· 마감 {fields.get('duedate', '-')} · {fields[POINTS_FIELD]}sp")
            ok.append(key)
        else:
            print(f"  ❌ [{r.status_code}] {t['summary']}\n     {r.text[:400]}")
            fail.append(t["summary"])

    if dry:
        return
    print(f"\n완료: {len(ok)}/{len(ok) + len(fail)}")
    if ok:
        print(f"🔗 {BASE}/browse/{ok[0]}")
    if fail:
        print("실패:", fail)
        sys.exit(1)


if __name__ == "__main__":
    main()
