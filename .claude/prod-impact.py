#!/usr/bin/env python3
"""운영 영향 경고 — 변경이 운영에 닿으면 알리고, 운영에 닿는 PR 병합·CD 재실행은 확인을 받는다.

    python3 .claude/prod-impact.py --hook        # stdin: Claude Code 훅 JSON
    python3 .claude/prod-impact.py --files [--github] [--base-ref REF]   # stdin: 변경 파일 목록(한 줄에 하나)
    python3 .claude/prod-impact.py --selftest

판정 규칙은 impacts(root, files, base) 한 곳이다. 훅과 PR CI(--files)가 같은 규칙을 쓴다. 한 항목은 한국어 한 줄이다.
--files 는 경고 도구라 항상 exit 0 이다(PR 검사를 붉게 만들지 않는다). 영향이 없으면 «운영 영향 없음» 한 줄.

--hook (등록: .claude/settings.json, 동기·10초, `[ -f … ] || exit 0;` 존재 가드 뒤). 어떤 오류에도 exit 0 이다 — 훅이 exit 2 를 내면
도구 호출이 막힌다. 존재 가드는 세션이 도는 중에 체크아웃이 이 파일 없는 옛 브랜치로 바뀌어도(python 이 exit 2) Bash 가 막히지 않게 한다.
- PostToolUse(Edit·Write·MultiEdit·NotebookEdit): 편집한 파일이 운영에 닿으면 세션당 파일마다 한 번 알린다.
- PreToolUse(Bash): `gh pr merge` 는 PR 파일 목록(이름 변경의 옛 경로 포함)을 조회해 영향이 있거나 조회가 실패하면 확인(ask)을 받는다.
  `gh run rerun` 은 운영 CD 실행(서버·백오피스 CD, Android CD)이면 확인을 받는다.
  `gh pr create`·`git push` 는 브랜치 변경(`git diff --no-renames` 라 옛 경로도 보인다)만 보고 알리기만 한다.
  그 밖의 Bash 는 «gh»·«git» 단어가 없으면 아무것도 불러오지 않고 끝난다(모든 Bash 호출마다 도는 훅이다).

운영 배포 명령(`gh workflow run`·`gh api …dispatches`)의 확인은 이 스크립트가 아니라 .claude/settings.json 의
permissions.ask 가 맡는다. 같은 규칙을 훅에서 한 번 더 만들지 않는다. 한계:
- ask 규칙은 명령 문자열 매칭이라 숫자 워크플로 id(`gh workflow run 12345`), 절대 경로 gh(`/opt/homebrew/bin/gh`),
  `sh -c '…'`·변수·서브셸로 만든 명령은 못 잡는다.
- rtk 훅이 `gh api …` 를 `rtk gh api …` 로 다시 쓴다(rtk 0.37.2 는 `gh workflow run` 을 다시 쓰지 않는다). 권한 규칙이
  다시 쓴 명령에 적용될 수 있어 gh api 규칙은 rtk 형태도 둔다. rtk 가 다른 gh 명령까지 다시 쓰기 시작하면 같은 구멍이 난다.
- Bash 훅은 `bash -c`·eval·`cd x && …`(cd 이후 폴더)를 해석하지 않는다. `bypassPermissions` 에서 훅 ask 가 지켜지는지는 문서에 없다.
- 규칙 1·2 는 .github/scripts/catus-plan.py 의 fingerprints() 포함 조건을 복사했다 — selftest 가 원본과 대조한다.
  규칙 7(앱만)은 .github/ci/app-change-plan.py 의 runtime_input 을 불러 쓴다. 못 불러오면 그 규칙만 건너뛴다.
"""

import json
import os
import re
import sys

PLAN = ".github/scripts/catus-plan.py"
APP_PLAN = ".github/ci/app-change-plan.py"
BACKOFFICE_CD = ".github/workflows/backoffice-cd.prod-V2.yml"
# 위 워크플로 on.push.paths 의 두 줄 — 규칙 3 은 이 조건을 따른다. selftest 가 파일에 두 줄이 있는지 읽어 확인한다.
BACKOFFICE_PATHS = ("- backoffice/**", "- '!backoffice/**/*.md'")
# Android 앱 게시 경로 — main 머지의 Android CI 가 운영 V2 서버용 AAB 를 만들고 Android CD 가 Play 내부 테스트에 올린다.
ANDROID_WORKFLOWS = (".github/workflows/app-android-ci.yml", ".github/workflows/app-android-cd.yml")
PROCESS_WORKFLOWS = tuple(".github/workflows/%s.yml" % name for name in (
    "prod-ci-V2", "prod-cd-V2", "kafka-ci.prod-V2", "kafka-cd.prod-V2",
    "redis-ci.prod-V2", "redis-cd.prod-V2", "backoffice-cd.prod-V2")) + ANDROID_WORKFLOWS
PROD_CD = ("prod-cd-V2.yml", "kafka-cd.prod-V2.yml", "redis-cd.prod-V2.yml", "backoffice-cd.prod-V2.yml")
ANDROID_CD = "app-android-cd.yml"       # `gh run rerun` 이 운영 게시로 보는 Android 실행(워크플로 표시 이름 «Android CD»)
# PR 파일 목록 조회의 jq. 이름 변경이면 filename 에는 새 경로만 오고 옛 경로는 previous_filename 에 온다 — 둘 다 판정한다.
# .github/workflows/pr-ci-policy.yml 의 `--jq` 와 같아야 한다(selftest 가 대조한다).
FILES_JQ = ".[] | .filename, (.previous_filename // empty)"
EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
PIPELINE_DOC = "docs/engineering/prod-v2-pipeline.md"
ANDROID_DOC = "docs/conventions/android-ci-cd.md"
LOOKUP_SECONDS = 8          # gh 조회 합계. 훅 timeout(10초)보다 짧아야 ask 를 낼 수 있다
GH_OR_GIT = re.compile(r"(?<![\w-])(gh|git)(?![\w-])")
WRAPPERS = {"command", "rtk", "proxy", "sudo", "env", "time", "nohup", "exec", "builtin",
            "if", "then", "else", "elif", "do", "while", "until", "!", "{"}


# ── 판정 ────────────────────────────────────────────────────────────────────

def _load(root, rel):
    """root/rel 파이썬 파일을 모듈로 불러온다(이름에 하이픈이 있어 importlib). 못 불러오면 None — 그 규칙만 건너뛴다."""
    if not root:
        return None
    try:
        import importlib.util
        sys.dont_write_bytecode = True      # 저장소 안에 __pycache__ 를 남기지 않는다
        spec = importlib.util.spec_from_file_location("_prod_impact_" + re.sub(r"\W", "_", rel), os.path.join(str(root), rel))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception:
        return None


def build_inputs(plan, name):
    """catus-plan.fingerprints() 의 포함 조건 복사 → (지문에 드는 서비스, DB 지문에 드는 서비스). selftest 가 원본과 대조한다."""
    services, sql = set(), set()
    for service in plan.SERVICES:
        own = name.startswith("server/%s/" % service)
        if not own and not name.startswith(plan.SHARED):
            continue
        deploy = service == "data-api" and name.startswith(plan.DATA_DEPLOY_INPUTS)
        if name.endswith(".md") or ("/docs/" in name and not deploy):
            continue
        services.add(service)
        if deploy or (own and name.endswith(".sql") and any(
                "/src/main/resources/db/%s/" % place in name for place in ("migration", "v0", "seed"))):
            sql.add(service)
    return services, sql


def _names(files):
    return ", ".join(files[:3]) + (" 외 %d건" % (len(files) - 3) if len(files) > 3 else "")


def _headline(text):
    return text.split(" — ")[0]


def impacts(root, files, base=None):
    """변경 파일(저장소 상대 경로)이 운영에 닿는 곳을 한국어 한 줄씩. 닿는 곳이 없으면 빈 목록."""
    files = [f.strip() for f in files if f and f.strip()]
    found = []
    plan = _load(root, PLAN) if any(f.startswith(("server/", ".github/", ".dockerignore")) for f in files) else None
    if plan and not all(hasattr(plan, a) for a in ("SERVICES", "SHARED", "DATA_DEPLOY_INPUTS", "COUPLED_SERVICES")):
        plan = None                 # 이름이 바뀌었으면 틀린 판정 대신 규칙 1·2 를 건너뛴다(selftest 의 대조가 빨개진다)
    services, sql, shared = set(), set(), []
    if plan:
        for name in files:
            s, q = build_inputs(plan, name)
            services |= s
            sql |= q
            if s and name.startswith(plan.SHARED):
                shared.append(name)
        if services & plan.COUPLED_SERVICES:
            services |= plan.COUPLED_SERVICES       # Data·Realtime 은 같은 소스 SHA 의 이미지 쌍으로 나간다
    if services:                                                                                    # 규칙 1
        found.append("운영 서버 재빌드 대상: %s — 다음 release 승격에서 prod-ci-V2 가 새로 빌드한다. 배포는 prod-cd-V2 수동 실행"
                     % ", ".join(sorted(services)))
    if shared:
        found.append("운영 지문 공용 입력 %s — 운영 %d종이 모두 재빌드된다" % (_names(shared), len(plan.SERVICES)))
    if sql:                                                                                         # 규칙 2
        found.append("DB 전환이 든 운영 배포 — prod-cd-V2 에 allow_migration=true 와 RDS 스냅샷 절차가 필요하다(%s). "
                     "이미 적용된 마이그레이션 파일은 바이트를 바꾸지 않는다" % PIPELINE_DOC)
    if any(f.startswith("backoffice/") and not f.endswith(".md") for f in files):                  # 규칙 3
        found.append("main 머지가 곧 운영 백오피스 배포다(backoffice-cd.prod-V2, 승인 1회)")
    for role in ("kafka", "redis"):                                                                 # 규칙 4
        if any(re.fullmatch(r"server/scripts/v2/prod/[^/]*-V2\.[^/]*", f) and role in f.rsplit("/", 1)[1] for f in files):
            found.append("다음 release 발행에서 %s 새 태그가 생긴다. 배포는 %s-cd.prod-V2 수동" % (role, role))
    process = [f for f in files if f in PROCESS_WORKFLOWS or f.startswith(".github/scripts/v2/prod/")]  # 규칙 5
    if process:
        docs = [PIPELINE_DOC] if any(f not in ANDROID_WORKFLOWS for f in process) else []
        docs += [ANDROID_DOC] if any(f in ANDROID_WORKFLOWS for f in process) else []
        found.append("운영 발행·배포 절차를 바꾼다 — 다음 실행부터 적용된다(%s)" % " · ".join(docs))
    if ".github/scripts/app-server-gate.py" in files:
        found.append("앱 출시 전 서버 선행 검사를 바꾼다 — ota-update.sh·testflight.sh·Android CI 가 이 검사를 부른다"
                     "(.github/scripts/test_app_server_gate.py 로 확인)")
    if any(re.fullmatch(r"server/[^/]+/src/main/resources/application[^/]*\.ya?ml", f) for f in files):  # 규칙 6
        found.append("서버 설정 파일을 바꿨다 — 설정 키가 바뀌면 운영 값은 cattus-infra 의 env_writer-V2.py·Secrets Manager 에도 "
                     "넣어야 한다(phone 의 write-compose-env.py 는 dev 전용)")
    app = [f for f in files if f.startswith("app/app-dev/") and not f.endswith(".md")]              # 규칙 7
    if app and services:
        found.append("앱과 서버를 함께 바꿨다 — 서버를 운영에 먼저 배포하고 앱을 출시한다(app-server-gate.py)")
    elif app:
        # main push 의 Android CI 는 운영 V2 서버용 AAB 를 만들고, 켜져 있는 Android CD 는 Play 내부 테스트에 자동 게시한다.
        # 어떤 파일이 게시 입력인지는 app-change-plan.py 의 runtime_input 이 정본이다(테스트·문서·iOS 전용 파일은 제외).
        module = _load(root, APP_PLAN)
        if module and any(module.runtime_input(f, "android") for f in app):
            found.append("앱 변경 — main 머지 때 Android CI 가 운영 V2 서버용 AAB 를 만들고, Android CD 가 켜져 있으면 Play 내부 "
                         "테스트에 자동 게시한다(app-android-ci.yml·app-android-cd.yml). 서버 선행 여부는 app-server-gate.py 가 확인한다")
    if base == "release":                                                                           # 규칙 8
        found.append("release 머지는 운영 이미지·태그 발행(prod-ci-V2·kafka-ci.prod-V2·redis-ci.prod-V2)을 시작한다. 배포는 각 CD 수동")
    return found


# ── Bash 명령 해석 ───────────────────────────────────────────────────────────

def _statements(command):
    """명령 문자열을 구문별 토큰 목록으로 — 환경변수 대입과 래퍼(rtk·command·sudo…)를 벗긴 뒤의 토큰들.

    ponytail: 따옴표 안의 글은 토큰 하나라 `echo "gh pr merge"` 는 안 걸린다. bash -c '…'·eval·변수로 만든 명령은 못 본다.
    """
    import shlex
    text = command.replace("\\\n", " ").replace("\n", " ; ")
    try:
        lexer = shlex.shlex(text, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        tokens = text.split()                   # 따옴표가 안 맞는 명령 — 거칠게라도 본다
    statements, current = [], []
    for token in tokens + [";"]:
        if re.fullmatch(r"[();<>|&]+", token):
            statements.append(current)
            current = []
        else:
            current.append(token)
    result = []
    for tokens in statements:
        i = 0
        while i < len(tokens) and (tokens[i] in WRAPPERS or re.match(r"[A-Za-z_]\w*=", tokens[i])):
            i += 1
        if i < len(tokens):
            result.append(tokens[i:])
    return result


def _flag(tokens, short, long):
    """`--long v` · `--long=v` · `-s v` · `-sv` 의 첫 값."""
    for i, token in enumerate(tokens):
        if token in (short, long) and i + 1 < len(tokens):
            return tokens[i + 1]
        if token.startswith(long + "="):
            return token[len(long) + 1:]
        if token.startswith(short) and not token.startswith("--") and len(token) > 2:
            return token[2:]
    return None


_VALUE_FLAGS = {"-R", "--repo", "--hostname", "-b", "--body", "-F", "--body-file", "-t", "--subject",
                "-A", "--author-email", "--match-head-commit", "-j", "--job", "-B", "--base"}


def _positional(tokens):
    """플래그와 플래그 값을 뺀 첫 인자(PR 선택자·실행 id)."""
    skip = False
    for token in tokens:
        if skip:
            skip = False
        elif token.startswith("-"):
            skip = token in _VALUE_FLAGS        # `--flag=값` 은 한 토큰이라 건너뛸 값이 없다
        else:
            return token
    return None


def _skip_global(tokens, j):
    """gh 전역 플래그(--repo o/r · -R o/r · --hostname h · --repo=o/r)를 건너뛴 위치 — pr-gate.py 와 같은 처리."""
    while j < len(tokens):
        if tokens[j] in ("--repo", "-R", "--hostname"):
            j += 2
        elif tokens[j].startswith(("--repo=", "--hostname=")):
            j += 1
        else:
            break
    return j


def _parse_gh(tokens):
    j = _skip_global(tokens, 1)
    group = tokens[j] if j < len(tokens) else ""
    k = _skip_global(tokens, j + 1)
    sub = tokens[k] if k < len(tokens) else ""
    rest = tokens[k + 1:]
    if group == "pr" and sub == "merge":
        return ("merge", _positional(rest), _flag(tokens, "-R", "--repo"))
    if group == "pr" and sub in ("create", "new"):
        return ("create", _flag(rest, "-B", "--base"), None)
    if group == "run" and sub == "rerun":
        return ("rerun", _positional(rest), _flag(tokens, "-R", "--repo"))
    return None


def _parse_git(tokens):
    i, workdir = 1, None
    while i < len(tokens) and tokens[i].startswith("-"):
        if tokens[i] == "-C" and i + 1 < len(tokens):
            workdir = os.path.join(workdir, tokens[i + 1]) if workdir else tokens[i + 1]
            i += 2
        elif tokens[i] in ("-c", "--git-dir", "--work-tree", "--namespace"):
            i += 2
        else:
            i += 1
    if i < len(tokens) and tokens[i] == "push" and not {"--delete", "-d", "--dry-run"} & set(tokens[i + 1:]):
        return ("push", workdir, None)
    return None


def parse_bash(command):
    """훅이 보는 동작 목록 [(종류, 인자, 저장소)] — merge(PR 선택자)·rerun(실행 id)·create(--base)·push(-C 폴더)."""
    found = []
    for tokens in _statements(command):
        program = os.path.basename(tokens[0])
        action = _parse_gh(tokens) if program == "gh" else _parse_git(tokens) if program == "git" else None
        if action:
            found.append(action)
    return found


# ── 훅 ──────────────────────────────────────────────────────────────────────

def find_root(path):
    """path(파일 또는 폴더)에서 위로 올라가며 처음 만나는 .git(워크트리는 파일) 가진 폴더. 없으면 None."""
    d = path if os.path.isdir(path) else os.path.dirname(path)
    while not os.path.exists(d) and os.path.dirname(d) != d:
        d = os.path.dirname(d)
    while True:
        if os.path.exists(os.path.join(d, ".git")):
            return d
        if os.path.dirname(d) == d:
            return None
        d = os.path.dirname(d)


def _first_time(session, path):
    """같은 세션에서 같은 파일은 한 번만 알린다 — 임시 폴더의 세션별 표식 파일."""
    import tempfile
    marker = os.path.join(tempfile.gettempdir(), "prod-impact-%s.txt" % re.sub(r"[^\w-]", "_", str(session or "none"))[:80])
    try:
        with open(marker, encoding="utf-8") as f:
            if path in f.read().splitlines():
                return False
    except OSError:
        pass
    try:
        with open(marker, "a", encoding="utf-8") as f:
            f.write(path + "\n")
    except OSError:
        pass
    return True


def edit_hook(data):
    tool_input = data.get("tool_input") if isinstance(data.get("tool_input"), dict) else {}
    path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not isinstance(path, str) or not path:
        return None
    cwd = data["cwd"] if isinstance(data.get("cwd"), str) else os.getcwd()
    path = os.path.realpath(path if os.path.isabs(path) else os.path.join(cwd, path))
    root = find_root(path)      # $CLAUDE_PROJECT_DIR 은 세션 시작 폴더라 워크트리와 다르다 — 대상 경로에서 찾는다
    if not root:
        return None
    rel = os.path.relpath(path, root).replace(os.sep, "/")
    found = impacts(root, [rel])
    if not found or not _first_time(data.get("session_id"), path):
        return None
    return {"systemMessage": "⚠️ 운영 영향 — %s: %s" % (rel, "; ".join(_headline(x) for x in found)),
            "hookSpecificOutput": {"hookEventName": "PostToolUse",
                                   "additionalContext": "운영 영향 — %s:\n%s" % (rel, "\n".join("- " + x for x in found))}}


def _gh(args, cwd, timeout):
    import subprocess
    try:
        done = subprocess.run(["gh"] + args, cwd=cwd if cwd and os.path.isdir(cwd) else None, capture_output=True,
                              text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise RuntimeError("gh 를 찾지 못했다")
    except subprocess.TimeoutExpired:
        raise RuntimeError("gh 조회 시간 초과")
    if done.returncode:
        lines = [x for x in done.stderr.strip().splitlines() if x.strip()]
        raise RuntimeError(lines[-1][:160] if lines else "gh 종료 코드 %d" % done.returncode)
    return done.stdout


def merge_check(selector, repo, cwd):
    """`gh pr merge` 의 확인 사유. 영향이 없으면 None. 조회가 실패하면 «확인하지 못했다» 로 확인을 받는다."""
    import time
    start = time.monotonic()

    def lookup(*args):
        left = LOOKUP_SECONDS - (time.monotonic() - start)
        if left < 0.5:
            raise RuntimeError("조회 시간 초과(%d초)" % LOOKUP_SECONDS)
        return _gh(list(args), cwd, left)

    try:
        view = json.loads(lookup("pr", "view", *([selector] if selector else []), *(["-R", repo] if repo else []),
                                 "--json", "number,baseRefName"))
        number, base = view["number"], view["baseRefName"]
        files = lookup("api", "--paginate", "repos/%s/pulls/%s/files" % (repo or "{owner}/{repo}", number),
                       "--jq", FILES_JQ).splitlines()
        found = impacts(find_root(cwd), files, base)
    except Exception as error:
        return "운영 영향을 확인하지 못했다 — %s" % error
    if not found:
        return None
    return "운영 영향이 있는 PR 병합 — #%s (base: %s). 확인한 뒤 승인한다:\n%s" % (number, base, "\n".join("- " + x for x in found))


def rerun_check(run_id, repo, cwd):
    """`gh run rerun <id>` 가 운영 CD 실행이면 확인 사유. 아니거나 조회가 실패하면 None — 재실행은 dev CI 에도 흔하다."""
    if not run_id or not run_id.isdigit():
        return None
    try:
        run = json.loads(_gh(["api", "repos/%s/actions/runs/%s" % (repo or "{owner}/{repo}", run_id)], cwd, LOOKUP_SECONDS))
        path = (run.get("path") or "").split("@")[0]        # 실행의 path 는 `.github/workflows/x.yml@refs/heads/release`
        name = run.get("name") or ""
        android = os.path.basename(path) == ANDROID_CD or name == "Android CD"
        if android or os.path.basename(path) in PROD_CD or re.fullmatch(r"Catus \w+ CD V2", name):
            effect = "같은 AAB 를 Play 내부 테스트에 다시 게시한다" if android else "같은 입력으로 운영에 배포한다"
            return "운영 CD 재실행 — %s (run %s) 를 다시 돌리면 %s. 확인한 뒤 승인한다" % (name or path, run_id, effect)
    except Exception:
        pass
    return None


def branch_impacts(root, base):
    """브랜치 변경(origin/<base>...HEAD)의 운영 영향. ponytail: fetch 하지 않는다 — 오래된 origin/<base> 면 이미 머지된 변경이 섞인다."""
    if not root:
        return []
    import subprocess
    try:
        done = subprocess.run(["git", "-C", root, "diff", "--no-renames", "--name-only", "-z", "origin/%s...HEAD" % base],
                              capture_output=True, text=True, timeout=5, stdin=subprocess.DEVNULL)
    except Exception:
        return []
    return impacts(root, done.stdout.split("\0"), base) if done.returncode == 0 else []


def bash_hook(data):
    tool_input = data.get("tool_input") if isinstance(data.get("tool_input"), dict) else {}
    command = tool_input.get("command")
    if not isinstance(command, str) or not GH_OR_GIT.search(command):
        return None                 # 거의 모든 Bash 호출이 여기서 끝난다 — 아무것도 불러오지 않는다
    cwd = data["cwd"] if isinstance(data.get("cwd"), str) else os.getcwd()
    asks, notes = [], []
    for kind, arg, repo in parse_bash(command):
        if kind == "merge":
            asks.append(merge_check(arg, repo, cwd))
        elif kind == "rerun":
            asks.append(rerun_check(arg, repo, cwd))
        elif kind == "create":
            notes += branch_impacts(find_root(cwd), arg or "main")
        elif kind == "push":
            notes += branch_impacts(find_root(os.path.join(cwd, os.path.expanduser(arg)) if arg else cwd), "main")
    asks = [x for x in asks if x]
    notes = list(dict.fromkeys(notes))
    if asks:
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                       "permissionDecisionReason": "\n".join(asks)}}
    if notes:
        return {"systemMessage": "⚠️ 운영 영향 — 이 브랜치의 변경: " + "; ".join(_headline(x) for x in notes),
                "hookSpecificOutput": {"hookEventName": "PreToolUse",
                                       "additionalContext": "운영 영향 — 이 브랜치의 변경:\n" + "\n".join("- " + x for x in notes)}}
    return None


def hook(data):
    if data.get("tool_name") == "Bash":
        return bash_hook(data)
    if data.get("tool_name") in EDIT_TOOLS:
        return edit_hook(data)
    return None


def run_hook():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace") or "null")
        out = hook(data) if isinstance(data, dict) else None
        if out:
            sys.stdout.write(json.dumps(out) + "\n")
            sys.stdout.flush()
    except BaseException as error:  # 훅은 어떤 오류에도 exit 0 — exit 2 는 도구 호출을 막는다
        try:
            print("prod-impact: %s: %s" % (type(error).__name__, error), file=sys.stderr)
        except Exception:
            pass
    sys.exit(0)


# ── CI (--files) ────────────────────────────────────────────────────────────

def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _escape(text):
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def report(root, files, github, base):
    """(출력 줄 목록, 요약 마크다운 또는 None)."""
    files = [f.strip() for f in files if f.strip()]
    if not files:
        return ["변경 파일 목록이 비어 있다 — 운영 영향을 판정하지 못했다(목록 조회가 실패했을 수 있다)"], None
    found = impacts(root, files, base)
    if not found:
        return ["운영 영향 없음"], None
    lines = [("::warning title=운영 영향::" + _escape(x)) if github else "- " + x for x in found]
    summary = "### 운영 영향\n\n| # | 내용 |\n| --- | --- |\n" + "".join(
        "| %d | %s |\n" % (n, x.replace("|", "\\|")) for n, x in enumerate(found, 1))
    return lines, summary


def run_files(argv):
    try:
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--files", action="store_true")
        parser.add_argument("--github", action="store_true")
        parser.add_argument("--base-ref", default=None)
        args = parser.parse_args(argv)
        lines, summary = report(_repo_root(), sys.stdin.read().splitlines(), args.github, args.base_ref or None)
        print("\n".join(lines))
        path = os.environ.get("GITHUB_STEP_SUMMARY")
        if args.github and summary and path:
            with open(path, "a", encoding="utf-8") as f:
                f.write(summary + "\n")
    except BaseException as error:  # 경고 도구다 — 실패해도 PR 검사를 붉게 만들지 않는다
        print("prod-impact: %s: %s" % (type(error).__name__, error), file=sys.stderr)
    sys.exit(0)


# ── selftest ────────────────────────────────────────────────────────────────

RULE_CASES = [
    ("1 Data 변경 → Realtime 동반", ["server/data-api/src/main/java/A.java"], None,
     ["운영 서버 재빌드 대상: data-api, realtime —"]),
    ("1 business-api 단독", ["server/business-api/src/main/java/A.java"], None, ["운영 서버 재빌드 대상: business-api —"]),
    ("1 공용 입력 → 4종", [".dockerignore"], None,
     ["운영 서버 재빌드 대상: business-api, data-api, notification, realtime —", "운영 지문 공용 입력 .dockerignore — 운영 4종이 모두 재빌드된다"]),
    ("2 DB 전환(v0)", ["server/data-api/src/main/resources/db/v0/V99__x.sql"], None,
     ["DB 전환이 든 운영 배포 — prod-cd-V2 에 allow_migration=true 와 RDS 스냅샷 절차가 필요하다"]),
    ("2 배포 입력(data-api docs)", ["server/data-api/docs/db/v0-rebase/manifest.json"], None, ["DB 전환이 든 운영 배포"]),
    ("3 백오피스", ["backoffice/server/app.mjs"], None, ["main 머지가 곧 운영 백오피스 배포다(backoffice-cd.prod-V2, 승인 1회)"]),
    ("4 kafka 묶음", ["server/scripts/v2/prod/kafka-V2.yml"], None, ["kafka 새 태그가 생긴다. 배포는 kafka-cd.prod-V2 수동"]),
    ("4 redis 묶음", ["server/scripts/v2/prod/redis-V2.yml"], None, ["redis 새 태그가 생긴다. 배포는 redis-cd.prod-V2 수동"]),
    ("5 운영 CD 워크플로", [".github/workflows/prod-cd-V2.yml"], None,
     ["운영 발행·배포 절차를 바꾼다 — 다음 실행부터 적용된다(docs/engineering/prod-v2-pipeline.md)"]),
    ("5 Android CI 워크플로", [".github/workflows/app-android-ci.yml"], None,
     ["운영 발행·배포 절차를 바꾼다 — 다음 실행부터 적용된다(docs/conventions/android-ci-cd.md)"]),
    ("5 Android CD 워크플로", [".github/workflows/app-android-cd.yml"], None,
     ["운영 발행·배포 절차를 바꾼다 — 다음 실행부터 적용된다(docs/conventions/android-ci-cd.md)"]),
    ("5 서버·Android 워크플로를 함께", [".github/workflows/prod-cd-V2.yml", ".github/workflows/app-android-cd.yml"], None,
     ["(docs/engineering/prod-v2-pipeline.md · docs/conventions/android-ci-cd.md)"]),
    ("5 운영 스크립트(공용 입력이기도)", [".github/scripts/v2/prod/catus-runtime-V2.py"], None,
     ["운영 발행·배포 절차를 바꾼다", "운영 지문 공용 입력 .github/scripts/v2/prod/catus-runtime-V2.py"]),
    ("5 앱 서버 선행 검사", [".github/scripts/app-server-gate.py"], None, ["앱 출시 전 서버 선행 검사를 바꾼다"]),
    ("6 서버 설정", ["server/realtime/src/main/resources/application-prod.yml"], None, ["env_writer-V2.py·Secrets Manager"]),
    ("7 앱+서버", ["app/app-dev/src/App.tsx", "server/data-api/src/main/java/A.java"], None,
     ["앱과 서버를 함께 바꿨다 — 서버를 운영에 먼저 배포하고 앱을 출시한다(app-server-gate.py)"]),
    ("7 앱만(자동 게시 경로)", ["app/app-dev/src/App.tsx"], None, ["Android CD 가 켜져 있으면 Play 내부 테스트에 자동 게시한다"]),
    ("8 release 머지", ["docs/a.md"], "release", ["release 머지는 운영 이미지·태그 발행"]),
]
QUIET = ["docs/x.md", "backoffice/README.md", "server/data-api/README.md", "CONTEXT.md", "app/app-dev/README.md",
         "app/app-dev/src/App.sessionCommands.test.tsx", "app/app-dev/ios/GROMO/Info.plist", "server/data-api/docs/db/schema.dbml",
         ".claude/prod-impact.py", ".github/workflows/pr-ci-policy.yml", "docs/engineering/pipeline-map.md",
         ".github/workflows/app-android-build.yml"]      # 네이티브 컴파일 검사 — 게시 절차가 아니다
FINGERPRINT_SAMPLES = [
    "server/data-api/src/main/java/A.java", "server/realtime/src/main/java/A.java", "server/business-api/src/main/resources/application.yml",
    "server/notification/src/main/java/A.java", "server/data-api/src/main/resources/db/v0/V99__x.sql",
    "server/data-api/src/main/resources/db/migration/V99__x.sql", "server/data-api/src/main/resources/db/seed/S1__x.sql",
    "server/notification/src/main/resources/db/migration/V99__x.sql", "server/realtime/src/main/resources/db/other/V1__x.sql",
    "server/data-api/README.md", "server/data-api/docs/db/schema.dbml", "server/data-api/docs/db/deploy-v0.py",
    "server/data-api/docs/db/v0-rebase/manifest.json", "server/notification/docs/x.json",
    ".github/scripts/ci-jar.py", ".github/scripts/catus-plan.py", ".github/scripts/catus-notes.md", ".github/actions/ci-jar/action.yml",
    ".github/scripts/v2/prod/catus-runtime-V2.py", ".github/workflows/prod-ci.yml", ".github/workflows/be-gradle.yml",
    ".github/workflows/prod-ci-V2.yml", ".dockerignore", "server/gradle/wrapper/gradle-wrapper.properties",
    "server/scripts/v2/prod/kafka-V2.yml", "app/app-dev/src/App.tsx", "docs/x.md"]
PARSE_CASES = [
    ("gh pr merge 1536", [("merge", "1536", None)]),
    ("gh pr merge --squash", [("merge", None, None)]),
    ("gh pr merge --squash --subject 'x y' 1536 --delete-branch", [("merge", "1536", None)]),
    ("gh -R o/r pr merge 7", [("merge", "7", "o/r")]),
    ("GH_TOKEN=x /opt/homebrew/bin/gh pr merge 5", [("merge", "5", None)]),
    ("/usr/bin/git -C x push -u origin b", [("push", "x", None)]),
    ("rtk git push", [("push", None, None)]),
    ("command git push origin b", [("push", None, None)]),
    ("cd x&&git push && gh pr create --base release --title t", [("push", None, None), ("create", "release", None)]),
    ("gh pr create --title t", [("create", None, None)]),
    ("gh run rerun 123 --failed", [("rerun", "123", None)]),
    ("git push --delete origin b", []),
    ("echo 'gh pr merge 1'", []),
    ("git commit -m 'gh pr merge 1'", []),
    ("git status", []),
    ("gh pr view 12", []),
    ("ls -la", []),
    ("cat x", []),
]


def run_selftest():
    global _gh, parse_bash, LOOKUP_SECONDS
    import shutil
    import subprocess
    import tempfile
    root = _repo_root()
    results = []

    def check(label, ok, detail=""):
        results.append(bool(ok))
        print("%s %s%s" % ("✅" if ok else "❌", label, "" if ok else " — %s" % (detail,)))

    def has(found, *needles):
        return all(any(needle in line for line in found) for needle in needles)

    # 규칙 1~8 대표 경로와 무경고 경로
    for name, files, base, needles in RULE_CASES:
        found = impacts(root, files, base)
        check("규칙 " + name, has(found, *needles), found)
    for path in QUIET:
        check("무경고 " + path, impacts(root, [path]) == [], impacts(root, [path]))

    # 규칙 1·2: 복사한 포함 조건이 catus-plan.fingerprints() 와 같은 판정을 한다
    plan = _load(root, PLAN)
    check("catus-plan.py 를 불러온다", plan is not None)
    if plan:
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            for name in FINGERPRINT_SAMPLES:
                full = os.path.join(tmp, name)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w") as f:
                    f.write("x")
            empty_source, empty_sql = plan.fingerprints(Path(tmp), [])
            for name in FINGERPRINT_SAMPLES:
                source, sql = plan.fingerprints(Path(tmp), [name])
                real = ({s for s in plan.SERVICES if source[s] != empty_source[s]},
                        {s for s in plan.SERVICES if sql[s] != empty_sql[s]})
                check("fingerprints() 대조: " + name, build_inputs(plan, name) == real, (build_inputs(plan, name), real))
    with tempfile.TemporaryDirectory() as tmp:
        check("catus-plan.py 가 없으면 규칙 1·2 만 건너뛴다",
              impacts(tmp, ["server/data-api/src/main/java/A.java"]) == []
              and len(impacts(tmp, ["server/data-api/src/main/resources/application.yml"])) == 1
              and impacts(None, ["backoffice/server/app.mjs"]) != [])
        os.makedirs(os.path.join(tmp, ".github/scripts"))
        with open(os.path.join(tmp, PLAN), "w") as f:
            f.write("SERVICES = {'data-api'}\n")        # 이름이 바뀐 계획 모듈 — 틀린 판정 대신 건너뛴다
        check("catus-plan.py 의 이름이 바뀌었으면 규칙 1·2 를 건너뛴다", impacts(tmp, ["server/data-api/src/main/java/A.java"]) == [])

    # 규칙 3: 백오피스 CD 의 on.push.paths 두 줄이 그대로여야 이 규칙이 맞다
    with open(os.path.join(root, BACKOFFICE_CD), encoding="utf-8") as f:
        lines = [line.strip() for line in f]
    check("backoffice-cd.prod-V2.yml 의 on.push.paths 두 줄", all(path in lines for path in BACKOFFICE_PATHS), BACKOFFICE_PATHS)

    # 명령 해석
    for command, expected in PARSE_CASES:
        got = parse_bash(command)
        check("명령 해석: " + command, got == expected, got)

    # 훅: Bash. gh 는 가짜로 바꿔 네트워크 없이 확인한다.
    calls, replies = [], []

    def fake_gh(args, cwd, timeout):
        calls.append(args)
        for needle, reply in replies:
            if needle in " ".join(args):
                if isinstance(reply, Exception):
                    raise reply
                return reply
        raise RuntimeError("예상 밖 gh 호출 %s" % args)

    def ask(command):
        out = bash_hook({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": root})
        return (out or {}).get("hookSpecificOutput", {}).get("permissionDecisionReason") if out else None

    real_gh, real_parse = _gh, parse_bash
    _gh = fake_gh
    try:
        def boom(command):
            raise AssertionError("parse_bash 호출됨")
        parse_bash = boom
        for command in ("ls -la", "cat x", "npm test && echo done"):
            check("즉시 통과(파싱도 안 함): " + command, bash_hook({"tool_name": "Bash", "tool_input": {"command": command}}) is None)
        parse_bash = real_parse
        replies[:] = [("pr view", '{"number": 7, "baseRefName": "main"}'),
                      ("pulls/7/files", "backoffice/server/app.mjs\ndocs/README.md\n")]
        reason = ask("gh pr merge 7 --squash")
        check("merge: 영향 있으면 ask", reason and "#7 (base: main)" in reason and "백오피스" in reason, reason)
        check("merge: 조회 인자(번호·paginate·placeholder·jq)", calls[0][:3] == ["pr", "view", "7"]
              and calls[1][:2] == ["api", "--paginate"] and calls[1][2] == "repos/{owner}/{repo}/pulls/7/files"
              and calls[1][3:] == ["--jq", FILES_JQ], calls)
        del calls[:]
        ask("gh pr merge --squash")
        check("merge: 번호 없으면 현재 브랜치 PR", calls[0] == ["pr", "view", "--json", "number,baseRefName"], calls)
        replies[:] = [("pr view", '{"number": 8, "baseRefName": "main"}'), ("pulls/8/files", "docs/README.md\n")]
        check("merge: 영향 없으면 통과", ask("gh pr merge 8") is None)
        # 이름 변경: PR files API 는 filename 에 새 경로만 주고 옛 경로는 previous_filename 에 준다. FILES_JQ 는 둘 다 내보내므로
        # 가짜 gh 의 응답(= jq 출력)에는 새 경로와 옛 경로가 함께 온다.
        replies[:] = [("pr view", '{"number": 10, "baseRefName": "main"}'),
                      ("pulls/10/files", "docs/x.md\nbackoffice/server/x.mjs\n")]
        reason = ask("gh pr merge 10")
        check("merge: 백오피스 밖으로 옮기는 이름 변경은 옛 경로로 ask", reason and "#10 (base: main)" in reason and "백오피스" in reason, reason)
        replies[:] = [("pr view", '{"number": 11, "baseRefName": "main"}'), ("pulls/11/files", "docs/x.md\n")]
        check("merge: 새 경로만 오면 통과(대조)", ask("gh pr merge 11") is None)
        replies[:] = [("pr view", '{"number": 9, "baseRefName": "release"}'), ("pulls/9/files", "docs/README.md\n")]
        check("merge: release 가 base 면 ask", "release 머지는" in (ask("gh pr merge 9") or ""))
        replies[:] = [("pr view", RuntimeError("no pull requests found"))]
        check("merge: 조회 실패도 ask", "운영 영향을 확인하지 못했다 — no pull requests found" in (ask("gh pr merge") or ""))
        replies[:] = [("pr view", "not json")]
        check("merge: 응답 형식 오류도 ask", "확인하지 못했다" in (ask("gh pr merge 3") or ""))
        replies[:] = [("runs/123", '{"name": "Catus app CD V2", "path": ".github/workflows/prod-cd-V2.yml@refs/heads/release"}')]
        check("rerun: 운영 CD 면 ask", "운영 CD 재실행 — Catus app CD V2" in (ask("gh run rerun 123") or ""))
        replies[:] = [("runs/126", '{"name": "Android CD", "path": ".github/workflows/app-android-cd.yml@refs/heads/main"}'),
                      ("runs/127", '{"name": "Android CD"}'),
                      ("runs/128", '{"path": ".github/workflows/app-android-cd.yml@refs/heads/main"}'),
                      ("runs/129", '{"name": "Android CI", "path": ".github/workflows/app-android-ci.yml@refs/heads/main"}')]
        reason = ask("gh run rerun 126 --failed")
        check("rerun: Android CD 면 ask(Play 내부 테스트 재게시)",
              reason and "운영 CD 재실행 — Android CD (run 126)" in reason and "Play 내부 테스트에 다시 게시한다" in reason, reason)
        check("rerun: Android CD 를 이름만으로도 알아본다", "Android CD" in (ask("gh run rerun 127") or ""))
        check("rerun: Android CD 를 path 만으로도 알아본다", "app-android-cd.yml" in (ask("gh run rerun 128") or ""))
        check("rerun: Android CI(게시가 아님)는 통과", ask("gh run rerun 129") is None)
        replies[:] = [("runs/124", '{"name": "Data API CI (dev)-v2", "path": ".github/workflows/data-api-ci.dev-v2.yml@refs/heads/main"}')]
        check("rerun: dev CI 면 통과", ask("gh run rerun 124 --failed") is None)
        replies[:] = [("runs/125", RuntimeError("HTTP 404"))]
        check("rerun: 조회 실패는 통과", ask("gh run rerun 125") is None)
        check("rerun: 실행 id 없으면(--job) 통과", ask("gh run rerun --job 77") is None)
    finally:
        _gh, parse_bash = real_gh, real_parse

    # 진짜 _gh: PATH 맨 앞의 가짜 gh 실행 파일로 하위 프로세스·실패·시간 초과·gh 없음 경로를 확인한다(실제 gh 는 부르지 않는다)
    with tempfile.TemporaryDirectory() as tmp:
        stub = os.path.join(tmp, "gh")
        with open(stub, "w") as f:
            f.write('#!/bin/sh\ncase "$*" in\n'
                    '"pr view 7 --json number,baseRefName") echo \'{"number": 7, "baseRefName": "main"}\';;\n'
                    '"api --paginate repos/{owner}/{repo}/pulls/7/files --jq ' + FILES_JQ + '") printf \'backoffice/a.ts\\ndocs/b.md\\n\';;\n'
                    '"pr view 8 --json number,baseRefName") echo "HTTP 404: Not Found" >&2; exit 1;;\n'
                    '"pr view 9 --json number,baseRefName") sleep 5;;\n'
                    '"api repos/{owner}/{repo}/actions/runs/123") echo \'{"name": "Catus kafka CD V2", "path": ".github/workflows/kafka-cd.prod-V2.yml@refs/heads/release"}\';;\n'
                    'esac\n')
        os.chmod(stub, 0o755)
        real_path, real_seconds = os.environ["PATH"], LOOKUP_SECONDS
        try:
            os.environ["PATH"] = tmp + os.pathsep + real_path
            reason = merge_check("7", None, root)
            check("진짜 _gh: merge 조회 → ask 사유", reason and "#7 (base: main)" in reason and "- main 머지가 곧 운영 백오피스 배포다" in reason, reason)
            reason = merge_check("8", None, root)
            check("진짜 _gh: gh 가 실패하면 stderr 마지막 줄을 사유로", reason == "운영 영향을 확인하지 못했다 — HTTP 404: Not Found", reason)
            LOOKUP_SECONDS = 1
            reason = merge_check("9", None, root)
            check("진짜 _gh: 시간 초과도 ask", reason == "운영 영향을 확인하지 못했다 — gh 조회 시간 초과", reason)
            LOOKUP_SECONDS = real_seconds
            check("진짜 _gh: rerun 운영 CD", "운영 CD 재실행 — Catus kafka CD V2" in (rerun_check("123", None, root) or ""))
            os.environ["PATH"] = tmp + "/none"
            reason = merge_check("7", None, root)
            check("진짜 _gh: gh 가 없으면 ask", reason == "운영 영향을 확인하지 못했다 — gh 를 찾지 못했다", reason)
        finally:
            os.environ["PATH"], LOOKUP_SECONDS = real_path, real_seconds

    # PR files API 의 이름 변경: FILES_JQ 가 pr-ci-policy.yml 의 `--jq` 와 같은지(파일을 읽어 대조), jq 가 있으면 실제로 새 경로와
    # 옛 경로를 모두 내보내는지 확인한다. 둘이 갈라지면 CI 의 경고와 훅의 병합 확인이 서로 다른 목록을 본다.
    with open(os.path.join(root, ".github/workflows/pr-ci-policy.yml"), encoding="utf-8") as f:
        used = re.findall(r"--jq '([^']*)'", f.read())
    check("pr-ci-policy.yml 의 --jq 가 FILES_JQ 와 같다", FILES_JQ in used, (used, FILES_JQ))
    jq = shutil.which("jq")
    if jq:
        sample = json.dumps([{"filename": "docs/x.md", "previous_filename": "backoffice/server/x.mjs", "status": "renamed"},
                             {"filename": "docs/a.md", "status": "modified"}])
        done = subprocess.run([jq, "-r", FILES_JQ], input=sample, capture_output=True, text=True)
        check("FILES_JQ: 이름 변경이면 새 경로와 옛 경로를 모두 낸다(jq)",
              done.stdout.splitlines() == ["docs/x.md", "backoffice/server/x.mjs", "docs/a.md"], (done.stdout, done.stderr))
    else:
        check("FILES_JQ: jq 가 없어 실제 출력 대조는 건너뛴다", True)

    # 훅: git push · gh pr create (임시 저장소, 막지 않고 알리기만)
    def git(path, *args):
        subprocess.run(["git", "-C", path, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false",
                        "-c", "core.hooksPath=/dev/null"] + list(args), check=True, capture_output=True)

    with tempfile.TemporaryDirectory() as tmp:
        repo = os.path.join(tmp, "repo")
        os.makedirs(repo)
        git(repo, "init", "-q")
        with open(os.path.join(repo, "a.txt"), "w") as f:
            f.write("a")
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "a")
        git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
        os.makedirs(os.path.join(repo, "docs"))
        with open(os.path.join(repo, "docs/a.md"), "w") as f:
            f.write("a")
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "docs")
        quiet = bash_hook({"tool_name": "Bash", "tool_input": {"command": "git push -u origin b"}, "cwd": repo})
        check("push: 영향 없으면 출력 없음", quiet is None, quiet)
        os.makedirs(os.path.join(repo, "backoffice"))
        with open(os.path.join(repo, "backoffice/x.ts"), "w") as f:
            f.write("a")
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "backoffice")
        for command, cwd in (("git push -u origin b", repo), ("/usr/bin/git -C repo push -u origin b", tmp),
                             ("gh pr create --title t --body b", repo)):
            out = bash_hook({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": cwd})
            specific = (out or {}).get("hookSpecificOutput", {})
            check("push·create: 결정 없이 알리기만 — " + command,
                  out and out["systemMessage"].startswith("⚠️ 운영 영향") and "permissionDecision" not in specific
                  and "백오피스" in specific.get("additionalContext", ""), out)

        # 훅: PostToolUse 편집. 임시 저장소를 루트로 쓰고, 표식 파일도 임시 폴더로 돌린다.
        real_tempdir, tempfile.tempdir = tempfile.tempdir, tmp
        try:
            def edit(rel, session, cwd="/"):
                return hook({"tool_name": "Edit", "tool_input": {"file_path": os.path.join(repo, rel)}, "cwd": cwd,
                             "session_id": session})
            out = edit("backoffice/server/app.mjs", "s1")
            check("편집: 영향 있으면 systemMessage + additionalContext",
                  out and out["systemMessage"].startswith("⚠️ 운영 영향 — backoffice/server/app.mjs: main 머지가 곧 운영 백오피스")
                  and out["hookSpecificOutput"]["hookEventName"] == "PostToolUse"
                  and "백오피스" in out["hookSpecificOutput"]["additionalContext"], out)
            check("편집: 같은 세션·같은 파일은 한 번만", edit("backoffice/server/app.mjs", "s1") is None)
            check("편집: 다른 세션이면 다시 알림", edit("backoffice/server/app.mjs", "s2") is not None)
            check("편집: 다른 파일은 알림", edit("backoffice/server/store.mjs", "s1") is not None)
            check("편집: 영향 없는 파일은 출력 없음", edit("docs/README.md", "s3") is None)
            check("편집: 저장소 밖 파일은 출력 없음", hook({"tool_name": "Write", "tool_input": {"file_path": "/tmp/prod-impact-x.txt"}}) is None)
            nb = hook({"tool_name": "NotebookEdit", "tool_input": {"notebook_path": os.path.join(repo, "backoffice/n.ipynb")},
                       "session_id": "s4"})
            check("편집: NotebookEdit 은 notebook_path 를 본다", nb is not None)
        finally:
            tempfile.tempdir = real_tempdir

    # 프로세스 경계: 나쁜 입력에도 exit 0, 조용한 입력은 무출력, --files 형식
    script = os.path.abspath(__file__)

    def run(args, stdin, env=None):
        return subprocess.run([sys.executable, script] + args, input=stdin, capture_output=True, text=True, env=env, timeout=30)

    for label, stdin in (("깨진 JSON", "{broken"), ("빈 입력", ""), ("배열", "[]"), ("null", "null"),
                         ("tool_input 이 null", '{"tool_name": "Bash", "tool_input": null}'),
                         ("파일 경로가 숫자", '{"tool_name": "Edit", "tool_input": {"file_path": 5}}')):
        done = run(["--hook"], stdin)
        check("--hook %s → exit 0" % label, done.returncode == 0 and done.stdout == "", (done.returncode, done.stdout, done.stderr))
    done = run(["--hook"], json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls -la"}}))
    check("--hook ls -la → 무출력 exit 0", done.returncode == 0 and done.stdout == "" and done.stderr == "", (done.returncode, done.stdout, done.stderr))
    with tempfile.TemporaryDirectory() as tmp:
        summary = os.path.join(tmp, "summary.md")
        env = dict(os.environ, GITHUB_STEP_SUMMARY=summary)
        done = run(["--files", "--github", "--base-ref", "release"], "backoffice/server/app.mjs\ndocs/a.md\n", env)
        text = open(summary, encoding="utf-8").read() if os.path.exists(summary) else ""
        check("--files --github: ::warning 과 요약 표", done.returncode == 0
              and done.stdout.startswith("::warning title=운영 영향::main 머지가 곧 운영 백오피스 배포다")
              and "release 머지는" in done.stdout and "| 1 |" in text and "| --- |" in text, (done.stdout, text))
    done = run(["--files"], "docs/a.md\n")
    check("--files: 영향 없으면 한 줄", done.returncode == 0 and done.stdout == "운영 영향 없음\n", done.stdout)
    done = run(["--files", "--github"], "")
    check("--files: 빈 목록은 판정 못 했다고 알린다", done.returncode == 0 and "판정하지 못했다" in done.stdout, done.stdout)

    failed = results.count(False)
    print("\n%s: %d/%d" % ("통과" if not failed else "실패", len(results) - failed, len(results)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    if "--hook" in sys.argv:
        run_hook()
    elif "--selftest" in sys.argv:
        run_selftest()
    elif "--files" in sys.argv:
        run_files(sys.argv[1:])
    else:
        sys.exit(__doc__)
