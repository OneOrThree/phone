#!/usr/bin/env python3
"""`gh pr create` 게이트 — PreToolUse(Bash) 훅.

담당자(`@me` 만) · 라벨(제목 TYPE 과 대응, 정확히 1개 — CHORE 만 없음 허용) · `--draft` · `--fill`/`--web`
(제목·본문을 명시해야 검사가 된다) · `--reviewer` · 제목 형식 · 세션 링크 · 구현 티켓 외의 전체 키를
PR 이 열리기 전에 막는다. 사용자 확인창은 뜨지 않는다 — 위반 목록이 Claude 에게 돌아가고 고쳐서 다시 연다.
규칙을 지킨 명령과 파싱할 수 없는 명령(변수·서브셸·heredoc)은 무출력으로 통과한다 — 문서가 최후 방어다.

    python3 .claude/pr-gate.py --hook       # stdin: 훅 JSON
    python3 .claude/pr-gate.py --selftest   # 내장 픽스처

정본: docs/conventions/git-pr-conventions.md
"""

import json
import os
import re
import shlex
import sys

TITLE_RE = re.compile(r"^\[(FEAT|FIX|CHORE|REFACTOR)\] GROMO-(\d+) \S")
# 제목 TYPE → 허용 라벨. CHORE 는 내용으로 택1이며 어느 것도 맞지 않으면 없음(빈 라벨) 허용.
TYPE_LABELS = {
    "FEAT": {"enhancement"},
    "FIX": {"bug"},
    "REFACTOR": {"refactoring"},
    "CHORE": {"documentation", "workflow", "test"},
}
LABELS_OK = set().union(*TYPE_LABELS.values())
SESSION_LINK = re.compile(r"claude\.ai/code")
FULL_KEY = re.compile(r"GROMO-(\d+)")
STOP_TOKENS = {";", "&&", "||", "|"}
UNPARSEABLE = re.compile(r"\$\(|`|\$\{?[A-Za-z_]")
FILL_FLAGS = {"--fill", "--fill-first", "--fill-verbose", "-f"}
LABEL_HINT = ("FEAT→enhancement · FIX→bug · REFACTOR→refactoring · "
              "CHORE→documentation|workflow|test (내용으로 택1, 없으면 라벨 생략)")


def _may_substitute(command):
    """작은따옴표 밖(맨몸 또는 큰따옴표 안)에 `$(`·백틱·`$VAR` 가 있을 때만 셸 치환 가능성이 있다.
    따옴표 문맥을 문자 단위로 추적한다 — 큰따옴표 안의 아포스트로피(user's)를 작은따옴표 시작으로 오인하지 않게."""
    out = []
    q = None            # None · "'" · '"'
    i = 0
    while i < len(command):
        c = command[i]
        if q is None:
            if c == "\\" and i + 1 < len(command):
                out.append(" "); i += 2; continue
            if c in ("'", '"'):
                q = c
            else:
                out.append(c)
        elif q == "'":
            if c == "'":
                q = None
            # 작은따옴표 안은 전부 리터럴 — 버린다
        else:  # 큰따옴표 안: \" 이스케이프만 건너뛰고 나머지는 치환 후보
            if c == "\\" and i + 1 < len(command):
                out.append(" "); i += 2; continue
            if c == '"':
                q = None
            else:
                out.append(c)
        i += 1
    return bool(UNPARSEABLE.search("".join(out)))


_GLOBAL_VALUED = {"--repo", "-R", "--hostname"}


def _skip_global_flags(tokens, j):
    """`gh --repo o/r pr create` · `gh pr -R o/r create` 처럼 사이에 끼는 전역 플래그를 건너뛴다."""
    while j < len(tokens):
        t = tokens[j]
        if t in _GLOBAL_VALUED:
            j += 2
        elif t.startswith("--repo=") or t.startswith("--hostname="):
            j += 1
        else:
            break
    return j


def find_creates(tokens):
    """한 Bash 호출 안의 모든 `gh [전역플래그] pr [전역플래그] create` 위치 — 여러 개면 전부 검사한다."""
    found = []
    for i, t in enumerate(tokens):
        if t != "gh":
            continue
        j = _skip_global_flags(tokens, i + 1)
        if j < len(tokens) and tokens[j] == "pr":
            k = _skip_global_flags(tokens, j + 1)
            if k < len(tokens) and tokens[k] == "create":
                found.append(k + 1)
    return found


def parse_args(tokens):
    """gh pr create 뒤의 토큰을 {flag: [values]} 로. 값 없는 플래그는 [True]."""
    valued = {"--assignee", "-a", "--label", "-l", "--title", "-t", "--body", "-b",
              "--body-file", "-F", "--base", "-B", "--head", "-H", "--reviewer", "-r",
              "--milestone", "-m", "--project", "-p", "--template", "-T", "--repo", "-R"}
    out = {}
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok in STOP_TOKENS:
            break
        if tok.startswith("--") and "=" in tok:
            k, v = tok.split("=", 1)
            out.setdefault(k, []).append(v)
        elif tok in valued:
            if i + 1 < len(tokens):
                out.setdefault(tok, []).append(tokens[i + 1])
                i += 1
        elif tok.startswith("-"):
            out.setdefault(tok, []).append(True)
        i += 1
    return out


def _vals(args, *names):
    vals = []
    for n in names:
        vals += [v for v in args.get(n, []) if v is not True]
    return vals


def _has(args, *names):
    return any(n in args for n in names)


def check_command(command, cwd=None):
    """위반 사유 목록. 비어 있으면 통과. None 이면 검사 대상이 아니거나 파싱 불가."""
    if "gh" not in command or "create" not in command:
        return None
    try:
        tokens = shlex.split(command)
    except ValueError:
        return None
    starts = find_creates(tokens)
    if not starts:
        return None
    subst = _may_substitute(command)
    reasons = []
    for n, start in enumerate(starts, 1):
        tag = f"[{n}번째 gh pr create] " if len(starts) > 1 else ""
        reasons += [tag + r for r in _check_one(parse_args(tokens[start:]), subst, cwd)]
    return reasons


def _check_one(args, subst, cwd):
    def unknown(value):
        return subst and UNPARSEABLE.search(value)

    reasons = []
    if _has(args, "--draft", "-d"):
        reasons.append("`--draft` 금지 — codex 자동 리뷰는 ready PR 에만 붙는다")
    if _has(args, *FILL_FLAGS) or _has(args, "--web", "-w"):
        reasons.append("`--fill`·`--web` 금지 — 제목은 `--title`, 본문은 `--body-file` 로 명시해야 게이트가 검사한다")
    if _has(args, "--reviewer", "-r"):
        reasons.append("`--reviewer` 지정 금지 — 리뷰 봇(@claude 코멘트·codex)이 붙는다")

    assignees = _vals(args, "--assignee", "-a")
    if not assignees:
        reasons.append("`--assignee @me` 가 없다 — 담당자는 PR 작성자 본인")
    elif assignees != ["@me"]:
        reasons.append(f"담당자는 `@me` 만 — 지금 {assignees}")

    title_type = None
    title_key = None
    titles = _vals(args, "--title", "-t")
    if not titles:
        reasons.append("`--title` 이 없다 — 대화식 입력은 게이트가 검사할 수 없다. `[TYPE] GROMO-#### 요약` 으로 명시")
    elif not unknown(titles[0]):
        m = TITLE_RE.match(titles[0])
        if not m:
            reasons.append("제목 형식: `[FEAT|FIX|CHORE|REFACTOR] GROMO-#### 한 줄 요약` "
                           f"— 지금 「{titles[0]}」 ([DOC]·[GROMO-####] 대체 표기 금지)")
        else:
            title_type, title_key = m.group(1), m.group(2)

    labels = []
    for v in _vals(args, "--label", "-l"):
        labels += [x.strip() for x in v.split(",") if x.strip()]
    if len(labels) > 1:
        reasons.append(f"라벨은 정확히 1개 — 지금 {len(labels)}개: {labels}")
    elif not labels:
        if title_type != "CHORE":
            reasons.append("`--label` 이 없다 — " + LABEL_HINT)
    else:
        lab = labels[0]
        if lab.startswith("release:"):
            reasons.append(f"`{lab}` 은 PR 에 붙이지 않는다 (릴리스 라벨)")
        elif lab not in LABELS_OK:
            reasons.append(f"라벨 「{lab}」 은 목록 밖 — " + " · ".join(sorted(LABELS_OK)))
        elif title_type and lab not in TYPE_LABELS[title_type]:
            reasons.append(f"제목 `[{title_type}]` 과 라벨 「{lab}」 이 안 맞는다 — " + LABEL_HINT)

    body = None
    bodies = _vals(args, "--body", "-b")
    files = _vals(args, "--body-file", "-F")
    if not bodies and not files:
        reasons.append("`--body-file`(또는 `--body`)이 없다 — 대화식 입력은 게이트가 검사할 수 없다. 템플릿 8섹션으로 명시")
    if files and files[0] == "-":
        reasons.append("`--body-file -`(표준 입력) 금지 — 게이트가 본문을 읽을 수 없다. 파일 경로로 준다")
    if bodies and not unknown(bodies[0]):
        body = bodies[0]
    if files and files[0] != "-" and not unknown(files[0]):
        path = files[0] if os.path.isabs(files[0]) else os.path.join(cwd or os.getcwd(), files[0])
        try:
            with open(path, encoding="utf-8") as fp:
                body = fp.read()
        except OSError:
            body = None
    if body is not None:
        if SESSION_LINK.search(body):
            reasons.append("본문에 claude.ai/code 세션 링크가 있다 — 지운다")
        if title_key is not None:
            extra = sorted({k for k in FULL_KEY.findall(body) if k != title_key}, key=int)
            if extra:
                reasons.append("구현 티켓 외의 전체 키가 본문에 있다: "
                               + ", ".join(f"GROMO-{k}" for k in extra)
                               + " — 참조 티켓은 「티켓 " + extra[0] + "」 처럼 번호만 쓴다")
    return reasons


def run_hook():
    try:
        data = json.load(sys.stdin)
    except (ValueError, OSError):
        return
    ti = data.get("tool_input") or {}
    command = ti.get("command") if isinstance(ti, dict) else None
    if not isinstance(command, str):
        return
    reasons = check_command(command, data.get("cwd"))
    if not reasons:
        return
    reason = ("PR 생성 거부 — 아래를 고쳐 다시 연다 (정본: docs/conventions/git-pr-conventions.md):\n"
              + "\n".join(f"- {r}" for r in reasons))
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}, ensure_ascii=False))


_OK = ("gh pr create --assignee @me --label workflow "
       "--title '[CHORE] GROMO-1885 컨벤션 정본화' --body '## Jira\n- [GROMO-1885](x)\n티켓 455 참고'")
_FIXTURES = [
    ("통과", _OK, []),
    ("통과 — CHORE 무라벨", _OK.replace("--label workflow ", ""), []),
    ("통과 — FEAT+enhancement", _OK.replace("--label workflow", "--label enhancement").replace("[CHORE]", "[FEAT]"), []),
    ("무관한 명령", "ls -la && gh pr view 12", None),
    ("draft", _OK + " --draft", ["--draft"]),
    ("fill", _OK + " --fill", ["--fill"]),
    ("web", _OK + " --web", ["--web"]),
    ("reviewer", _OK + " --reviewer alice", ["--reviewer"]),
    ("담당자 없음", _OK.replace("--assignee @me ", ""), ["--assignee"]),
    ("담당자 타인", _OK.replace("--assignee @me", "--assignee alice"), ["`@me` 만"]),
    ("라벨 없음 (FEAT)", _OK.replace("--label workflow ", "").replace("[CHORE]", "[FEAT]"), ["--label"]),
    ("라벨 2개", _OK.replace("--label workflow", "--label workflow,bug"), ["정확히 1개"]),
    ("라벨 -l 두 번", _OK.replace("--label workflow", "-l workflow -l bug"), ["정확히 1개"]),
    ("TYPE↔라벨 불일치", _OK.replace("--label workflow", "--label bug").replace("[CHORE]", "[FEAT]"), ["안 맞는다"]),
    ("release 라벨", _OK.replace("--label workflow", "--label release:minor"), ["릴리스 라벨"]),
    ("제목 형식", _OK.replace("[CHORE] GROMO-1885", "[GROMO-1885]"), ["제목 형식"]),
    ("세션 링크", _OK.replace("티켓 455 참고", "https://claude.ai/code/session/abc"), ["세션 링크"]),
    ("타 티켓 전체 키", _OK.replace("티켓 455 참고", "GROMO-455 참고"), ["GROMO-455"]),
    ("파싱 불가", "gh pr create --title \"$TITLE\" --body \"$(cat body.md)\" --assignee @me --label bug", []),
    ("제목·본문 없음(대화식)", "gh pr create --assignee @me --label bug", ["`--title` 이 없다", "`--body-file`"]),
    ("큰따옴표 안 아포스트로피 + 백틱 → 치환 가능 → 제목 검사 스킵",
     "gh pr create --title \"[FEAT] GROMO-100 user's `whoami` fix\" --body 'normal body' --assignee @me --label enhancement", []),
    ("한 명령에 둘 — 두 번째가 draft", _OK + " && " + _OK + " --draft", ["[2번째 gh pr create] `--draft`"]),
    ("전역 --repo 앞자리", _OK.replace("gh pr create", "gh --repo OneOrThree/phone pr create") + " --draft", ["--draft"]),
    ("전역 -R 중간자리", _OK.replace("gh pr create", "gh pr -R OneOrThree/phone create") + " --draft", ["--draft"]),
    ("표준 입력 본문", _OK.replace("--body '## Jira\n- [GROMO-1885](x)\n티켓 455 참고'", "--body-file -"), ["표준 입력"]),
    ("따옴표 안 백틱은 리터럴 — 제목 검사됨", _OK.replace("[CHORE] GROMO-1885 컨벤션 정본화", "`UserService` 정리"), ["제목 형식"]),
    ("따옴표 안 백틱 + 정상 제목", _OK.replace("컨벤션 정본화", "`UserService` 정리"), []),
]


_SUBST_FIXTURES = [
    ("gh pr create --title 'a `b` c'", False),
    ("gh pr create --title \"a `b` c\"", True),
    ("gh pr create --title \"$T\" --body 'x'", True),
    ("gh pr create --title \"user's `whoami`\" --body 'normal body'", True),
    ("gh pr create --title 'it'\"'\"'s `x`' --body 'y'", False),   # 백틱은 작은따옴표 조각 안 → 리터럴
    ("gh pr create --title 'plain' --body \"$(cat b.md)\"", True),
    ("gh pr create --title 'plain' --body 'no subst'", False),
]


def run_selftest():
    failed = 0
    for cmd, expected in _SUBST_FIXTURES:
        got = _may_substitute(cmd)
        print(("✅" if got == expected else "❌") + f" _may_substitute={got}: {cmd}")
        failed += got != expected
    for name, cmd, expected in _FIXTURES:
        got = check_command(cmd, os.getcwd())
        if expected is None:
            ok = got is None
        elif not expected:
            ok = not got
        else:
            ok = bool(got) and all(any(e in g for g in got) for e in expected)
        print(("✅" if ok else "❌") + f" {name}: {got}")
        failed += not ok
    print(f"\n{'통과' if not failed else '실패'}: {len(_FIXTURES) - failed}/{len(_FIXTURES)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    if "--hook" in sys.argv:
        run_hook()
    elif "--selftest" in sys.argv:
        run_selftest()
    else:
        sys.exit(__doc__)
