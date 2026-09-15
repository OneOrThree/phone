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
_SINGLE_QUOTED = re.compile(r"'[^']*'")
FILL_FLAGS = {"--fill", "--fill-first", "--fill-verbose", "-f"}
LABEL_HINT = ("FEAT→enhancement · FIX→bug · REFACTOR→refactoring · "
              "CHORE→documentation|workflow|test (내용으로 택1, 없으면 라벨 생략)")


def _may_substitute(command):
    """작은따옴표 밖에 `$(`·백틱·`$VAR` 가 있을 때만 셸 치환 가능성이 있다 — 따옴표 안 백틱은 리터럴."""
    return bool(UNPARSEABLE.search(_SINGLE_QUOTED.sub("''", command)))


def find_create(tokens):
    for i in range(len(tokens) - 2):
        if tokens[i] == "gh" and tokens[i + 1] == "pr" and tokens[i + 2] == "create":
            return i + 3
    return None


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
    if "gh pr create" not in command:
        return None
    try:
        tokens = shlex.split(command)
    except ValueError:
        return None
    start = find_create(tokens)
    if start is None:
        return None
    args = parse_args(tokens[start:])
    subst = _may_substitute(command)

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
    if titles and not unknown(titles[0]):
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
    if bodies and not unknown(bodies[0]):
        body = bodies[0]
    files = _vals(args, "--body-file", "-F")
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
    ("따옴표 안 백틱은 리터럴 — 제목 검사됨", _OK.replace("[CHORE] GROMO-1885 컨벤션 정본화", "`UserService` 정리"), ["제목 형식"]),
    ("따옴표 안 백틱 + 정상 제목", _OK.replace("컨벤션 정본화", "`UserService` 정리"), []),
]


def run_selftest():
    failed = 0
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
