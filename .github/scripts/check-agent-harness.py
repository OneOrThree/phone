#!/usr/bin/env python3
"""추적 중인 Claude 설정과 PR/Jira 게이트를 외부 서비스 없이 검증한다."""

import json
from pathlib import Path
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


def validate_settings(root):
    """훅 명령은 실행하지 않고 설정 구조와 저장소 내부 참조를 확인한다."""
    root = root.resolve()
    settings = json.loads((root / ".claude/settings.json").read_text(encoding="utf-8"))
    if not isinstance(settings, dict) or not isinstance(settings.get("hooks"), dict):
        raise ValueError(".claude/settings.json: hooks 객체가 필요합니다")

    registered = set()
    for event, groups in settings["hooks"].items():
        if not isinstance(groups, list) or not groups:
            raise ValueError(f"{event}: 비어 있지 않은 훅 그룹 목록이 필요합니다")
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("matcher"), str):
                raise ValueError(f"{event}: matcher 문자열이 필요합니다")
            hooks = group.get("hooks")
            if not isinstance(hooks, list) or not hooks:
                raise ValueError(f"{event}: 비어 있지 않은 hooks 목록이 필요합니다")
            for hook in hooks:
                if not isinstance(hook, dict) or hook.get("type") != "command":
                    raise ValueError(f"{event}: 검증 가능한 command 훅이 필요합니다")
                command = hook.get("command")
                if not isinstance(command, str) or not command.strip():
                    raise ValueError(f"{event}: command 문자열이 필요합니다")
                lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
                lexer.whitespace_split = True
                tokens = list(lexer)
                for token in tokens:
                    for prefix in PROJECT_PREFIXES:
                        if not token.startswith(prefix):
                            continue
                        relative = token[len(prefix):]
                        target = (root / relative).resolve()
                        if not target.is_relative_to(root):
                            raise ValueError(f"{event}: 저장소 밖의 훅 경로입니다: {relative}")
                        if not target.is_file():
                            raise ValueError(f"{event}: 훅 파일이 없습니다: {relative}")
                        if (event == "PreToolUse" and group["matcher"] == GATES.get(relative)
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
