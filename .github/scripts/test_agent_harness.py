"""훅 참조 누락·자체 테스트 실패·문서 센서 여섯 개의 위반이 하네스 검증을 통과하지 못하게 한다."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("agent_harness", Path(__file__).with_name("check-agent-harness.py"))
harness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harness)


GUARD = '[ -f "$CLAUDE_PROJECT_DIR/.claude/prod-impact.py" ] || exit 0; '

# ── 문서 센서용 임시 저장소 ────────────────────────────────────────────────────────────────────
# 센서는 `git ls-files` 의 추적 파일만 본다. 그래서 임시 트리마다 `git init` + `git add -A`(커밋은 필요 없다)를 한다.
CONTEXT = """# Cattus

**Cattus**:
이 제품의 이름이다.
_Avoid_: Catus, GroMo, Gromo, 같이숲(모두 2.0 제품을 가리킬 때)

**Gromo 1.x**:
2.0 전의 동결된 앱이다.

**섬**:
함께 집중하는 공간이다.
_Avoid_: 그룹(옛 이름)

**마을회관**:
섬의 첫 건물이다.
_Avoid_: 회관(PRD·DB 표시명)

**서버 4종**:
네 서버를 함께 부르는 말이다.
_Avoid_: 앱, 앱 4종(서버 묶음을 가리킬 때)

**운영 V2**:
지금의 운영 환경이다.
_Avoid_: prod, 운영(단독으로 쓰면 운영 V1과 섞인다)

**Business API**:
공개 HTTP API 서버다.
_Avoid_: BFF(화면 묶음 응답만 가리킨다), satellite·위성(문서마다 가리키는 서버가 다르다)

**Notification**:
푸시 알림을 보내는 서버다.
_Avoid_: satellite·위성(문서마다 가리키는 서버가 다르다), 알림 위성

**물고기**:
유일한 재화다.
_Avoid_: 코인, 재화(물고기를 가리킬 때), 마을 포인트

**파이프라인 V1 · V2**:
CI/CD 세대 이름이다.
_Avoid_: 단독 「V2」(파이프라인 세대·제품 2.0·Flyway V2·호스트 이름이 섞인다)
"""
MAP = """# 파이프라인 지도

## 2. 워크플로

### 2-1 살아 있는 워크플로

| 파일 | 목적 |
| --- | --- |
| [a-ci.yml](../../.github/workflows/a-ci.yml) | 검사 |

### 2-2 V1 워크플로와 V2 대응

| V1 파일 | V2 대응 |
| --- | --- |
| [old-ci.yml](../../.github/workflows/old-ci.yml) | a-ci.yml |

### 2-3 GitHub에 등록됐지만 파일이 없는 워크플로

- `ghost-ci.yml`: 07-01 에 등록됐다.

## 3. 환경
"""


def skill_text(name, description="쓸 때를 적는다.", extra=""):
    return f"---\nname: {name}\ndescription: {description}\n{extra}---\n\n# {name}\n"


BASE_FILES = {
    "CLAUDE.md": "# CLAUDE.md\n\nRules. Words: [CONTEXT.md](CONTEXT.md).\n",
    "AGENTS.md": "# AGENTS.md\n\n작업 전에 `CLAUDE.md` 를 읽는다.\n",
    "README.md": "# README\n",
    "CONTEXT.md": CONTEXT,
    "backoffice/AGENTS.md": "# 백오피스\n\n루트 규칙에 더한다.\n",
    "docs/README.md": "# docs\n",
    "docs/engineering/pipeline-map.md": MAP,
    ".github/workflows/a-ci.yml": "name: A\n",
    ".github/workflows/old-ci.yml": "# RETIRED: a-ci.yml 이 대신한다\nname: Old\n",
    ".claude/skills/pr-loop/SKILL.md": skill_text("pr-loop"),
    ".claude/skills/prod-release/SKILL.md": skill_text("prod-release", extra="disable-model-invocation: true\n"),
}


def make_repo(test, files=None, remove=(), untracked=None, gitignore=None):
    """BASE_FILES 에 files 를 덮어쓰고 remove 를 뺀 임시 저장소. untracked 는 `git add` 뒤에 만든다(추적되지 않는 파일)."""
    temporary = tempfile.TemporaryDirectory(prefix="agent harness docs ")
    test.addCleanup(temporary.cleanup)
    root = Path(temporary.name)
    merged = {**BASE_FILES, **(files or {})}
    if gitignore:
        merged[".gitignore"] = gitignore
    for name in remove:
        del merged[name]
    init_repo(root, merged)
    write_files(root, untracked or {})
    return root


def init_repo(root, files):
    write_files(root, files)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)


def write_files(root, files):
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


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
        init_repo(self.root, BASE_FILES)      # 셀프테스트 뒤에 도는 문서 센서 여섯 개가 볼 유효한 트리
        with contextlib.redirect_stdout(io.StringIO()) as output:
            harness.check_harness(self.root)
        self.assertFalse(marker.exists())
        for script in harness.GUARDED:
            self.assertIn(f"[통과] {script} --selftest", output.getvalue())
        for name, _ in harness.SENSORS:
            self.assertIn(f"[통과] {name} — ", output.getvalue())

    def test_every_failing_sensor_is_reported_in_one_error_while_the_others_still_pass(self):
        self.write_settings()
        init_repo(self.root, {**BASE_FILES, "CLAUDE.md": "가" * 5000, ".github/workflows/new-cd.yml": "name: N\n"})
        with contextlib.redirect_stdout(io.StringIO()) as output, self.assertRaises(ValueError) as caught:
            harness.check_harness(self.root)
        message = str(caught.exception)
        self.assertIn("루트 CLAUDE.md", message)                    # 검사 5
        self.assertIn("pipeline-map.md 에 없는 활성 워크플로", message)   # 검사 3
        self.assertIn("[통과] 스킬 머리말 — ", output.getvalue())          # 나머지 검사는 끝까지 돈다

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


class DocumentSensorTest(unittest.TestCase):
    """문서 센서 여섯 개 — 일부러 깨뜨린 임시 저장소는 모든 위반을 한 번에 내고, 깨끗한 저장소는 통과한다."""

    def assert_violations(self, check, root, pattern, count):
        with self.assertRaisesRegex(ValueError, pattern) as caught:
            check(root)
        self.assertIn(f"위반 {count}건", str(caught.exception))
        return str(caught.exception)

    def test_base_tree_passes_every_sensor(self):
        root = make_repo(self)
        for name, sensor in harness.SENSORS:
            with self.subTest(sensor=name):
                sensor(root)

    # ── 1 문서 경로 실재 ────────────────────────────────────────────────────────────────────
    def test_valid_links_and_paths_pass_and_placeholders_fences_are_skipped(self):
        files = {
            "docs/README.md": "\n".join([
                "# docs",
                "[ok](engineering/pipeline-map.md) [앵커](engineering/pipeline-map.md#2-워크플로) [쿼리](../README.md?plain=1)",
                "[web](https://example.com/x.md) [mail](mailto:a@b.c) [위](#위) [빈 링크]()",
                "`docs/engineering/pipeline-map.md` `docs/engineering/` `docs/engineering/pipeline-map.md:12` `docs/engineering/pipeline-map.md:3-9`",
                "`docs/engineering/pipeline-map.md#2-워크플로` `docs/local/note.md` `.github/workflows/a-ci.yml`",
                "`docs/<서비스>/x.md` `docs/*.md` `docs/{a,b}.md` `docs/$X/y` `docs/…/z` `docs/a/.../b` `docs/a b/c`",
                "`CLAUDE.md` `package.json` `./docs/none.md` `/docs/none.md` `https://e.com/docs/x` `prod-V2/app.json`",
                "```",
                "[깨짐](nowhere.md) `docs/none.md`",
                "```",
                "`[깨짐](nowhere.md)`",
            ]),
            "server/data-api/README.md": "`docs/db/schema.dbml` 은 서비스 폴더 기준 줄임 표기다.\n",
            "server/data-api/docs/db/schema.dbml": "Table a {}\n",
        }
        root = make_repo(self, files, gitignore="docs/local/\n")
        summary = harness.check_document_paths(root)
        self.assertIn("링크 6개", summary)          # 이 문서 3개 + CLAUDE.md 1개 + 지도 2개. https·mailto·#앵커·빈 링크는 세지 않는다
        self.assertIn("백틱 경로 8개", summary)

    def test_every_broken_link_and_path_is_reported_in_one_error(self):
        files = {"docs/README.md": "[a](nowhere.md)\n[b](../none/)\n`docs/ghost.md` 와 `.github/gone/x.yml:7`\n[밖](../../outside.md)\n"}
        message = self.assert_violations(harness.check_document_paths, make_repo(self, files), "문서 경로", 5)
        for needle in ("docs/README.md:1: 링크 대상이 없다: nowhere.md", "docs/README.md:2: 링크 대상이 없다: ../none/",
                       "docs/README.md:3: 경로가 없다: docs/ghost.md", "docs/README.md:3: 경로가 없다: .github/gone/x.yml",
                       "docs/README.md:4: 링크 대상이 없다: ../../outside.md"):
            self.assertIn(needle, message)

    def test_untracked_file_does_not_count_but_a_folder_with_tracked_files_does(self):
        root = make_repo(self, {"docs/README.md": "[x](notes.md)\n`docs/engineering/`\n"}, untracked={"docs/notes.md": "x"})
        message = self.assert_violations(harness.check_document_paths, root, "문서 경로", 1)
        self.assertIn("notes.md", message)

    def test_legacy_app_docs_are_out_of_scope_but_other_app_docs_are_checked(self):
        files = {"app/legacy/app-dev/CLAUDE.md": "[x](gone.md)\n", "app/app-dev/CLAUDE.md": "[x](gone.md)\n"}
        message = self.assert_violations(harness.check_document_paths, make_repo(self, files), "문서 경로", 1)
        self.assertIn("app/app-dev/CLAUDE.md:1", message)

    @patch.dict(harness.STALE_IN_SERVER_DOCS, {("경로", "server/observability/README.md"): ("docs/stale.md",)}, clear=True)
    def test_known_stale_server_paths_are_excused_only_for_that_doc_and_token(self):
        (_, doc), tokens = next(item for item in harness.STALE_IN_SERVER_DOCS.items() if item[0][0] == "경로")
        files = {doc: "".join(f"`{token}`\n" for token in tokens), "scripts/x.sh": "", "docs/README.md": "# docs\n"}
        self.assertIn(f"낡은 경로 {len(tokens)}건", harness.check_document_paths(make_repo(self, files)))
        elsewhere = {**files, "docs/engineering/other.md": f"`{tokens[0]}`\n"}
        self.assert_violations(harness.check_document_paths, make_repo(self, elsewhere), "경로가 없다: " + re.escape(tokens[0]), 1)
        extra = {**files, doc: files[doc] + "`docs/zzz-gone.md`\n"}
        self.assert_violations(harness.check_document_paths, make_repo(self, extra), "docs/zzz-gone.md", 1)

    # ── 2 워크플로 언급 ─────────────────────────────────────────────────────────────────────
    def test_removed_workflow_requires_inventory_and_historical_marker(self):
        inventory = "# 지도\n\n## 2-2 V1 워크플로와 V2 대응\n| V1 파일 | 상태 | 대체 |\n| --- | --- | --- |\n| `removed-ci.yml` | 제거됨 | `a-ci.yml` |\n\n## 2-3 GitHub에 등록됐지만 파일이 없는 워크플로\n"
        root = make_repo(self, {harness.PIPELINE_MAP: inventory, "CLAUDE.md": "# C\n옛 `removed-ci.yml`은 제거했다.\n"})
        harness.check_workflow_mentions(root)
        (root / "CLAUDE.md").write_text("# C\n`removed-ci.yml`을 실행한다.\n")
        self.assert_violations(harness.check_workflow_mentions, root, "removed-ci.yml", 1)
        (root / "CLAUDE.md").write_text("# C\n옛 `typo-ci.yml`은 제거했다.\n")
        self.assert_violations(harness.check_workflow_mentions, root, "typo-ci.yml", 1)

    def test_retired_workflow_needs_a_marker_unless_it_is_in_the_v1_section(self):
        for word in ("RETIRED", "retired", "V1", "은퇴", "꺼진", "꺼져", "옛", "legacy", "disabled"):
            with self.subTest(marker=word):
                root = make_repo(self, {"CLAUDE.md": f"# C\n\n{word} 라서 `old-ci.yml` 은 못 쓴다.\n"})
                self.assertIn("표시만으로 통과한 줄 1개", harness.check_workflow_mentions(root))
        message = self.assert_violations(
            harness.check_workflow_mentions, make_repo(self, {"CLAUDE.md": "# C\n\n`old-ci.yml` 을 돌린다.\n"}),
            "은퇴한 워크플로 old-ci.yml", 1)
        self.assertIn("CLAUDE.md:3", message)

    def test_marker_must_be_outside_the_workflow_name_itself(self):
        files = {".github/workflows/legacy-ci.yml": "# RETIRED: a-ci.yml 이 대신한다\n", "CLAUDE.md": "# C\n\n`legacy-ci.yml` 을 돌린다.\n"}
        self.assert_violations(harness.check_workflow_mentions, make_repo(self, files), "legacy-ci.yml", 1)

    def test_v1_section_excuses_retired_names_but_only_until_the_next_same_level_heading(self):
        self.assertIn("표시만으로 통과한 줄 0개", harness.check_workflow_mentions(make_repo(self)))     # 기본 지도의 2-2 표
        tail = MAP + "\n`old-ci.yml` 을 3절에서 또 언급한다.\n"
        message = self.assert_violations(harness.check_workflow_mentions,
                                         make_repo(self, {harness.PIPELINE_MAP: tail}), "old-ci.yml", 1)
        self.assertIn(f"{harness.PIPELINE_MAP}:{tail.count(chr(10))}", message)

    def test_missing_workflow_path_and_unknown_workflow_names_fail_once_each(self):
        text = "\n".join([
            "# C",
            "`.github/workflows/a-ci.yml` 는 있다.",
            "`.github/workflows/zzz-ci.yml` 는 없다.",                   # 경로 꼴 — 이름꼴이 같아도 한 번만
            "`ghost-cd.dev-v2.yml` 는 이름꼴이 같은데 저장소에 없다.",
            "`settings.yml` 은 이름꼴이 달라 보지 않는다.",
            "`server/scripts/docker-compose.dev.yml` 은 다른 폴더에 있는 같은 이름의 추적 파일이다.",
            "[x](../.github/workflows/gone.yml)",
            "`ghost-ci.yml` 은 지도의 2-3 절에서만 봐준다.",
        ])
        files = {"CLAUDE.md": text, "server/scripts/docker-compose.dev.yml": "services: {}\n"}
        message = self.assert_violations(harness.check_workflow_mentions, make_repo(self, files), "워크플로 언급", 4)
        for needle in ("CLAUDE.md:3: 워크플로 파일이 없다: .github/workflows/zzz-ci.yml",
                       "CLAUDE.md:4: 저장소에 없는 워크플로 이름이다: ghost-cd.dev-v2.yml",
                       "CLAUDE.md:7: 워크플로 파일이 없다: .github/workflows/gone.yml",
                       "CLAUDE.md:8: 저장소에 없는 워크플로 이름이다: ghost-ci.yml"):
            self.assertIn(needle, message)

    def test_workflow_name_shape_is_pinned(self):
        for stem in ("data-api-ci.dev-v2", "prod-cd-V2", "kafka-cd.prod-V2", "cd-auto.dev-v2", "ops-smoke.dev-v2", "ops-x",
                     "satellite-ci.prod", "link-handoff-ci", "docker-compose.dev", "x.prod", "foo-ci-bar"):
            with self.subTest(shaped=stem):
                self.assertTrue(harness.WORKFLOW_SHAPE.search(stem))
        for stem in ("compose-V2", "settings", "application-dev", "docker-compose", "ci", "claude-review", "foo-ci2",
                     "env-writer-V2", "README-V2", "smoke-check"):
            with self.subTest(plain=stem):
                self.assertFalse(harness.WORKFLOW_SHAPE.search(stem))

    @patch.dict(harness.STALE_IN_SERVER_DOCS, {("은퇴", "server/observability/README.md"): ("old-ci.yml",)}, clear=True)
    def test_known_stale_server_workflow_mentions_are_excused_only_for_that_doc_and_name(self):
        (_, doc), names = next(item for item in harness.STALE_IN_SERVER_DOCS.items() if item[0][0] == "은퇴")
        retired = {f".github/workflows/{name}": "# RETIRED: 대체\n" for name in names}
        files = {**retired, doc: "".join(f"`{name}` 을 쓴다.\n" for name in names)}
        self.assertIn(f"낡은 언급 {len(names)}건", harness.check_workflow_mentions(make_repo(self, files)))
        elsewhere = {**files, "docs/engineering/other.md": f"`{names[0]}` 을 쓴다.\n"}
        self.assert_violations(harness.check_workflow_mentions, make_repo(self, elsewhere), re.escape(names[0]), 1)

    def test_unfenced_keeps_line_numbers_and_handles_both_fence_styles(self):
        text = "a\n```sh\nb\n```\nc\n~~~~\nd\n~~~\ne\n~~~~\nf"
        self.assertEqual(harness.unfenced(text), ["a", "", "", "", "c", "", "", "", "", "", "f"])

    def test_section_range_ends_at_the_next_heading_of_the_same_or_higher_level(self):
        lines = ["# A", "## 2-2 x", "text", "### sub", "more", "## next", "tail"]
        self.assertEqual(list(harness.section_range(lines, "2-2 x")), [1, 2, 3, 4])
        self.assertEqual(list(harness.section_range(lines, "없는 절")), [])

    # ── 3 파이프라인 지도 포함 ─────────────────────────────────────────────────────────────
    def test_new_workflow_must_be_in_the_pipeline_map(self):
        files = {".github/workflows/new-cd.yml": "name: New\n", ".github/workflows/b.yaml": "name: B\n"}
        message = self.assert_violations(harness.check_pipeline_map_coverage, make_repo(self, files),
                                         "pipeline-map.md 에 없는 활성 워크플로", 2)
        self.assertIn(".github/workflows/new-cd.yml", message)
        self.assertIn(".github/workflows/b.yaml", message)
        mapped = {**files, harness.PIPELINE_MAP: MAP + "\n새 워크플로: new-cd.yml, b.yaml\n"}
        self.assertIn("활성 워크플로 3개", harness.check_pipeline_map_coverage(make_repo(self, mapped)))
        retired = {".github/workflows/new-cd.yml": "# RETIRED: a-ci.yml 이 대신한다\n"}
        self.assertIn("활성 워크플로 1개", harness.check_pipeline_map_coverage(make_repo(self, retired)))

    def test_pipeline_map_match_is_by_whole_file_name(self):
        shifted = MAP.replace("a-ci.yml", "data-a-ci.yml")
        message = self.assert_violations(harness.check_pipeline_map_coverage,
                                         make_repo(self, {harness.PIPELINE_MAP: shifted}), "활성 워크플로", 1)
        self.assertIn(".github/workflows/a-ci.yml", message)

    def test_missing_pipeline_map_fails(self):
        root = make_repo(self, remove=(harness.PIPELINE_MAP,))
        with self.assertRaisesRegex(ValueError, "pipeline-map.md 가 추적되지 않는다"):
            harness.check_pipeline_map_coverage(root)

    # ── 4 스킬 머리말 ────────────────────────────────────────────────────────────────────────
    def test_valid_front_matter_shapes_pass(self):
        files = {
            ".claude/skills/block/SKILL.md": "---\nname: block\ndescription: >\n  첫 줄\n  둘째 줄\n---\n",
            ".claude/skills/pipe/SKILL.md": "---\nname: \"pipe\"\ndescription: |-\n  글\n---\n",
            ".claude/skills/app-release/SKILL.md": skill_text("app-release", extra="disable-model-invocation: 'true'\n"),
            ".claude/skills/colon/SKILL.md": "---\nname: colon\ndescription: 콜론: 이 든 설명이다\nallowed-tools: Bash\n---\n",
        }
        self.assertIn("스킬 6개", harness.check_skill_front_matter(make_repo(self, files)))
        self.assertEqual(harness.front_matter(files[".claude/skills/block/SKILL.md"]),
                         {"name": "block", "description": "첫 줄 둘째 줄"})
        self.assertIsNone(harness.front_matter("# 머리말 없음\n"))
        self.assertIsNone(harness.front_matter("---\nname: x\n"))          # 닫는 --- 가 없다

    def test_bad_front_matter_is_reported_together(self):
        files = {
            ".claude/skills/none/SKILL.md": "# 머리말 없음\n",
            ".claude/skills/wrong/SKILL.md": skill_text("other"),
            ".claude/skills/blank/SKILL.md": "---\nname: blank\ndescription:\n---\n",
            ".claude/skills/folded/SKILL.md": "---\nname: folded\ndescription: >\n---\n",
            ".claude/skills/noname/SKILL.md": "---\ndescription: x\n---\n",
            ".claude/skills/prod-release/SKILL.md": skill_text("prod-release"),
            ".claude/skills/app-release/SKILL.md": skill_text("app-release", extra="disable-model-invocation: false\n"),
        }
        message = self.assert_violations(harness.check_skill_front_matter, make_repo(self, files), "스킬 머리말", 7)
        for needle in ("none/SKILL.md: 맨 앞에 --- 머리말이 없다", "wrong/SKILL.md: name 은 폴더 이름 «wrong»",
                       "blank/SKILL.md: description 이 비어 있다", "folded/SKILL.md: description 이 비어 있다",
                       "noname/SKILL.md: name 은 폴더 이름 «noname»", "prod-release/SKILL.md: 운영을 바꾸는 스킬",
                       "app-release/SKILL.md: 운영을 바꾸는 스킬"):
            self.assertIn(needle, message)

    # ── 5 루트 CLAUDE.md 크기 ────────────────────────────────────────────────────────────────
    def test_claude_md_limit_is_counted_in_bytes(self):
        at_limit = "가" * (harness.CLAUDE_MD_MAX_BYTES // 3)      # 한 글자 3바이트
        self.assertEqual(len(at_limit.encode("utf-8")), harness.CLAUDE_MD_MAX_BYTES)
        self.assertIn("12288바이트", harness.check_claude_md_size(make_repo(self, {"CLAUDE.md": at_limit})))
        over = at_limit + "a"
        self.assertLess(len(over), harness.CLAUDE_MD_MAX_BYTES)       # 글자 수로는 한참 모자라도
        with self.assertRaisesRegex(ValueError, "12289바이트로 상한 12288바이트를 넘는다"):
            harness.check_claude_md_size(make_repo(self, {"CLAUDE.md": over}))

    def test_missing_claude_md_fails(self):
        with self.assertRaisesRegex(ValueError, "CLAUDE.md 가 없다"):
            harness.check_claude_md_size(make_repo(self, remove=("CLAUDE.md",)))

    # ── 6 용어집 금지어 ──────────────────────────────────────────────────────────────────────
    def test_avoid_entries_are_read_from_context(self):
        terms, checked, skipped = harness.glossary_terms(CONTEXT)
        owner = dict(checked)
        self.assertEqual((owner["Catus"], owner["같이숲"], owner["그룹"]), ("Cattus", "Cattus", "섬"))   # «모두» 줄은 전부 검사한다
        for word in ("BFF", "satellite", "위성", "회관", "코인"):                  # `satellite·위성` 은 둘로 가른다
            self.assertIn(word, owner)
        # 조건부(«때»·«단독») 항목은 낱말 일치로 판정할 수 없어 건너뛴다. 마지막 항목의 괄호는 앞 항목에도 걸린다.
        self.assertEqual(sorted(skipped), sorted(["앱", "앱 4종", "prod", "운영", "재화", "단독 「V2」"]))
        for term in ("Gromo 1.x", "마을회관", "파이프라인 V1", "V2"):
            self.assertIn(term, terms)

    def test_avoid_words_in_code_links_urls_and_longer_canonical_terms_pass(self):
        prose = "\n".join([
            "# CLAUDE.md",
            "코드는 `Catus` 와 `그룹` 을 쓴다. [목록](docs/그룹.md) https://catus.example/그룹",
            "```",
            "Catus 그룹 코인",
            "```",
            "Gromo 1.x 는 동결됐다. 마을회관 이 첫 건물이다.",
            "앱 4종과 운영 서버와 dev 와 prod 와 재화 와 단독 V2 는 조건부라 건너뛴다.",
            "catus-api 는 소문자라 다르다. Catuses 와 xCatus 는 낱말이 아니다.",
        ])
        summary = harness.check_glossary_avoid(make_repo(self, {"CLAUDE.md": prose}))
        self.assertIn("조건부라 건너뛴 것 6개", summary)

    def test_avoid_words_in_prose_fail_in_every_target_document(self):
        for path in ("CLAUDE.md", "AGENTS.md", "backoffice/AGENTS.md", ".claude/skills/pr-loop/SKILL.md"):
            with self.subTest(path=path):
                root = make_repo(self, {path: skill_text("pr-loop") + "\n그룹 을 만든다. Catus 앱이다.\n"
                                        if path.endswith("SKILL.md") else "# 제목\n\n그룹 을 만든다. Catus 앱이다.\n"})
                message = self.assert_violations(harness.check_glossary_avoid, root, "용어집 금지어", 2)
                self.assertIn(f"{path}:", message)
                self.assertIn("«Catus» 대신 «Cattus» 를 쓴다", message)
                self.assertIn("«그룹» 대신 «섬» 를 쓴다", message)

    def test_skill_description_and_korean_substrings_and_english_boundaries(self):
        files = {".claude/skills/pr-loop/SKILL.md": skill_text("pr-loop", description="Catus 에서 그룹화를 쓴다."),
                 "AGENTS.md": "# A\n\nCatus는 옛 이름이고 같이숲 도 그렇다. Catus-api 와 satellite 와 위성 도 안 된다.\n"}
        message = self.assert_violations(harness.check_glossary_avoid, make_repo(self, files), "용어집 금지어", 6)
        self.assertIn(".claude/skills/pr-loop/SKILL.md:3", message)      # 머리말의 description 도 산문이다
        for word in ("Catus", "그룹", "같이숲", "satellite", "위성"):
            self.assertIn(f"«{word}»", message)
        self.assertIn("«satellite» 대신 «Business API» · «Notification» 를 쓴다", message)    # 두 용어의 _Avoid_ 에 든 단어는 둘 다 알린다

    def test_skill_that_calls_the_old_names_on_purpose_is_excluded(self):
        files = {harness.GLOSSARY_EXCLUDED[0]: skill_text("gromo-screen-flow", description="gromo(GROMO·Catus·Focuscat) 화면") + "\nCatus 그룹\n"}
        summary = harness.check_glossary_avoid(make_repo(self, files))
        self.assertIn("문서 5개", summary)      # CLAUDE.md · AGENTS.md · backoffice/AGENTS.md · pr-loop · prod-release — gromo-screen-flow 만 빠진다

    def test_unreadable_glossary_fails_instead_of_passing_silently(self):
        with self.assertRaisesRegex(ValueError, "CONTEXT.md 가 추적되지 않는다"):
            harness.check_glossary_avoid(make_repo(self, remove=("CONTEXT.md",)))
        with self.assertRaisesRegex(ValueError, "하나도 읽지 못했다"):
            harness.check_glossary_avoid(make_repo(self, {"CONTEXT.md": "# Cattus\n\n**섬**:\n공간이다.\n"}))
        only_conditional = "# C\n\n**서버 4종**:\n묶음이다.\n_Avoid_: 앱(서버 묶음을 가리킬 때)\n"
        with self.assertRaisesRegex(ValueError, "하나도 읽지 못했다"):
            harness.check_glossary_avoid(make_repo(self, {"CONTEXT.md": only_conditional}))


if __name__ == "__main__":
    unittest.main()
