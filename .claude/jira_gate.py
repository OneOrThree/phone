#!/usr/bin/env python3
"""Jira 티켓 본문 게이트 — 산출물이 없거나, 형식이 애매하거나, 완료 조건이 애매하면 생성을 막는다.

같은 규칙을 두 경로가 쓴다.

    1. `.claude/jira_assign.py` 가 import 해 validate 단계에서 `check_ticket()` 을 호출한다.
    2. PreToolUse 훅 (matcher `.*createJiraIssue$`):
           python3 .claude/jira_gate.py --hook
       stdin 의 훅 JSON(`tool_input`) 을 검사해 위반이면 `permissionDecision: deny` 를 돌려준다.
       사용자 확인창은 뜨지 않는다 — 사유는 Claude 에게 가고, Claude 는 빈 항목을
       **사용자에게 묻는다**(지어내지 않는다). 준수·파싱 불가·에픽·다른 프로젝트는 무출력 통과.

    python3 .claude/jira_gate.py --selftest
       내장 픽스처(통과 2 · 위반 11 · 에픽 면제)로 판정이 기대와 같은지 확인한다.

정본(사람이 읽는 양식·막는 조건): docs/conventions/jira-ticket-template.md
"""

import json
import os
import re
import sys

PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY", "GROMO")
DOMAIN_FIELD = "customfield_10342"          # 필드 id 표: docs/conventions/jira-conventions.md

# 본문 섹션 — 이 라벨이 들어간 줄을 헤딩으로 본다 (`### 🎯 목표` · `🎯 목표` 둘 다 허용)
SECTION_GOAL = "🎯 목표"
SECTION_DOD = "✅ 완료 조건"
SECTION_REFS = "📎 참고 자료"
SECTION_DELIVERABLE = "📦 산출물"
SECTION_ESTIMATE = "⏱ 예상 작업 시간"
SECTIONS = (SECTION_GOAL, SECTION_DOD, SECTION_REFS, SECTION_DELIVERABLE, SECTION_ESTIMATE)

DELIVERABLE_TYPES = ("PR", "문서", "조사 리포트", "디자인 시안", "설정 변경", "데이터 작업", "기타")

SUMMARY_MAX = 80
GOAL_MIN = 10
DOD_MIN_ITEMS = 2
DOD_MIN_LEN = 8               # 이보다 짧으면 구체 토큰이 있어도 서술이 아니다

_EPIC_TYPES = {"epic", "에픽"}
_ESTIMATE = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(m|h|d)\s*(?:\(.*\))?\s*$", re.I)   # 전체 문자열
_LIST_MARK = re.compile(r"^\s*(?:[-*•]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s+|☐\s*|☑\s*)")
_HEADING_MARK = re.compile(r"^\s*#{0,6}\s*")

# 「구체적」의 정의 — 관찰 가능한 사실을 가리키는 토큰만. 숫자 하나·대문자 두 글자로는 부족하다.
_CONCRETE = re.compile(
    r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./{}-]+"          # 경로 · 엔드포인트 (docs/prd, /api/groups/{id})
    r"|`[^`]+`"                                     # 백틱 코드
    r"|https?://\S+"                                # URL
    r"|\b(?:GET|POST|PUT|PATCH|DELETE)\b"           # HTTP 메서드
    r"|\b[1-5]\d{2}\b"                             # HTTP 상태코드
    r"|\bGROMO-\d+\b|\bV\d+__"                     # 티켓 키 · 마이그레이션
    r"|\w+\.(?:md|java|kt|ts|tsx|js|sql|yml|yaml|json|py|swift|sh|dbml)\b"   # 파일
    r"|\b[A-Z]{3,}\b|\b(?:PR|CI|DB|UI|QA|OS)\b"    # 대문자 식별자 (3자+ 또는 흔한 약어)
    r"|\b[a-z]+[A-Z][A-Za-z0-9]+\b"                # camelCase 식별자
    r"|\d+(?:\.\d+)?\s*(?:개|건|종|명|회|줄|초|분|시간|일|ms|%|px|MB|KB|GB|sp)"   # 수량+단위
    r"|\d+\.\d+(?:\.\d+)?"                        # 버전
    r"|(?:지라|Jira)\s*코멘트|Figma|Notion|Confluence|Slack|노션|피그마|컨플루언스"
)
# 단독으로 쓰이면 관찰 불가능한 완료 조건
_VAGUE_ONLY = re.compile(
    r"^(?:잘\s*)?(?:동작|작동)(?:하게|하도록|한다|함)?(?:\s*(?:한다|만든다|함))?$"
    r"|^테스트\s*(?:추가|작성|보강)?$"
    r"|^(?:문서화|정리|개선|확인|구현|완료|적용|반영|검토|수정|보완)(?:한다|함|하기)?$"
)


# ---------------------------------------------------------------- 본문 평탄화

def adf_to_text(node):
    """ADF(Atlassian Document Format) → 마크다운 비슷한 평문. 헤딩·리스트·태스크만 살린다."""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(adf_to_text(n) for n in node)
    if not isinstance(node, dict):
        return ""
    t = node.get("type")
    inner = adf_to_text(node.get("content", []))
    if t == "text":
        return node.get("text", "")
    if t == "hardBreak":
        return "\n"
    if t == "heading":
        return f"\n### {inner.strip()}\n"
    if t in ("listItem", "taskItem"):
        return f"- {inner.strip()}\n"
    if t == "paragraph":
        return f"{inner}\n"
    return inner


def description_to_text(description, content_format=None):
    """훅 입력의 description(문자열·ADF dict·ADF JSON 문자열) 을 평문으로."""
    if description is None:
        return ""
    if isinstance(description, dict):
        return adf_to_text(description)
    s = str(description)
    if content_format == "adf" or s.lstrip().startswith("{"):
        try:
            return adf_to_text(json.loads(s))
        except (ValueError, TypeError):
            return s
    return s


def split_sections(text):
    """섹션 라벨이 들어간 줄을 경계로 본문을 나눈다. {라벨: [본문 줄들]}"""
    found = {}
    current = None
    for raw in text.splitlines():
        line = _HEADING_MARK.sub("", raw).strip()
        hit = next((s for s in SECTIONS if line.startswith(s)), None)
        if hit:
            current = hit
            found.setdefault(current, [])
            rest = line[len(hit):].strip(" :—-")
            if rest:
                found[current].append(rest)
            continue
        if current is not None and raw.strip():
            found[current].append(raw.strip())
    return found


def list_items(lines):
    """섹션 본문에서 항목만 뽑는다. 리스트 표식이 없으면 줄 하나가 항목 하나다."""
    items = []
    for line in lines:
        item = _LIST_MARK.sub("", line).strip()
        if item:
            items.append(item)
    return items


def _value_after(lines, label):
    for line in lines:
        body = _LIST_MARK.sub("", line).strip()
        if body.startswith(label):
            return body[len(label):].strip(" :")
    return None


# ---------------------------------------------------------------- 판정

def is_vague(item):
    """정형 애매구 · 8자 미만 · 구체 토큰 없음 — 셋 중 하나면 애매. 길이만으로는 통과하지 못한다."""
    core = item.strip().rstrip(".。")
    if _VAGUE_ONLY.match(core):
        return True
    if len(core) < DOD_MIN_LEN:
        return True
    return not _CONCRETE.search(core)


def check_ticket(summary, issue_type, description, fields=None,
                 content_format=None, require_estimate=False):
    """위반 사유 목록을 돌려준다. 비어 있으면 통과. 에픽은 검사하지 않는다."""
    if (issue_type or "").strip().lower() in _EPIC_TYPES:
        return []
    fields = fields or {}
    reasons = []

    s = (summary or "").strip()
    if not s:
        reasons.append("summary 가 비어 있다")
    else:
        if "\n" in s:
            reasons.append("summary 는 한 줄이어야 한다")
        if len(s) > SUMMARY_MAX:
            reasons.append(f"summary 가 {SUMMARY_MAX}자를 넘는다 ({len(s)}자)")
        if s.startswith("["):
            reasons.append("작업 summary 에 대괄호 접두 금지 — 에픽만 쓴다 (jira-conventions §5)")

    if not fields.get(DOMAIN_FIELD):
        reasons.append("`도메인` 필드가 없다 — 드롭다운 값 하나를 고른다 (jira-conventions §1)")

    text = description_to_text(description, content_format)
    sec = split_sections(text)

    goal = " ".join(sec.get(SECTION_GOAL, [])).strip()
    if SECTION_GOAL not in sec:
        reasons.append(f"`{SECTION_GOAL}` 섹션이 없다 — 왜 하는가 / 무엇을 만드는가")
    elif len(goal) < GOAL_MIN:
        reasons.append(f"`{SECTION_GOAL}` 이 너무 짧다 ({len(goal)}자) — 왜 하는가 / 무엇을 만드는가")

    if SECTION_DOD not in sec:
        reasons.append(f"`{SECTION_DOD}` 섹션이 없다 — 받는 사람이 체크할 수 있는 항목 {DOD_MIN_ITEMS}개 이상")
    else:
        items = list_items(sec[SECTION_DOD])
        if len(items) < DOD_MIN_ITEMS:
            reasons.append(f"`{SECTION_DOD}` 이 {len(items)}개 — {DOD_MIN_ITEMS}개 이상 필요")
        for item in items:
            if is_vague(item):
                reasons.append(f"완료 조건이 애매하다: 「{item}」 — 경로·엔드포인트·상태코드·파일처럼 관찰 가능한 사실로 쓴다")

    if SECTION_DELIVERABLE not in sec:
        reasons.append(f"`{SECTION_DELIVERABLE}` 섹션이 없다 — `유형:` 과 `남길 위치:` 두 줄")
    else:
        lines = sec[SECTION_DELIVERABLE]
        kind = _value_after(lines, "유형")
        where = _value_after(lines, "남길 위치")
        if not kind:
            reasons.append("산출물 `유형:` 이 없다 — " + " | ".join(DELIVERABLE_TYPES))
        else:
            k = kind.strip()
            exact = any(k.upper() == t.upper() for t in DELIVERABLE_TYPES if t != "기타")
            if exact:
                pass
            elif k.startswith("기타"):
                if not re.match(r"^기타\s*\(.+\)$", k):
                    reasons.append("산출물 유형 「기타」 는 무엇인지 괄호로 적는다 — 예: 기타(슬랙 공지)")
            else:
                reasons.append(f"산출물 유형 「{kind}」 은 목록 밖이다 — 정확히 하나: " + " | ".join(DELIVERABLE_TYPES))
        if not where:
            reasons.append("산출물 `남길 위치:` 가 없다 — 레포 경로 / PR 대상 레포 / URL / 지라 코멘트")
        elif not _CONCRETE.search(where):
            reasons.append(f"산출물 위치 「{where}」 가 애매하다 — 레포 경로 / PR 대상 레포 / URL / 지라 코멘트 중 하나로")

    if SECTION_ESTIMATE in sec:
        est = " ".join(sec[SECTION_ESTIMATE]).strip()
        if not _ESTIMATE.match(est):
            reasons.append(f"예상 작업 시간 형식이 아니다: 「{est}」 — 30m · 4h · 1d · 2.5d")
    elif require_estimate:
        reasons.append(f"`{SECTION_ESTIMATE}` 이 없다 — 팀원에게 시키는 티켓은 필수 (30m · 4h · 1d · 2.5d)")

    return reasons


def ticket_to_text(t):
    """jira_assign payload 한 건을 훅이 보는 것과 같은 평문으로 그린다 — 두 경로가 같은 판정을 받도록."""
    out = [f"### {SECTION_GOAL}", t.get("goal", "") or "", f"### {SECTION_DOD}"]
    out += [f"- [ ] {d}" for d in (t.get("dod") or [])]
    if t.get("refs"):
        out.append(f"### {SECTION_REFS}")
        out += [f"- {r}" for r in t["refs"]]
    out += [f"### {SECTION_DELIVERABLE}",
            f"- 유형: {t.get('deliverable', '') or ''}",
            f"- 남길 위치: {t.get('output_location', '') or ''}"]
    if t.get("estimate"):
        out += [f"### {SECTION_ESTIMATE}", str(t["estimate"])]
    return "\n".join(out)


# ---------------------------------------------------------------- 훅 모드

def _deny(reasons):
    reason = ("티켓 생성 거부 — 아래를 사용자에게 물어 채운 뒤 다시 시도한다 "
              "(지어내지 말 것 · 양식: docs/conventions/jira-ticket-template.md):\n"
              + "\n".join(f"- {r}" for r in reasons))
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}, ensure_ascii=False))


def my_account_id():
    """토큰 주인의 accountId. 크리덴셜은 env 또는 .claude/settings.local.json. 못 구하면 None."""
    env = dict(os.environ)
    need = ("JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_BASE_URL")
    if not all(env.get(k) for k in need):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "settings.local.json")
        try:
            with open(path, encoding="utf-8") as fp:
                env.update({k: v for k, v in (json.load(fp).get("env") or {}).items() if v})
        except (OSError, ValueError):
            return None
    if not all(env.get(k) for k in need):
        return None
    import base64
    import urllib.request
    req = urllib.request.Request(env["JIRA_BASE_URL"].rstrip("/") + "/rest/api/3/myself")
    token = base64.b64encode(f"{env['JIRA_EMAIL']}:{env['JIRA_API_TOKEN']}".encode()).decode()
    req.add_header("Authorization", "Basic " + token)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.load(resp).get("accountId")
    except Exception:
        return None


def run_hook():
    try:
        data = json.load(sys.stdin)
    except (ValueError, OSError):
        return                                   # 파싱 불가 → 통과 (문서가 최후 방어)
    ti = data.get("tool_input") or {}
    if not isinstance(ti, dict):
        return
    if (ti.get("projectKey") or PROJECT_KEY) != PROJECT_KEY:
        return                                   # 다른 프로젝트(RVUD 등)는 이 규약 밖
    # 담당자가 명시됐고 그게 내가 아니면(또는 내가 누군지 확인 못 하면) 예상 시간 필수 — jira_assign 과 같은 판정
    assignee = ti.get("assignee_account_id")
    require_estimate = bool(assignee) and assignee != my_account_id()
    reasons = check_ticket(
        summary=ti.get("summary"),
        issue_type=ti.get("issueTypeName"),
        description=ti.get("description"),
        fields=ti.get("additional_fields") or {},
        content_format=ti.get("contentFormat"),
        require_estimate=require_estimate,
    )
    if reasons:
        _deny(reasons)


# ---------------------------------------------------------------- 셀프테스트

_GOOD = """### 🎯 목표
초대 링크 만료 정책을 서버에 적용해 만료된 링크로 가입하는 구멍을 막는다.
### ✅ 완료 조건
- [ ] POST /api/groups/{id}/invite 가 201 과 링크를 반환한다
- [ ] 만료 링크 재사용 시 409 를 검증하는 테스트가 있다
### 📦 산출물
- 유형: PR
- 남길 위치: server/data-api — OneOrThree/phone PR
### ⏱ 예상 작업 시간
4h
"""

_FIXTURES = [
    ("통과", "초대 링크 만료 정책 적용", _GOOD, {DOMAIN_FIELD: {"id": "1"}}, []),
    ("산출물 섹션 없음", "초대 링크 만료 정책 적용",
     _GOOD.split("### 📦 산출물")[0], {DOMAIN_FIELD: {"id": "1"}}, ["📦 산출물` 섹션이 없다"]),
    ("산출물 유형 목록 밖", "초대 링크 만료 정책 적용",
     _GOOD.replace("유형: PR", "유형: 슬라이드"), {DOMAIN_FIELD: {"id": "1"}}, ["목록 밖"]),
    ("산출물 위치 애매", "초대 링크 만료 정책 적용",
     _GOOD.replace("남길 위치: server/data-api — OneOrThree/phone PR", "남길 위치: 알아서"),
     {DOMAIN_FIELD: {"id": "1"}}, ["위치 「알아서」 가 애매"]),
    ("완료 조건 1개", "초대 링크 만료 정책 적용",
     _GOOD.replace("- [ ] 만료 링크 재사용 시 409 를 검증하는 테스트가 있다\n", ""),
     {DOMAIN_FIELD: {"id": "1"}}, ["1개 — 2개 이상"]),
    ("완료 조건 애매", "초대 링크 만료 정책 적용",
     _GOOD.replace("만료 링크 재사용 시 409 를 검증하는 테스트가 있다", "잘 동작한다"),
     {DOMAIN_FIELD: {"id": "1"}}, ["완료 조건이 애매하다: 「잘 동작한다」"]),
    ("완료 조건 우회 — 숫자만 붙임", "초대 링크 만료 정책 적용",
     _GOOD.replace("만료 링크 재사용 시 409 를 검증하는 테스트가 있다", "동작하게1234"),
     {DOMAIN_FIELD: {"id": "1"}}, ["완료 조건이 애매하다: 「동작하게1234」"]),
    ("완료 조건 우회 — 두 글자 대문자", "초대 링크 만료 정책 적용",
     _GOOD.replace("만료 링크 재사용 시 409 를 검증하는 테스트가 있다", "완료함 OK 처리"),
     {DOMAIN_FIELD: {"id": "1"}}, ["완료 조건이 애매하다: 「완료함 OK 처리」"]),
    ("완료 조건 우회 — 길이만 채움", "초대 링크 만료 정책 적용",
     _GOOD.replace("만료 링크 재사용 시 409 를 검증하는 테스트가 있다", "제대로 마무리해서 확실하게 완료되도록 처리한다"),
     {DOMAIN_FIELD: {"id": "1"}}, ["완료 조건이 애매하다: 「제대로 마무리해서"]),
    ("통과 — 비코드 완료 조건", "온보딩 시안 제작",
     _GOOD.replace("- [ ] POST /api/groups/{id}/invite 가 201 과 링크를 반환한다", "- [ ] 시안 3종이 Figma 온보딩 v2 페이지에 올라가 있다")
          .replace("- [ ] 만료 링크 재사용 시 409 를 검증하는 테스트가 있다", "- [ ] 선택안 링크가 지라 코멘트로 남아 있다")
          .replace("유형: PR", "유형: 디자인 시안").replace("남길 위치: server/data-api — OneOrThree/phone PR", "남길 위치: https://www.figma.com/file/abc"),
     {DOMAIN_FIELD: {"id": "1"}}, []),
    ("예상 시간 뒤 잡문", "초대 링크 만료 정책 적용",
     _GOOD.replace("4h\n", "4h 대략\n"), {DOMAIN_FIELD: {"id": "1"}}, ["예상 작업 시간 형식"]),
    ("산출물 유형 부분 일치", "초대 링크 만료 정책 적용",
     _GOOD.replace("유형: PR", "유형: PR x"), {DOMAIN_FIELD: {"id": "1"}}, ["목록 밖"]),
    ("접두·목표·도메인 없음", "[BE] 초대 링크 만료 정책 적용",
     _GOOD.split("### ✅ 완료 조건")[1].join(["### ✅ 완료 조건", ""]) if False else
     "### ✅ 완료 조건" + _GOOD.split("### ✅ 완료 조건")[1], {},
     ["대괄호 접두 금지", "🎯 목표` 섹션이 없다", "`도메인` 필드가 없다"]),
]


def run_selftest():
    failed = 0
    for name, summary, desc, fields, expected in _FIXTURES:
        got = check_ticket(summary, "작업", desc, fields)
        ok = (not got) if not expected else all(any(e in g for g in got) for e in expected)
        mark = "✅" if ok else "❌"
        print(f"{mark} {name}: {len(got)}건")
        for g in got:
            print(f"     - {g}")
        if not ok:
            failed += 1
            print(f"     기대: {expected}")
    epic = check_ticket("[그룹] 초대 개편", "Epic", "", {})
    print(("✅" if not epic else "❌") + f" 에픽 면제: {len(epic)}건")
    failed += bool(epic)
    print(f"\n{'통과' if not failed else '실패'}: {len(_FIXTURES) + 1 - failed}/{len(_FIXTURES) + 1}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    if "--hook" in sys.argv:
        run_hook()
    elif "--selftest" in sys.argv:
        run_selftest()
    else:
        sys.exit(__doc__)
