"""훅 참조 누락과 자체 테스트 실패가 하네스 검증을 통과하지 못하게 한다."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("agent_harness", Path(__file__).with_name("check-agent-harness.py"))
harness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harness)


GUARD = '[ -f "$CLAUDE_PROJECT_DIR/.claude/prod-impact.py" ] || exit 0; '


def hook_command(script):
    """등록 명령. 운영 영향 훅만 스크립트가 없으면 조용히 끝나는 존재 가드를 앞에 둔다."""
    run = f'python3 "$CLAUDE_PROJECT_DIR/{script}" --hook'
    return GUARD + run if script in harness.GUARD_REQUIRED else run


def hook_group(script, matcher):
    return {"matcher": matcher, "hooks": [{"type": "command", "command": hook_command(script)}]}


class AgentHarnessTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="agent harness ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / ".claude").mkdir()
        # 게이트(PreToolUse) 뒤에 운영 영향 훅 둘(PreToolUse·PostToolUse)과 운영 배포 확인 규칙이 기본으로 든다.
        self.prod_impact_post = hook_group(harness.PROD_IMPACT, "Edit|Write|MultiEdit|NotebookEdit")
        self.settings = {
            "hooks": {
                "PreToolUse": [
                    hook_group(script, matcher) for script, matcher in harness.GATES.items()
                ] + [hook_group(harness.PROD_IMPACT, "Bash")],
                "PostToolUse": [self.prod_impact_post],
            },
            "permissions": {"ask": list(harness.PROD_ASK_RULES)},
        }
        for script in harness.GUARDED:
            (self.root / script).write_text(
                'import sys\nassert sys.argv[1:] == ["--selftest"]\n', encoding="utf-8",
            )

    def write_settings(self):
        (self.root / ".claude/settings.json").write_text(json.dumps(self.settings), encoding="utf-8")

    def set_post_hooks(self, *groups):
        """필수 등록인 운영 영향 PostToolUse 훅은 남기고, 그 뒤에 시험용 PostToolUse 훅을 붙인다."""
        self.settings["hooks"]["PostToolUse"] = [self.prod_impact_post, *groups]

    def test_runs_selftests_without_executing_hook_commands(self):
        marker = self.root / "unexpected-hook-execution"
        self.set_post_hooks({
            "matcher": "Bash", "hooks": [{"type": "command", "command": f'touch "{marker}"'}],
        })
        self.write_settings()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            harness.check_harness(self.root)
        self.assertFalse(marker.exists())
        for script in harness.GUARDED:
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
        self.set_post_hooks({
            "matcher": "Bash", "hooks": [{
                "type": "command", "command": 'python3 "$CLAUDE_PROJECT_DIR/.claude/extra hook.py"',
            }],
        })
        self.write_settings()
        harness.validate_settings(self.root)

    def test_additional_missing_or_external_hook_target_is_rejected(self):
        for target in (".claude/missing.py", "../outside.py"):
            with self.subTest(target=target):
                self.set_post_hooks({
                    "matcher": "Bash", "hooks": [{
                        "type": "command", "command": f'python3 "$CLAUDE_PROJECT_DIR/{target}"',
                    }],
                })
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

    def test_gate_with_a_newline_in_its_command_is_rejected(self):
        self.settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = (
            'python3 "$CLAUDE_PROJECT_DIR/.claude/pr-gate.py"\n--hook'
        )
        self.write_settings()
        with self.assertRaisesRegex(ValueError, "줄바꿈"):
            harness.validate_settings(self.root)

    def test_gate_given_as_a_cwd_relative_path_is_rejected(self):
        self.settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"] = 'python3 ".claude/pr-gate.py" --hook'
        self.write_settings()
        with self.assertRaisesRegex(ValueError, "CLAUDE_PROJECT_DIR 기준"):
            harness.validate_settings(self.root)

    def test_matcherless_groups_and_non_command_hooks_are_allowed(self):
        self.settings["hooks"]["SessionStart"] = [{"hooks": [{"type": "command", "command": "echo 시작"}]}]
        self.settings["hooks"]["Stop"] = [{"matcher": "", "hooks": [{"type": "prompt", "prompt": "요약해"}]}]
        self.write_settings()
        harness.validate_settings(self.root)

    def test_prefixed_output_paths_and_cd_relative_scripts_are_not_false_rejects(self):
        for command in ('touch "$CLAUDE_PROJECT_DIR/.claude/state"', 'mkdir -p "$CLAUDE_PROJECT_DIR/.claude/tmp"',
                        'echo x > "$CLAUDE_PROJECT_DIR/.claude/log"', "cd server/data-api && ./gradlew test",
                        'bash -c "./gradlew build"', 'echo hi | python3 -c "print(1)"'):
            with self.subTest(command=command):
                self.set_post_hooks({
                    "matcher": "Bash", "hooks": [{"type": "command", "command": command}],
                })
                self.write_settings()
                harness.validate_settings(self.root)

    def test_prefixed_paths_outside_the_repo_are_rejected_in_any_position(self):
        self.set_post_hooks({
            "matcher": "Bash", "hooks": [{"type": "command", "command": 'touch "$CLAUDE_PROJECT_DIR/../outside"'}],
        })
        self.write_settings()
        with self.assertRaisesRegex(ValueError, "저장소 밖"):
            harness.validate_settings(self.root)

    def test_repo_paths_without_the_variable_prefix_are_checked_too(self):
        for command in ("python3 .claude/missing.py", "bash .github/scripts/missing.sh",
                        f'python3 "{self.root}/.claude/missing.py"',
                        "touch /tmp/x && python3 .claude/missing.py", "python3 -u .claude/missing.py",
                        "./scripts/missing.sh", "sleep 1 & python3 .claude/missing.py"):
            with self.subTest(command=command):
                self.set_post_hooks({
                    "matcher": "Bash", "hooks": [{"type": "command", "command": command}],
                })
                self.write_settings()
                with self.assertRaisesRegex(ValueError, "훅 파일이 없습니다"):
                    harness.validate_settings(self.root)

    def test_prod_impact_needs_both_registrations(self):
        """운영 영향 훅은 PreToolUse(Bash)와 PostToolUse(편집 도구) 둘 다 필요하다 — 하나만 지우거나 비틀어도 거절한다."""
        for mutation in ("remove_pre", "remove_post", "pre_matcher", "post_matcher", "post_moved_to_pre", "mode", "ignore_failure"):
            with self.subTest(mutation=mutation):
                settings = json.loads(json.dumps(self.settings))
                pre = settings["hooks"]["PreToolUse"]
                post = settings["hooks"]["PostToolUse"][0]
                if mutation == "remove_pre":
                    pre.pop()
                elif mutation == "remove_post":
                    del settings["hooks"]["PostToolUse"]
                elif mutation == "pre_matcher":
                    pre[-1]["matcher"] = "Read"
                elif mutation == "post_matcher":
                    post["matcher"] = "Edit|Write"
                elif mutation == "post_moved_to_pre":
                    pre.append(settings["hooks"].pop("PostToolUse")[0])
                elif mutation == "mode":
                    post["hooks"][0]["command"] = post["hooks"][0]["command"].replace("--hook", "--selftest")
                else:
                    pre[-1]["hooks"][0]["command"] += " || true"
                (self.root / ".claude/settings.json").write_text(json.dumps(settings), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "게이트 연결.*prod-impact"):
                    harness.validate_settings(self.root)

    def test_prod_impact_hooks_get_the_same_shape_checks_as_gates(self):
        path = "$CLAUDE_PROJECT_DIR/.claude/prod-impact.py"
        cases = (("async", "동기 실행"), ("unquoted", "큰따옴표"), ("unquoted_guard_only", "큰따옴표"),
                 ("cwd_relative", "CLAUDE_PROJECT_DIR 기준"), ("newline", "줄바꿈"))
        for event in ("PreToolUse", "PostToolUse"):
            for name, message in cases:
                with self.subTest(event=event, case=name):
                    settings = json.loads(json.dumps(self.settings))
                    hook = settings["hooks"][event][-1]["hooks"][0]     # 두 이벤트 모두 마지막 그룹이 운영 영향 훅이다
                    if name == "async":
                        hook["async"] = True
                    elif name == "unquoted":
                        hook["command"] = hook["command"].replace('"', "")
                    elif name == "unquoted_guard_only":     # 가드 경로만 인용이 없으면 공백 경로에서 `[` 가 죽어 훅이 조용히 빠진다
                        hook["command"] = hook["command"].replace(f'-f "{path}"', f"-f {path}")
                    elif name == "cwd_relative":
                        hook["command"] = hook["command"].replace(path, ".claude/prod-impact.py")
                    else:
                        hook["command"] = hook["command"].replace(" --hook", "\n--hook")
                    (self.root / ".claude/settings.json").write_text(json.dumps(settings), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, message):
                        harness.validate_settings(self.root)

    def test_prod_impact_existence_guard_shape_is_accepted(self):
        """스크립트가 없으면 조용히 끝나는 가드 모양은 두 이벤트 모두 통과한다 — 중괄호 변수 표기도 된다."""
        self.write_settings()
        harness.validate_settings(self.root)
        braced = json.loads(json.dumps(self.settings))
        for group in (braced["hooks"]["PreToolUse"][-1], braced["hooks"]["PostToolUse"][0]):
            command = group["hooks"][0]["command"]
            self.assertTrue(command.startswith('[ -f "$CLAUDE_PROJECT_DIR/.claude/prod-impact.py" ] || exit 0; python3 '))
            group["hooks"][0]["command"] = command.replace("$CLAUDE_PROJECT_DIR", "${CLAUDE_PROJECT_DIR}")
        (self.root / ".claude/settings.json").write_text(json.dumps(braced), encoding="utf-8")
        harness.validate_settings(self.root)

    def test_prod_impact_registration_without_the_guard_is_rejected(self):
        """가드를 빼면 파일 없는 체크아웃에서 python 이 exit 2 로 모든 Bash 를 막는다 — 가드 없는 모양은 등록으로 치지 않는다."""
        path = '"$CLAUDE_PROJECT_DIR/.claude/prod-impact.py"'
        run = f"python3 {path} --hook"
        variants = {
            "가드 없음": run,
            "&& 로 이음": f"[ -f {path} ] && {run}",
            "-e 로 검사": f"[ -e {path} ] || exit 0; {run}",
            "exit 1": f"[ -f {path} ] || exit 1; {run}",
            "실패 무시를 덧붙임": f"[ -f {path} ] || exit 0; {run} || true",
            "가드가 뒤": f"{run}; [ -f {path} ] || exit 0",
        }
        for event in ("PreToolUse", "PostToolUse"):
            for name, command in variants.items():
                with self.subTest(event=event, variant=name):
                    settings = json.loads(json.dumps(self.settings))
                    settings["hooks"][event][-1]["hooks"][0]["command"] = command
                    (self.root / ".claude/settings.json").write_text(json.dumps(settings), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "게이트 연결.*prod-impact"):
                        harness.validate_settings(self.root)

    def test_prod_impact_guard_must_check_the_file_it_runs(self):
        """가드가 다른 파일을 보면 prod-impact.py 가 없을 때도 가드가 통과해 python 이 죽는다 — 같은 파일이어야 한다."""
        run = 'python3 "$CLAUDE_PROJECT_DIR/.claude/prod-impact.py" --hook'
        for other in (".claude/pr-gate.py", ".claude/missing.py"):
            for event in ("PreToolUse", "PostToolUse"):
                with self.subTest(event=event, guard_file=other):
                    settings = json.loads(json.dumps(self.settings))
                    settings["hooks"][event][-1]["hooks"][0]["command"] = f'[ -f "$CLAUDE_PROJECT_DIR/{other}" ] || exit 0; {run}'
                    (self.root / ".claude/settings.json").write_text(json.dumps(settings), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "게이트 연결.*prod-impact"):
                        harness.validate_settings(self.root)

    def test_every_prod_ask_rule_is_required(self):
        self.assertGreaterEqual(len(harness.PROD_ASK_RULES), 4)
        for rule in harness.PROD_ASK_RULES:
            with self.subTest(removed=rule):
                self.settings["permissions"]["ask"] = [r for r in harness.PROD_ASK_RULES if r != rule]
                self.write_settings()
                with self.assertRaisesRegex(ValueError, "permissions.ask.*" + re.escape(rule)):
                    harness.validate_settings(self.root)
        for permissions in ({}, {"ask": []}, {"ask": "Bash(gh workflow run *prod*)"}, {"allow": list(harness.PROD_ASK_RULES)}, None):
            with self.subTest(permissions=permissions):
                settings = json.loads(json.dumps(self.settings))
                settings["permissions"] = permissions
                (self.root / ".claude/settings.json").write_text(json.dumps(settings), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "permissions.ask"):
                    harness.validate_settings(self.root)

    def test_core_ask_rules_stay_in_the_contract(self):
        for rule in ("Bash(gh workflow run *prod*)", "Bash(gh workflow run *Catus*)", "Bash(gh workflow run *android-cd*)",
                     "Bash(gh workflow run *Android CD*)",
                     "Bash(gh api *dispatches*)", "Bash(gh api *pending_deployments*)"):
            self.assertIn(rule, harness.PROD_ASK_RULES)

    def test_prod_impact_selftest_failure_is_reported_with_diagnostics(self):
        self.write_settings()
        (self.root / harness.PROD_IMPACT).write_text(
            'import sys\nprint("운영 규칙 회귀", file=sys.stderr)\nsys.exit(4)\n', encoding="utf-8",
        )
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(
                ValueError, "(?s)prod-impact.py --selftest 실패.*운영 규칙 회귀"):
            harness.check_harness(self.root)

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
