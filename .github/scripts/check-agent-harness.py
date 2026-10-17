#!/usr/bin/env python3
"""추적 중인 Claude 설정과 PR/Jira 게이트를 외부 서비스 없이 검증한다."""

import json
from pathlib import Path
import re
import shlex
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
# 게이트 제거·matcher 변경으로 검사가 조용히 사라지는 것을 막는 계약이다.
GATES = {
    ".claude/pr-gate.py": "Bash",
    ".claude/jira_gate.py": ".*createJiraIssue$",
}
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
                    if relative not in GATES:
                        continue
                    # 게이트는 «막는» 훅이다 — 비동기면 도구 실행을 못 막고, 경로가 인용되지 않으면
                    # 공백이 든 체크아웃에서 인자가 갈라져 게이트가 뜨지도 못한다.
                    if hook.get("async"):
                        raise ValueError(f"{event}: 필수 게이트는 동기 실행이어야 합니다(async 금지): {relative}")
                    if f'"{token}"' not in command:
                        raise ValueError(f"{event}: 게이트 경로는 큰따옴표로 인용해야 합니다: {relative}")
                    # 훅은 현재 작업 디렉터리에서 실행된다 — 상대 경로 게이트는 server/data-api 에서 작업하면
                    # 그 아래의 .claude/ 를 찾다 죽어 모든 Bash 를 막는다. 게이트만은 변수 기준 경로여야 한다.
                    if not explicit:
                        raise ValueError(f"{event}: 게이트 경로는 $CLAUDE_PROJECT_DIR 기준이어야 합니다: {relative}")
                    # shlex 는 줄바꿈을 공백으로 보지만 셸은 명령 구분자로 본다 — 게이트가 인자 없이 끝나 버린다.
                    if "\n" in command or "\r" in command:
                        raise ValueError(f"{event}: 게이트 명령에 줄바꿈이 있습니다: {relative}")
                    if (event == "PreToolUse" and group.get("matcher") == GATES[relative]
                            and tokens == ["python3", token, "--hook"]):
                        registered.add(relative)

    missing = GATES.keys() - registered
    if missing:
        raise ValueError("PreToolUse 게이트 연결이 없거나 잘못되었습니다: " + ", ".join(sorted(missing)))


def check_harness(root):
    root = root.resolve()
    validate_settings(root)
    print("[통과] .claude/settings.json 구조 · 훅 경로 · 게이트 연결", flush=True)
    for script in GATES:
        result = subprocess.run(
            [sys.executable, str(root / script), "--selftest"],
            cwd=root, capture_output=True, text=True, timeout=30,
        )
        if result.returncode:
            raise ValueError(f"{script} --selftest 실패 ({result.returncode})\n{result.stdout}{result.stderr}")
        print(f"[통과] {script} --selftest", flush=True)


if __name__ == "__main__":
    try:
        check_harness(ROOT)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"[실패] {error}", file=sys.stderr)
        sys.exit(1)
