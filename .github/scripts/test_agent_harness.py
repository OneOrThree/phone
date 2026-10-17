"""훅 참조 누락과 자체 테스트 실패가 하네스 검증을 통과하지 못하게 한다."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("agent_harness", Path(__file__).with_name("check-agent-harness.py"))
harness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harness)


class AgentHarnessTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="agent harness ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / ".claude").mkdir()
        self.settings = {
            "hooks": {
                "PreToolUse": [
                    {"matcher": matcher, "hooks": [{
                        "type": "command",
                        "command": f'python3 "$CLAUDE_PROJECT_DIR/{script}" --hook',
                    }]}
                    for script, matcher in harness.GATES.items()
                ],
            },
        }
        for script in harness.GATES:
            (self.root / script).write_text(
                'import sys\nassert sys.argv[1:] == ["--selftest"]\n', encoding="utf-8",
            )

    def write_settings(self):
        (self.root / ".claude/settings.json").write_text(json.dumps(self.settings), encoding="utf-8")

    def test_runs_selftests_without_executing_hook_commands(self):
        marker = self.root / "unexpected-hook-execution"
        self.settings["hooks"]["PostToolUse"] = [{
            "matcher": "Bash", "hooks": [{"type": "command", "command": f'touch "{marker}"'}],
        }]
        self.write_settings()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            harness.check_harness(self.root)
        self.assertFalse(marker.exists())
        for script in harness.GATES:
            self.assertIn(f"[통과] {script} --selftest", output.getvalue())

    def test_selftest_failure_is_reported_with_diagnostics(self):
        self.write_settings()
        (self.root / ".claude/pr-gate.py").write_text(
            'import sys\nprint("회귀 발견", file=sys.stderr)\nsys.exit(3)\n', encoding="utf-8",
        )
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "회귀 발견"):
            harness.check_harness(self.root)

    def test_missing_script_is_rejected_before_running_selftests(self):
        self.write_settings()
        (self.root / ".claude/jira_gate.py").unlink()
        with self.assertRaisesRegex(ValueError, "훅 파일이 없습니다"):
            harness.validate_settings(self.root)

    def test_removed_or_miswired_gate_is_rejected(self):
        for mutation in ("remove", "matcher", "event", "mode", "echo", "extra_mode", "ignore_failure"):
            with self.subTest(mutation=mutation):
                settings = json.loads(json.dumps(self.settings))
                group = settings["hooks"]["PreToolUse"][0]
                if mutation == "remove":
                    settings["hooks"]["PreToolUse"].pop(0)
                elif mutation == "matcher":
                    group["matcher"] = "Read"
                elif mutation == "event":
                    settings["hooks"]["PostToolUse"] = [settings["hooks"]["PreToolUse"].pop(0)]
                elif mutation == "mode":
                    group["hooks"][0]["command"] = group["hooks"][0]["command"].replace("--hook", "--selftest")
                elif mutation == "echo":
                    group["hooks"][0]["command"] = "echo " + group["hooks"][0]["command"]
                elif mutation == "extra_mode":
                    group["hooks"][0]["command"] += " --selftest"
                else:
                    group["hooks"][0]["command"] += " || true"
                (self.root / ".claude/settings.json").write_text(json.dumps(settings), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "게이트 연결"):
                    harness.validate_settings(self.root)

    def test_braced_project_directory_and_quoted_paths_are_supported(self):
        self.settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = (
            'python3 "${CLAUDE_PROJECT_DIR}/.claude/pr-gate.py" --hook'
        )
        extra = self.root / ".claude/extra hook.py"
        extra.write_text("", encoding="utf-8")
        self.settings["hooks"]["PostToolUse"] = [{
            "matcher": "Bash", "hooks": [{
                "type": "command", "command": 'python3 "$CLAUDE_PROJECT_DIR/.claude/extra hook.py"',
            }],
        }]
        self.write_settings()
        harness.validate_settings(self.root)

    def test_additional_missing_or_external_hook_target_is_rejected(self):
        for target in (".claude/missing.py", "../outside.py"):
            with self.subTest(target=target):
                self.settings["hooks"]["PostToolUse"] = [{
                    "matcher": "Bash", "hooks": [{
                        "type": "command", "command": f'python3 "$CLAUDE_PROJECT_DIR/{target}"',
                    }],
                }]
                self.write_settings()
                with self.assertRaisesRegex(ValueError, "훅 파일이 없습니다|저장소 밖"):
                    harness.validate_settings(self.root)

    def test_disable_all_hooks_is_rejected_even_with_valid_gates(self):
        self.settings["disableAllHooks"] = True
        self.write_settings()
        with self.assertRaisesRegex(ValueError, "disableAllHooks"):
            harness.validate_settings(self.root)

    def test_quoted_or_escaped_variable_that_the_shell_would_not_expand_is_rejected(self):
        for command in ("python3 '$CLAUDE_PROJECT_DIR/.claude/pr-gate.py' --hook",
                        "python3 '${CLAUDE_PROJECT_DIR}/.claude/pr-gate.py' --hook",
                        'python3 "\\$CLAUDE_PROJECT_DIR/.claude/pr-gate.py" --hook',
                        "python3 \\$CLAUDE_PROJECT_DIR/.claude/pr-gate.py --hook"):
            with self.subTest(command=command):
                self.settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = command
                self.write_settings()
                with self.assertRaisesRegex(ValueError, "확장이 인용·이스케이프로 막혀"):
                    harness.validate_settings(self.root)

    def test_async_gate_is_rejected_because_it_cannot_block(self):
        self.settings["hooks"]["PreToolUse"][0]["hooks"][0]["async"] = True
        self.write_settings()
        with self.assertRaisesRegex(ValueError, "동기 실행"):
            harness.validate_settings(self.root)

    def test_unquoted_gate_path_is_rejected(self):
        self.settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = (
            "python3 $CLAUDE_PROJECT_DIR/.claude/pr-gate.py --hook"
        )
        self.write_settings()
        with self.assertRaisesRegex(ValueError, "큰따옴표"):
            harness.validate_settings(self.root)

    def test_repo_paths_without_the_variable_prefix_are_checked_too(self):
        for command in ("python3 .claude/missing.py", "bash .github/scripts/missing.sh",
                        f'python3 "{self.root}/.claude/missing.py"'):
            with self.subTest(command=command):
                self.settings["hooks"]["PostToolUse"] = [{
                    "matcher": "Bash", "hooks": [{"type": "command", "command": command}],
                }]
                self.write_settings()
                with self.assertRaisesRegex(ValueError, "훅 파일이 없습니다"):
                    harness.validate_settings(self.root)

    def test_invalid_json_and_hook_structures_fail(self):
        for content in ("{", "[]", "{}", '{"hooks": []}', '{"hooks": {"PreToolUse": []}}',
                        '{"hooks": {"PreToolUse": [null]}}',
                        '{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": []}]}}'):
            with self.subTest(content=content):
                (self.root / ".claude/settings.json").write_text(content, encoding="utf-8")
                with self.assertRaises(ValueError):
                    harness.validate_settings(self.root)


if __name__ == "__main__":
    unittest.main()
