#!/usr/bin/env python3
"""추적 중인 Claude 설정과 PR/Jira 게이트, 운영 영향 경고, 하네스 문서·스킬·워크플로 지도의 일치를 외부 서비스 없이 검증한다.

보장하는 것: 추적되는 .claude/settings.json 의 훅 구조, 저장소 내부 훅 파일의 존재, 두 게이트(pr-gate · jira_gate)가
PreToolUse 에, 운영 영향 훅(prod-impact)이 PreToolUse(Bash)와 PostToolUse(편집 도구)에 동기·인용된 $CLAUDE_PROJECT_DIR
경로로 연결돼 있음(prod-impact 는 스크립트가 없으면 조용히 끝나는 존재 가드 `[ -f … ] || exit 0;` 모양만 인정),
permissions.ask 에 운영 배포 확인 규칙이 있음, 세 스크립트의 --selftest 통과. 그리고 문서 센서 여섯 개(추적 파일만 본다):
1 하네스 문서의 상대 링크와 백틱 저장소 경로가 추적 파일·폴더(또는 무시 경로)를 가리킨다.
2 하네스 문서가 적은 워크플로 파일이 실재하고, 은퇴(`# RETIRED`)한 것은 은퇴 표시와 함께만 나온다.
3 은퇴하지 않은 워크플로 파일 이름은 전부 docs/engineering/pipeline-map.md 에 나온다.
4 모든 SKILL.md 에 name(폴더 이름과 같음)·description 이 있고, prod-release · app-release 는 사람만 부른다.
5 루트 CLAUDE.md 는 12KB 이하다.
6 CONTEXT.md `_Avoid_` 의 단어가 루트 CLAUDE.md · AGENTS.md · backoffice/AGENTS.md · 스킬 SKILL.md 의 산문에 없다.

보장하지 않는 것:
- 훅 명령이 Claude Code 안에서 실제로 같은 방식으로 실행된다는 것 — 문자열 구조와 파일 존재만 본다.
- pr-gate · jira_gate 의 존재 가드 — 세션이 도는 중에 체크아웃이 스크립트 없는 옛 브랜치로 바뀌면 python 이 exit 2 를 내
  PreToolUse 가 Bash(jira_gate 는 createJiraIssue) 호출을 막는다. 두 게이트는 가드 없는 모양 그대로다.
- ask 규칙이 실제 명령에 매칭된다는 것 — 규칙 문자열의 존재만 본다(매칭 한계는 .claude/prod-impact.py 의 docstring).
- 개인 설정 — settings.local.json · ~/.claude/settings.json · 관리형 정책이 게이트를 끄거나 disableAllHooks 를
  켜도 이 검사는 초록이다. 「모두의 세션에서 게이트가 켜져 있다」는 증명이 아니다.
- 게이트 로직의 정확성 — 각 --selftest 가 아는 범위까지만.
- 문서 문장이 사실이라는 것 — 경로·이름이 «있다»까지만 본다. 그 경로가 맞는 파일인지, 설명이 파일 내용과 같은지는 모른다.
  펜스 코드 블록(닫히지 않은 펜스의 뒷부분 포함) 안의 경로, 공백이 든 명령줄, 와일드카드·자리표시(`*` `<x>` `{a,b}` `$X` `…`)가
  든 경로, 최상위 폴더 이름으로 시작하지 않는 줄임 경로, app/legacy/ 문서는 보지 않는다. 링크 대상은 추적 파일·폴더만 인정한다.
- 문서 묶음 밖 문서(PRD·보고서·docs/architecture 등), 은퇴 표시가 아닌 이유로 낡은 워크플로(예: 은퇴 표시를 못 다는 prod-ci.yml).
- 용어: «조건부» 금지어(괄호에 «때»·«단독»이 있는 것, `앱`·`dev`·`운영`·단독 V2 …)는 낱말 일치로 판정할 수 없어 건너뛴다.
  건너뛴 수는 통과 줄에 찍힌다. 코드·링크 대상·펜스 블록·gromo-screen-flow 스킬(옛 이름이 호출 단어)은 보지 않는다.
- server/ 아래 문서의 알려진 낡은 언급(STALE_IN_SERVER_DOCS) — 그 문서를 고치면 dev 재배포를 부르므로 이 검사에서 뺀다.
- 스킬 스크립트 테스트 — .github/workflows/agent-harness.yml 이 돌린다(이 파일이 아니다).
"""

import json
from pathlib import Path
import posixpath
import re
import shlex
import subprocess
import sys
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[2]
# 게이트 제거·matcher 변경으로 검사가 조용히 사라지는 것을 막는 계약이다.
GATES = {
    ".claude/pr-gate.py": "Bash",
    ".claude/jira_gate.py": ".*createJiraIssue$",
}
# 운영 영향 훅은 막지 않고 알리기만 하지만, 빠지거나 비동기·상대 경로로 바뀌면 경고가 조용히 사라진다는 점은 같다.
# 그래서 게이트와 같은 모양 검사를 받는다. 이벤트가 둘이라 {스크립트: ((이벤트, matcher), …)} 로 적는다.
PROD_IMPACT = ".claude/prod-impact.py"
GUARDED = {
    **{script: (("PreToolUse", matcher),) for script, matcher in GATES.items()},
    PROD_IMPACT: (("PreToolUse", "Bash"), ("PostToolUse", "Edit|Write|MultiEdit|NotebookEdit")),
}
# Claude Code 는 세션 시작 때 훅 설정을 고정한다. 새 훅이 있는 세션이 도는 중에 체크아웃이 스크립트 없는 옛 브랜치로 바뀌면
# python 이 exit 2 를 내고 PreToolUse 는 모든 Bash 호출을 막는다. 그래서 운영 영향 훅은 파일이 없으면 조용히 끝나는
# 존재 가드 `[ -f "<경로>" ] || exit 0; python3 "<경로>" --hook` 모양만 등록으로 인정한다(가드를 빼면 보호가 조용히 빠진다).
GUARD_REQUIRED = (PROD_IMPACT,)
# 운영 배포 명령의 확인은 훅이 아니라 permissions.ask 로 한다(bypassPermissions 에서도 지켜진다). rtk 훅이 `gh api …` 를
# `rtk gh api …` 로 다시 쓰므로 gh api 규칙은 rtk 형태를 함께 둔다. Android CD 는 Play 내부 테스트에 게시하는데 이름에
# prod 가 없어 따로 둔다.
PROD_ASK_RULES = (
    "Bash(gh workflow run *prod*)",
    "Bash(gh workflow run *Cattus*)",
    "Bash(gh workflow run *android-cd*)",
    "Bash(gh workflow run *Android CD*)",
    "Bash(gh api *dispatches*)",
    "Bash(gh api *pending_deployments*)",
    "Bash(rtk gh api *dispatches*)",
    "Bash(rtk gh api *pending_deployments*)",
)
PROJECT_PREFIXES = ("$CLAUDE_PROJECT_DIR/", "${CLAUDE_PROJECT_DIR}/")
# 변수 접두사 없이 적힌 저장소 내부 참조도 같은 검사를 받는다 — 훅은 CLAUDE_PROJECT_DIR 에서 실행되므로
# 이 상대 경로는 저장소 파일을 가리킨다.
REPO_RELATIVE_PREFIXES = (".claude/", ".github/")
INTERPRETERS = {"python3", "python", "bash", "sh", "zsh", "node"}
CONNECTORS = {"&&", "||", "|", ";", "&"}


def command_segments(tokens):
    """연결자(&& · || · | · ; · &)로 나눈 명령 구간 [start, end)."""
    segments = []
    start = 0
    for index, token in enumerate(tokens):
        if token in CONNECTORS:
            segments.append((start, index))
            start = index + 1
    segments.append((start, len(tokens)))
    return segments


def script_positions(tokens):
    """실행 파일 자리의 토큰 인덱스 — 명령마다 첫 토큰, 그리고 인터프리터면 옵션(-x) 뒤 첫 인자.

    `bash -c "…"` 의 문자열은 파일이 아니라 명령이므로 `-c` 뒤는 보지 않는다.
    한계: 그 문자열 안에 든 명령은 토큰 하나라 들여다보지 않는다.
    """
    positions = set()
    for start, end in command_segments(tokens):
        if start >= end:
            continue
        positions.add(start)
        if tokens[start] not in INTERPRETERS:
            continue
        for index in range(start + 1, end):
            token = tokens[index]
            if token == "-c":
                break
            if not token.startswith("-"):
                positions.add(index)
                break
    return positions


def positions_after_cd(tokens):
    """`cd …` 가 앞서 나온 뒤의 토큰 인덱스 — 거기서부터 상대 경로의 기준 디렉터리를 알 수 없다."""
    moved = set()
    seen_cd = False
    for start, end in command_segments(tokens):
        if start < end and tokens[start] == "cd":
            seen_cd = True
        if seen_cd:
            moved.update(range(start, end))
    return moved


def repo_reference(token, root, positional, moved):
    """토큰이 저장소 파일을 가리키면 (저장소 상대 경로, 변수 접두 여부)를, 아니면 None 을 돌려준다.

    $CLAUDE_PROJECT_DIR 로 적은 참조는 어느 자리에 있어도 돌려준다. 접두사 없는 상대·절대 경로는
    실행 파일 자리일 때만 — 그 밖의 인자는 `touch <경로>` 처럼 출력 경로일 수 있다. `cd` 뒤의 상대 경로는
    기준이 바뀌어 판정하지 않는다(`-c` 뒤의 명령 문자열은 자리 계산에서 이미 빠진다).
    """
    for prefix in PROJECT_PREFIXES:
        if token.startswith(prefix):
            return token[len(prefix):], True
    if not positional:
        return None
    if token.startswith("./") or token.startswith(REPO_RELATIVE_PREFIXES):
        if moved:
            return None
        return (token[2:] if token.startswith("./") else token), False
    if token.startswith("/"):
        # 절대 경로는 심링크를 풀어 비교한다(macOS 의 /var → /private/var 처럼 글자가 달라도 같은 곳).
        candidate = Path(token).resolve()
        if candidate.is_relative_to(root):
            return str(candidate.relative_to(root)), False
    return None


def validate_settings(root):
    """훅 명령은 실행하지 않고 설정 구조와 저장소 내부 참조를 확인한다."""
    root = root.resolve()
    settings = json.loads((root / ".claude/settings.json").read_text(encoding="utf-8"))
    if not isinstance(settings, dict) or not isinstance(settings.get("hooks"), dict):
        raise ValueError(".claude/settings.json: hooks 객체가 필요합니다")
    # 전역 끄기 한 줄이면 아래 훅 목록이 전부 장식이 된다 — 목록 검사보다 먼저 거절한다.
    if settings.get("disableAllHooks"):
        raise ValueError(".claude/settings.json: disableAllHooks 가 켜져 있어 저장소 훅이 실행되지 않습니다")

    registered = set()
    for event, groups in settings["hooks"].items():
        if not isinstance(groups, list) or not groups:
            raise ValueError(f"{event}: 비어 있지 않은 훅 그룹 목록이 필요합니다")
        for group in groups:
            # Stop·SessionStart 같은 이벤트는 matcher 를 생략한다 — 생략·빈 문자열은 허용하고 게이트 대조에서만 본다.
            if not isinstance(group, dict) or not isinstance(group.get("matcher", ""), str):
                raise ValueError(f"{event}: matcher 는 생략하거나 문자열이어야 합니다")
            hooks = group.get("hooks")
            if not isinstance(hooks, list) or not hooks:
                raise ValueError(f"{event}: 비어 있지 않은 hooks 목록이 필요합니다")
            for hook in hooks:
                if not isinstance(hook, dict):
                    raise ValueError(f"{event}: 훅은 객체여야 합니다")
                if hook.get("type") != "command":
                    # prompt·http 훅은 파일 참조가 없어 검사할 것이 없다. 게이트는 아래 등록 조건이 command 를 강제한다.
                    continue
                command = hook.get("command")
                if not isinstance(command, str) or not command.strip():
                    raise ValueError(f"{event}: command 문자열이 필요합니다")
                # shlex 는 인용을 벗겨 버려 '$CLAUDE_PROJECT_DIR/…' 와 "$CLAUDE_PROJECT_DIR/…" 가 같은 토큰이
                # 된다. 실제 셸에서는 작은따옴표·백슬래시 안의 변수가 확장되지 않아 파이썬이 파일 부재로 죽고
                # 게이트가 돌지 않으므로, 토큰화 전에 원문에서 막힌 확장을 거절한다.
                # 한계: bash -c '"$CLAUDE_PROJECT_DIR/x"' 는 자식 셸에서 정상 확장되는데도 거절된다(안전한 방향의 오탐).
                if any("CLAUDE_PROJECT_DIR" in quoted for quoted in re.findall(r"'[^']*'", command)) \
                        or re.search(r"\\\$\{?CLAUDE_PROJECT_DIR", command):
                    raise ValueError(f"{event}: 훅 경로의 $CLAUDE_PROJECT_DIR 확장이 인용·이스케이프로 막혀 있습니다")
                lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
                lexer.whitespace_split = True
                tokens = list(lexer)
                executable_positions = script_positions(tokens)
                moved_positions = positions_after_cd(tokens)
                for index, token in enumerate(tokens):
                    reference = repo_reference(token, root, index in executable_positions, index in moved_positions)
                    if reference is None:
                        continue
                    relative, explicit = reference
                    target = (root / relative).resolve()
                    if not target.is_relative_to(root):
                        raise ValueError(f"{event}: 저장소 밖의 훅 경로입니다: {relative}")
                    if explicit and index not in executable_positions:
                        # 출력 경로·디렉터리일 수 있다(touch·mkdir·리다이렉션) — 저장소 안이면 충분하다.
                        continue
                    if not target.is_file():
                        raise ValueError(f"{event}: 훅 파일이 없습니다: {relative}")
                    if relative not in GUARDED:
                        continue
                    # 게이트는 «막는» 훅이다 — 비동기면 도구 실행을 못 막고, 경로가 인용되지 않으면
                    # 공백이 든 체크아웃에서 인자가 갈라져 게이트가 뜨지도 못한다.
                    if hook.get("async"):
                        raise ValueError(f"{event}: 필수 게이트는 동기 실행이어야 합니다(async 금지): {relative}")
                    # 존재 가드가 있으면 같은 경로가 두 번 나온다 — 나온 횟수만큼 모두 인용돼야 한다(`[ -f $경로 ]` 는 공백 경로에서
                    # 인자 오류로 죽어 훅이 조용히 빠진다).
                    if command.count(f'"{token}"') < tokens.count(token):
                        raise ValueError(f"{event}: 게이트 경로는 큰따옴표로 인용해야 합니다: {relative}")
                    # 훅은 현재 작업 디렉터리에서 실행된다 — 상대 경로 게이트는 server/data-api 에서 작업하면
                    # 그 아래의 .claude/ 를 찾다 죽어 모든 Bash 를 막는다. 게이트만은 변수 기준 경로여야 한다.
                    if not explicit:
                        raise ValueError(f"{event}: 게이트 경로는 $CLAUDE_PROJECT_DIR 기준이어야 합니다: {relative}")
                    # shlex 는 줄바꿈을 공백으로 보지만 셸은 명령 구분자로 본다 — 게이트가 인자 없이 끝나 버린다.
                    if "\n" in command or "\r" in command:
                        raise ValueError(f"{event}: 게이트 명령에 줄바꿈이 있습니다: {relative}")
                    expected = ["python3", token, "--hook"]
                    if relative in GUARD_REQUIRED:      # 가드의 경로와 실행 경로는 같은 토큰(같은 파일)이어야 한다
                        expected = ["[", "-f", token, "]", "||", "exit", "0", ";"] + expected
                    if (event, group.get("matcher")) in GUARDED[relative] and tokens == expected:
                        registered.add((relative, event, group.get("matcher")))

    required = {(script, event, matcher) for script, places in GUARDED.items() for event, matcher in places}
    missing = required - registered
    if missing:
        raise ValueError("훅 게이트 연결이 없거나 잘못되었습니다: "
                         + ", ".join(f"{script} ({event}/{matcher})" for script, event, matcher in sorted(missing)))
    permissions = settings.get("permissions")
    ask = permissions.get("ask") if isinstance(permissions, dict) else None
    absent = [rule for rule in PROD_ASK_RULES if not isinstance(ask, list) or rule not in ask]
    if absent:
        raise ValueError("permissions.ask 에 운영 배포 확인 규칙이 없습니다: " + ", ".join(absent))


# ── 문서 센서 (GROMO-2697) ────────────────────────────────────────────────────────────────────────────
# 문서·스킬·워크플로가 서로 어긋나면 CI 가 빨개지게 하는 검사 여섯 개. 파일 목록은 `git ls-files` 의 추적 파일만 쓴다(체크아웃에만
# 있는 파일을 보고 통과하면 CI 에서 깨진다). 검사마다 위반을 전부 모아 ValueError 하나로 낸다 — 고치는 사람이 한 번에 다 본다.
PIPELINE_MAP = "docs/engineering/pipeline-map.md"
V1_SECTION = "2-2 V1 워크플로와 V2 대응"                          # 은퇴한 워크플로 이름을 표시 없이 적어도 되는 절
NO_FILE_SECTION = "2-3 GitHub에 등록됐지만 파일이 없는 워크플로"     # 저장소에 없는 워크플로 이름을 적어도 되는 절
RETIRED_FIRST_LINE = "# RETIRED"                                  # 은퇴한 워크플로 파일의 첫 줄
RETIRED_WORDS = re.compile(r"RETIRED|retired|V1|은퇴|꺼진|꺼져|옛|legacy|disabled|제거|폐기")   # 같은 줄의 은퇴 표시
ROOT_DOCS = ("CLAUDE.md", "AGENTS.md", "CONTEXT.md", "README.md", "docs/README.md")
DOC_DIRS = (".claude/commands", ".claude/agents", "docs/conventions", "docs/engineering")
HUMAN_ONLY_SKILLS = ("prod-release", "app-release")             # 운영을 바꾸는 절차 — disable-model-invocation: true 가 있어야 한다
CLAUDE_MD_MAX_BYTES = 12288
GLOSSARY_DOCS = ("CLAUDE.md", "AGENTS.md", "backoffice/AGENTS.md")
# 옛 이름(GROMO·Catus·Focuscat)과 «방장» 이 사용자가 부르는 말 그대로 description·본문에 든 스킬이다 — 호출 단어를 바꾸면 트리거가 깨진다.
GLOSSARY_EXCLUDED = (".claude/skills/gromo-screen-flow/SKILL.md",)
# server/ 아래 문서는 고치면 dev 재빌드·재배포를 부를 수 있어 GROMO-2697 이 고치지 못했다. 그 안의 낡은 언급은 이 검사에서 뺀다.
# {(검사, 문서): (뺄 토큰, …)} — 문서를 고칠 때 이 항목도 지운다. 같은 문서의 다른 위반이나 다른 문서의 같은 위반은 그대로 잡힌다.
STALE_IN_SERVER_DOCS = {}

FENCE_OPEN = re.compile(r"^\s*(`{3,}|~{3,})")
HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
INLINE_CODE = re.compile(r"(`+)(.+?)\1")
MARKDOWN_LINK = re.compile(r"!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")
LINK_TARGET = re.compile(r"\]\([^)]*\)")
BARE_URL = re.compile(r"https?://\S+")
URL_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
LINE_NUMBER = re.compile(r":\d+(?:-\d+)?$")                            # `file.py:12` · `file.py:12-34`
NOT_CONCRETE = re.compile(r"[\s*?<>{}$…]|\.\.\.")                      # 자리표시·와일드카드·변수가 든 토큰은 구체 경로가 아니다
CONCRETE_PATH = re.compile(r"[\w.@+~%/#-]+")
WORKFLOW_NAME = re.compile(r"(?<![A-Za-z0-9._-])([A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml)(?![A-Za-z0-9_-])")
# 이 저장소 워크플로 이름꼴(확장자 뺀 이름): `ops-` 로 시작 · `-ci`/`-cd` 마디 · `.dev`/`.prod` 마디. `-V2` 마디는 뺐다 —
# Infra 저장소의 `compose-V2.yml` 같은 설정 파일도 그 꼴이고, 이 저장소의 V2 워크플로는 위 셋 중 하나를 늘 갖는다.
WORKFLOW_SHAPE = re.compile(r"^ops-|-(?:ci|cd)(?=[.-]|$)|\.(?:dev|prod)(?=[.-]|$)")
WORKFLOW_FILE = re.compile(r"\.github/workflows/[^/]+\.ya?ml")
SKILL_FILE = re.compile(r"\.claude/skills/([^/]+)/SKILL\.md")
TERM_HEADER = re.compile(r"^\*\*(.+?)\*\*:\s*$")
AVOID_LINE = re.compile(r"^_Avoid_:\s*(.+?)\s*$")
AVOID_ENTRY = re.compile(r"^([^()]*?)\s*(?:\((.*)\))?$", re.S)


def tracked_files(root):
    """`git ls-files` 가 돌려주는 추적 파일(저장소 상대 경로, `/` 구분)."""
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        capture_output=True, encoding="utf-8", errors="surrogateescape", timeout=30,
    )
    if result.returncode:
        raise ValueError(f"git ls-files 실패 ({result.returncode}): {result.stderr.strip()}")
    return sorted(path for path in result.stdout.split("\0") if path)


def is_ignored(root, path):
    """`git check-ignore -q` — 끝의 `/` 가 있어야 «폴더만» 무시하는 규칙(`ios/credentials/`)에 걸린다."""
    return subprocess.run(["git", "-C", str(root), "check-ignore", "-q", "--", path],
                          capture_output=True, timeout=30).returncode == 0


def read_doc(root, path):
    try:
        return (root / path).read_text(encoding="utf-8").replace("\r\n", "\n")
    except (OSError, UnicodeDecodeError) as error:
        raise ValueError(f"{path}: 읽을 수 없다 ({error})") from error


def fail_if(title, violations):
    if violations:
        raise ValueError(f"{title}: 위반 {len(violations)}건\n" + "\n".join("  " + item for item in violations))


def is_harness_doc(path):
    """검사 1·2 의 대상 — CLAUDE.md·AGENTS.md(app/legacy 제외), 에이전트·규약·엔지니어링 문서, 스킬, server/ 안내문."""
    if path.startswith("app/legacy/"):
        return False
    parent, _, name = path.rpartition("/")
    if path in ROOT_DOCS or name in ("CLAUDE.md", "AGENTS.md"):
        return True
    if parent in DOC_DIRS:
        return name.endswith(".md")
    return bool(SKILL_FILE.fullmatch(path)) or (path.startswith("server/") and name == "README.md")


def harness_docs(files):
    docs = [path for path in files if is_harness_doc(path)]
    if not docs:      # git 이 빈 목록을 돌려줘도 «검사할 게 없어서 초록»이 되지 않게 한다
        raise ValueError("하네스 문서가 하나도 없다 — 추적 파일 목록이 비었거나 검사 대상 규칙이 깨졌다")
    return docs


def unfenced(text):
    """줄 목록. 펜스 코드 블록 안의 줄은 빈 줄로 바꿔 줄 번호를 지킨다."""
    lines, closing = [], None
    for line in text.split("\n"):
        if closing is None:
            opened = FENCE_OPEN.match(line)
            if opened:
                closing = re.compile(r"\s*%s{%d,}\s*$" % (re.escape(opened.group(1)[0]), len(opened.group(1))))
                line = ""
        else:
            if closing.match(line):
                closing = None
            line = ""
        lines.append(line)
    return lines


def section_range(lines, title):
    """제목이 `title` 인 절의 줄 번호(0부터) 범위. 같은 단계 이하의 다음 제목에서 끝난다. 없으면 빈 범위."""
    for index, line in enumerate(lines):
        heading = HEADING.match(line)
        if heading and heading.group(2) == title:
            for later in range(index + 1, len(lines)):
                following = HEADING.match(lines[later])
                if following and len(following.group(1)) <= len(heading.group(1)):
                    return range(index, later)
            return range(index, len(lines))
    return range(0)


def workflow_states(root, files):
    """{워크플로 파일 이름: 은퇴 여부}. 은퇴 = 파일 첫 줄이 `# RETIRED` 로 시작."""
    states = {}
    for path in files:
        if WORKFLOW_FILE.fullmatch(path):
            with open(root / path, encoding="utf-8") as handle:
                states[path.rsplit("/", 1)[1]] = handle.readline().lstrip("\ufeff").startswith(RETIRED_FIRST_LINE)
    return states


def check_document_paths(root):
    """검사 1 — 상대 마크다운 링크와 백틱 안 저장소 경로가 실재한다."""
    root = root.resolve()
    files = tracked_files(root)
    docs = harness_docs(files)
    known = set(files)
    folders = set()
    for path in files:
        parent = posixpath.dirname(path)
        while parent and parent not in folders:
            folders.add(parent)
            parent = posixpath.dirname(parent)
    top_dirs = {path.split("/", 1)[0] for path in files if "/" in path}
    violations, links, paths, stale = [], 0, 0, 0
    for path in docs:
        base = posixpath.dirname(path)
        excused = STALE_IN_SERVER_DOCS.get(("경로", path), ())
        for number, line in enumerate(unfenced(read_doc(root, path)), 1):
            # 코드 조각 안의 `[x](y)` 는 링크가 아니다 — 지우고 링크만 찾는다.
            for match in MARKDOWN_LINK.finditer(INLINE_CODE.sub(lambda m: " " * len(m.group(0)), line)):
                target = match.group(1)
                if URL_SCHEME.match(target) or target.startswith("#"):
                    continue
                target = unquote(re.split(r"[#?]", target, maxsplit=1)[0])
                if not target:
                    continue
                links += 1
                resolved = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(base, target))
                if resolved != "." and resolved not in known and resolved not in folders:
                    violations.append(f"{path}:{number}: 링크 대상이 없다: {match.group(1)}")
            for match in INLINE_CODE.finditer(line):
                token = LINE_NUMBER.sub("", match.group(2).strip())
                if "/" not in token or NOT_CONCRETE.search(token) or not CONCRETE_PATH.fullmatch(token):
                    continue
                token = token.split("#", 1)[0]
                if token.split("/", 1)[0] not in top_dirs:
                    continue
                paths += 1
                plain = token.rstrip("/")
                # 저장소 기준, 문서 기준(서비스 폴더 문서의 `docs/db/…` 같은 줄임 표기) 순으로 본다.
                relative = posixpath.normpath(posixpath.join(base, plain))
                if any(candidate in known or candidate in folders for candidate in (plain, relative)) or is_ignored(root, token):
                    continue
                if token in excused:
                    stale += 1
                    continue
                violations.append(f"{path}:{number}: 경로가 없다: {token}")
    fail_if("문서 경로", violations)
    return f"문서 {len(docs)}개 · 링크 {links}개 · 백틱 경로 {paths}개 (server/ 문서의 알려진 낡은 경로 {stale}건 제외)"


def check_workflow_mentions(root):
    """검사 2 — 문서가 적은 워크플로가 실재하고, 은퇴한 것은 은퇴 표시와 함께만 나온다."""
    root = root.resolve()
    files = tracked_files(root)
    docs = harness_docs(files)
    states = workflow_states(root, files)
    # 실제로 제거한 파일도 파이프라인 지도 2-2의 제거 상태 행으로만 식별한다.
    # 오타나 임의의 미존재 workflow를 은퇴 표시만으로 허용하지 않는다.
    removed = set()
    if PIPELINE_MAP in files:
        lines = unfenced(read_doc(root, PIPELINE_MAP))
        for index in section_range(lines, V1_SECTION):
            line = lines[index]
            columns = line.split('|')
            if len(columns) >= 4 and columns[2].strip() == '제거됨':
                removed.update(WORKFLOW_NAME.findall(columns[1]))
    states.update({name: True for name in removed if name not in states})
    basenames = {path.rsplit("/", 1)[-1] for path in files}
    violations, marked_lines, stale = [], set(), 0
    for path in docs:
        text = read_doc(root, path)
        in_v1 = no_file = range(0)
        if path == PIPELINE_MAP:
            headings = unfenced(text)
            in_v1, no_file = section_range(headings, V1_SECTION), section_range(headings, NO_FILE_SECTION)
        excused = STALE_IN_SERVER_DOCS.get(("은퇴", path), ())
        for number, line in enumerate(text.split("\n"), 1):
            for match in WORKFLOW_NAME.finditer(line):
                name = match.group(1)
                if name in states:
                    if not states[name] or (number - 1) in in_v1:
                        continue
                    if RETIRED_WORDS.search(line.replace(name, "")):
                        marked_lines.add((path, number))
                    elif name in excused:
                        stale += 1
                    else:
                        violations.append(f"{path}:{number}: 은퇴한 워크플로 {name} 를 은퇴 표시 없이 적었다 "
                                          f"(같은 줄에 «V1»·«옛»·«RETIRED» 같은 표시를 쓰거나 {PIPELINE_MAP} 2-2 절에 적는다)")
                elif line[:match.start()].endswith(".github/workflows/"):
                    violations.append(f"{path}:{number}: 워크플로 파일이 없다: .github/workflows/{name}")
                elif (WORKFLOW_SHAPE.search(name.rsplit(".", 1)[0]) and name not in basenames
                      and (number - 1) not in no_file):
                    violations.append(f"{path}:{number}: 저장소에 없는 워크플로 이름이다: {name}")
    fail_if("워크플로 언급", violations)
    return (f"문서 {len(docs)}개 · 은퇴 표시만으로 통과한 줄 {len(marked_lines)}개 "
            f"(server/ 문서의 알려진 낡은 언급 {stale}건 제외)")


def check_pipeline_map_coverage(root):
    """검사 3 — 은퇴하지 않은 워크플로 파일은 전부 파이프라인 지도에 나온다. 새 워크플로를 넣으면 지도를 고치게 만드는 장치다."""
    root = root.resolve()
    files = tracked_files(root)
    if PIPELINE_MAP not in files:
        raise ValueError(f"{PIPELINE_MAP} 가 추적되지 않는다 — 활성 워크플로를 적는 지도가 있어야 한다")
    text = read_doc(root, PIPELINE_MAP)
    active = sorted(name for name, retired in workflow_states(root, files).items() if not retired)
    missing = [name for name in active
               if not re.search(r"(?<![A-Za-z0-9._-])" + re.escape(name) + r"(?![A-Za-z0-9_-])", text)]
    fail_if(f"{PIPELINE_MAP} 에 없는 활성 워크플로(지도 2-1 표에 한 줄을 더한다. 은퇴했으면 파일 첫 줄에 "
            f"'{RETIRED_FIRST_LINE}: <대체>' 를 단다)", [f".github/workflows/{name}" for name in missing])
    return f"활성 워크플로 {len(active)}개가 모두 지도에 있다"


def front_matter(text):
    """맨 앞 `---` 머리말의 {키: 값}. `>`·`|` 블록 값과 들여쓴 이어지는 줄을 읽는다. 머리말이 없으면 None."""
    lines = text.lstrip("\ufeff").split("\n")
    if not lines or lines[0].rstrip() != "---":
        return None
    values, key = {}, None
    for line in lines[1:]:
        if line.rstrip() == "---":
            return values
        field = re.match(r"^([A-Za-z0-9_-]+):[ \t]*(.*)$", line)
        if field:
            key, value = field.group(1), field.group(2).strip()
            values[key] = "" if re.fullmatch(r"[>|][+-]?\d*", value) or value.startswith("#") else value
        elif key and line[:1] in (" ", "\t"):
            values[key] = (values[key] + " " + line.strip()).strip()
    return None


def check_skill_front_matter(root):
    """검사 4 — 스킬 머리말: name 은 폴더 이름, description 은 비어 있지 않게. 운영을 바꾸는 스킬은 사람만 부른다."""
    root = root.resolve()
    violations, skills = [], 0
    for path in tracked_files(root):
        match = SKILL_FILE.fullmatch(path)
        if not match:
            continue
        skills += 1
        folder = match.group(1)
        values = front_matter(read_doc(root, path))
        if values is None:
            violations.append(f"{path}: 맨 앞에 --- 머리말이 없다")
            continue
        values = {key: value.strip("\"'").strip() for key, value in values.items()}
        if values.get("name") != folder:
            violations.append(f"{path}: name 은 폴더 이름 «{folder}» 와 같아야 한다 (지금 «{values.get('name', '')}»)")
        if not values.get("description"):
            violations.append(f"{path}: description 이 비어 있다")
        if folder in HUMAN_ONLY_SKILLS and values.get("disable-model-invocation", "").lower() != "true":
            violations.append(f"{path}: 운영을 바꾸는 스킬은 머리말에 disable-model-invocation: true 가 있어야 한다")
    fail_if("스킬 머리말", violations)
    return f"스킬 {skills}개"


def check_claude_md_size(root):
    """검사 5 — 항상 읽히는 루트 CLAUDE.md 가 12KB 를 넘지 않는다."""
    path = root / "CLAUDE.md"
    if not path.is_file():
        raise ValueError("루트 CLAUDE.md 가 없다")
    size = len(path.read_bytes())
    if size > CLAUDE_MD_MAX_BYTES:
        raise ValueError(f"루트 CLAUDE.md 가 {size}바이트로 상한 {CLAUDE_MD_MAX_BYTES}바이트를 넘는다 — "
                         "상세는 링크로 보내고 지도와 금지선만 남긴다")
    return f"루트 CLAUDE.md {size}바이트 (상한 {CLAUDE_MD_MAX_BYTES})"


def split_top_level(text, separators):
    """괄호 밖에 있는 separators 문자로만 자른다. 빈 조각은 버린다."""
    parts, depth, current = [], 0, ""
    for char in text:
        depth += (char == "(") - (char == ")")
        if depth == 0 and char in separators:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)
    return [part.strip() for part in parts if part.strip()]


def glossary_terms(context):
    """CONTEXT.md → (굵게 정의된 정식 용어, 검사할 금지어 [(단어, 쓸 용어)], 건너뛴 금지어 [단어]).

    `_Avoid_:` 줄은 괄호 밖의 쉼표로 항목을 가르고, 항목 안 `·` 은 단어를 가른다(`satellite·위성`).
    조건은 «항목 괄호 → 없으면 줄의 마지막 항목 괄호» 순으로 읽는다(`앱, 앱 4종(서버 묶음을 가리킬 때)` 은 둘 다 조건부).
    조건에 «때»·«단독» 이 있거나 단어가 «단독» 으로 시작하면 낱말 일치로 판정할 수 없어 건너뛴다. 단 괄호가 «모두» 로
    시작하면 그 줄 전체에 거는 범위 표시라 건너뛰지 않고 검사한다(`Catus, … 같이숲(모두 2.0 제품을 가리킬 때)`).
    """
    terms, checked, skipped, owner = [], [], [], None
    for line in context.split("\n"):
        header = TERM_HEADER.match(line)
        if header:
            owner = header.group(1)
            terms.extend(term.strip() for term in owner.split(" · "))
            continue
        avoid = AVOID_LINE.match(line)
        if not avoid:
            continue
        entries = []
        for item in split_top_level(avoid.group(1), ","):
            match = AVOID_ENTRY.match(item)
            entries.append((match.group(1).strip(), match.group(2)) if match else (item, None))
        last_note = entries[-1][1]
        whole_line = any(note and note.startswith("모두") for _, note in entries)
        for chunk, note in entries:
            note = last_note if note is None else note
            conditional = chunk.startswith("단독") or (
                not whole_line and note is not None and ("때" in note or "단독" in note))
            for word in split_top_level(chunk, "·"):
                if conditional:
                    skipped.append(word)
                else:
                    checked.append((word, owner))
    return terms, checked, skipped


def prose_lines(text):
    """산문만 남긴 줄 목록 — 펜스 코드 블록·인라인 백틱·링크 대상·주소를 지운다(줄 번호는 그대로)."""
    return [BARE_URL.sub("", LINK_TARGET.sub("]", INLINE_CODE.sub("", line))) for line in unfenced(text)]


def check_glossary_avoid(root):
    """검사 6 — CONTEXT.md `_Avoid_` 의 단어가 루트 문서와 스킬의 산문에 나오면 실패한다. 금지어 목록은 코드에 두지 않는다."""
    root = root.resolve()
    files = tracked_files(root)
    if "CONTEXT.md" not in files:
        raise ValueError("CONTEXT.md 가 추적되지 않는다 — 금지어를 읽을 용어집이 있어야 한다")
    terms, checked, skipped = glossary_terms(read_doc(root, "CONTEXT.md"))
    if not checked:
        raise ValueError("CONTEXT.md 에서 검사할 `_Avoid_` 단어를 하나도 읽지 못했다 — 용어집 모양이 바뀌었는지 본다")
    targets = [path for path in files if path in GLOSSARY_DOCS or SKILL_FILE.fullmatch(path)]
    targets = [path for path in targets if path not in GLOSSARY_EXCLUDED]
    owners = {}      # 같은 단어가 여러 용어의 _Avoid_ 에 있으면(`satellite`) 쓸 용어를 모두 알린다
    for word, owner in checked:
        owners.setdefault(word, [])
        if owner not in owners[word]:
            owners[word].append(owner)
    rules = []
    for word, names in owners.items():
        pattern = (r"(?<![A-Za-z0-9])%s(?![A-Za-z0-9])" if word.isascii() else "%s") % re.escape(word)
        # 더 긴 정식 용어 안의 출현은 통과 — `마을회관` 안의 «회관», `Gromo 1.x` 안의 «Gromo».
        longer = [term for term in terms if word in term and term != word]
        rules.append((word, " · ".join(f"«{name}»" for name in names), re.compile(pattern), longer))
    violations = []
    for path in targets:
        for number, line in enumerate(prose_lines(read_doc(root, path)), 1):
            for word, hint, pattern, longer in rules:
                spans = [found.span() for term in longer for found in re.finditer(re.escape(term), line)]
                if any(not any(start <= found.start() and found.end() <= end for start, end in spans)
                       for found in pattern.finditer(line)):
                    violations.append(f"{path}:{number}: «{word}» 대신 {hint} 를 쓴다 (CONTEXT.md)")
    fail_if("용어집 금지어", violations)
    return f"금지어 {len(owners)}개 검사 · 조건부라 건너뛴 것 {len(skipped)}개 · 문서 {len(targets)}개"


SENSORS = (
    ("문서 경로 실재", check_document_paths),
    ("워크플로 언급", check_workflow_mentions),
    ("파이프라인 지도 포함", check_pipeline_map_coverage),
    ("스킬 머리말", check_skill_front_matter),
    ("루트 CLAUDE.md 크기", check_claude_md_size),
    ("용어집 금지어", check_glossary_avoid),
)


def check_harness(root):
    root = root.resolve()
    validate_settings(root)
    print("[통과] .claude/settings.json 구조 · 훅 경로 · 게이트 연결 · 운영 배포 확인 규칙", flush=True)
    for script in GUARDED:
        result = subprocess.run(
            [sys.executable, str(root / script), "--selftest"],
            cwd=root, capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            raise ValueError(f"{script} --selftest 실패 ({result.returncode})\n{result.stdout}{result.stderr}")
        print(f"[통과] {script} --selftest", flush=True)
    failures = []
    for name, sensor in SENSORS:
        try:
            summary = sensor(root)
        except ValueError as error:      # 한 검사가 빨개도 나머지를 끝까지 돌려 CI 한 번에 다 보이게 한다
            failures.append(str(error))
        else:
            print(f"[통과] {name} — {summary}", flush=True)
    if failures:
        raise ValueError("\n".join(failures))


if __name__ == "__main__":
    try:
        check_harness(ROOT)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"[실패] {error}", file=sys.stderr)
        sys.exit(1)
