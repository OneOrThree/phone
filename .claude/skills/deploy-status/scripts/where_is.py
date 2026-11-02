#!/usr/bin/env python3
"""PR(또는 커밋)이 dev V2·운영 V2 의 어느 단위까지 갔는지 deployment-status 기록으로 본다.

    python3 where_is.py <PR번호|SHA>

단위마다 한 줄: 판정 — 기록(포함 여부) · 기록 시각. 판정은 verdict() 한 곳이다.
- 닿음: 이 변경이 그 단위의 빌드 입력인가. dev 4종은 .github/scripts/v2/dev/dev-fingerprint-V2.py 의 입력 목록,
  운영 서버는 .claude/prod-impact.py 의 build_inputs(운영 지문 조건), 백오피스·Kafka·Redis 는 prod-impact 규칙 3·4 의 경로 조건.
- 포함: 기록된 배포 커밋이 이 커밋을 품는가. compare <커밋>...<기록 커밋> 의 status 가 ahead·identical 이면 포함.
- 기록: deployment-status 브랜치의 state.json(dev/<서비스>, 성공 기록만 믿는다)과 prod-V2/<역할>.json(마지막 성공 태그).
  운영 단위에는 그 CD 워크플로의 최근 실행을 붙인다.
PR 은 머지 커밋으로 본다. SHA 는 그 커밋과 그 커밋의 변경 파일로 본다.
모든 단위를 판정했으면 exit 0, 기록·비교를 못 읽었거나 닿음 규칙을 못 불러온 단위가 있으면 exit 1.
조회만 한다. 저장소는 이 체크아웃의 gh 기본 저장소다. 다른 저장소는 GH_REPO=owner/repo 로 준다.
"""
import importlib.util
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

sys.dont_write_bytecode = True          # 불러오는 저장소 스크립트 옆에 __pycache__ 를 남기지 않는다
ROOT = Path(__file__).resolve().parents[4]
BRANCH = "deployment-status"
KST = timezone(timedelta(hours=9))
DEV_FINGERPRINT = ".github/scripts/v2/dev/dev-fingerprint-V2.py"
PROD_IMPACT = ".claude/prod-impact.py"
FILES_JQ = ".[] | .filename, (.previous_filename // empty)"    # prod-impact.py 의 FILES_JQ 와 같다 — 이름 변경의 옛 경로도 본다
DEV = ("data-api", "realtime", "business-api", "notification")
# (단위, 역할, CD 워크플로, CD 가 도는 브랜치)
PROD = (("운영 서버", "app", "prod-cd-V2.yml", "release"), ("백오피스", "backoffice", "backoffice-cd.prod-V2.yml", "main"),
        ("Kafka", "kafka", "kafka-cd.prod-V2.yml", "release"), ("Redis", "redis", "redis-cd.prod-V2.yml", "release"))
PROD_BUNDLE = re.compile(r"server/scripts/v2/prod/[^/]*-V2\.[^/]*")     # prod-impact 규칙 4 — Kafka·Redis 설정 묶음


def ts(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))     # 3.9 의 fromisoformat 은 Z 를 못 읽는다


def kst(text):
    return ts(text).astimezone(KST).strftime("%Y-%m-%d %H:%M KST") if text else "시각 모름"


def gh(*args):
    done = subprocess.run(["gh"] + list(args), cwd=str(ROOT), capture_output=True, text=True, timeout=60)
    if done.returncode:
        lines = [x for x in done.stderr.splitlines() if x.strip()]
        raise RuntimeError(lines[-1] if lines else "gh 종료 코드 %d" % done.returncode)
    return done.stdout


def gh_json(*args):
    return json.loads(gh(*args))


def load(rel):
    spec = importlib.util.spec_from_file_location("_where_is_" + re.sub(r"\W", "_", rel), str(ROOT / rel))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ── 판정 ────────────────────────────────────────────────────────────────────

def under(name, paths):
    return any(name == p or name.startswith(p.rstrip("/") + "/") for p in paths)


def reach(files):
    """단위 → 닿음. 운영 서버는 닿는 서비스 목록, 나머지는 True·False. 규칙을 못 불러오면 None."""
    result = {}
    try:
        fingerprint = load(DEV_FINGERPRINT)
        for service in DEV:
            paths = tuple(fingerprint.SHARED) + tuple(fingerprint.BUILD_INPUTS[service]) + ("server/" + service,)
            result["dev " + service] = any(under(f, paths) for f in files)
    except Exception:
        result.update(("dev " + service, None) for service in DEV)
    try:
        impact = load(PROD_IMPACT)
        plan = load(impact.PLAN)
        result["운영 서버"] = sorted(set().union(*[impact.build_inputs(plan, f)[0] for f in files]))
    except Exception:
        result["운영 서버"] = None
    result["백오피스"] = any(f.startswith("backoffice/") and not f.endswith(".md") for f in files)    # prod-impact 규칙 3
    for name in ("Kafka", "Redis"):                                                                   # prod-impact 규칙 4
        result[name] = any(PROD_BUNDLE.fullmatch(f) and name.lower() in f.rsplit("/", 1)[1] for f in files)
    return result


def verdict(reached, inside):
    if reached is None:
        return "닿음 판정 못 함"
    if reached:
        return "반영됨" if inside else "아직 안 감"
    return "해당 없음"


def dev_record(state, service):
    """state.json 의 dev/<서비스> → (기록 표시, 기록 커밋, 기록 시각, 덧붙임). 성공 기록이 아니면 ValueError."""
    record = state.get("dev/" + service)
    if not record:
        raise ValueError("state.json 에 dev/%s 기록이 없다" % service)
    revision = record.get("revision") or ""
    if record.get("result") != "success":
        raise ValueError("마지막 기록이 %s(%s)다 — 마지막 성공 배포는 이 기록으로 알 수 없다" % (record.get("result"), revision[:9]))
    return revision[:9], revision, record.get("finished_at"), ""


def peel(ref, tag_object):
    """git/ref 응답 → 커밋 SHA. 주석 태그면 태그 객체를 따라간다."""
    obj = ref["object"]
    for _ in range(5):
        if obj["type"] == "commit":
            return obj["sha"]
        obj = tag_object(obj["sha"])["object"]
    raise ValueError("태그를 커밋으로 풀지 못했다")


def run_note(run, gate):
    """운영 CD 의 최근 실행. app-server-gate.py 는 release 의 최근 prod-cd-V2 실행이 completed·success 일 때만 통과한다."""
    if not run:
        return " · 최근 실행 없음"
    note = " · 최근 실행 %s %s" % (run["conclusion"] if run["status"] == "completed" else run["status"], kst(run["created_at"]))
    if gate and (run["status"], run["conclusion"]) != ("completed", "success"):
        note += " — 다음 성공 실행까지 앱 출시 게이트가 막는다"
    return note


# ── 조회 ────────────────────────────────────────────────────────────────────

def raw(path):
    return gh_json("api", "-H", "Accept: application/vnd.github.raw+json",
                   "repos/{owner}/{repo}/contents/%s?ref=%s" % (path, BRANCH))


def prod_record(role, workflow, branch):
    tag = raw("prod-V2/%s.json" % role)["message"]
    commit = peel(gh_json("api", "repos/{owner}/{repo}/git/ref/tags/" + tag),
                  lambda sha: gh_json("api", "repos/{owner}/{repo}/git/tags/" + sha))
    # 기록 시각 = 이 기록 파일이 마지막으로 바뀐 때. 같은 태그를 다시 배포하면 바뀌지 않는다
    when = gh("api", "repos/{owner}/{repo}/commits?sha=%s&path=prod-V2/%s.json&per_page=1" % (BRANCH, role),
              "--jq", ".[0].commit.committer.date").strip()
    runs = gh_json("api", "repos/{owner}/{repo}/actions/workflows/%s/runs?branch=%s&per_page=1" % (workflow, branch))
    return "%s = %s" % (tag, commit[:9]), commit, when, run_note((runs["workflow_runs"] or [None])[0], role == "app")


@lru_cache(maxsize=None)
def contains(sha, commit):
    """기록 커밋이 sha 를 품는가 — compare 의 status 가 ahead(기록이 앞섬)·identical."""
    status = gh("api", "repos/{owner}/{repo}/compare/%s...%s?per_page=1" % (sha, commit), "--jq", ".status").strip()
    return status in ("ahead", "identical")


def unit(name, reached, sha, locate):
    """(한 줄, 판정했나)."""
    try:
        label, commit, when, note = locate()
        inside = contains(sha, commit)
    except Exception as error:
        return "%s — 확인 못 함 — %s" % (name, error), False
    text = "%s — %s — 기록 %s(%s) · %s%s" % (name, verdict(reached, inside), label, "포함" if inside else "미포함",
                                           kst(when), note)
    return text, reached is not None


def target(arg):
    """{lines: 머리 줄, sha: 볼 커밋(머지 안 된 PR 은 None), files: 변경 파일, base: PR 의 base}."""
    if re.fullmatch(r"#?\d{1,6}", arg):
        n = arg.lstrip("#")
        pr = gh_json("api", "repos/{owner}/{repo}/pulls/" + n)
        files = gh("api", "--paginate", "repos/{owner}/{repo}/pulls/%s/files?per_page=100" % n, "--jq", FILES_JQ)
        base, sha = pr["base"]["ref"], pr["merge_commit_sha"] if pr.get("merged_at") else None
        if sha:
            head = "PR #%s 머지됨 → %s · 머지 커밋 %s · %s" % (n, base, sha[:9], kst(pr["merged_at"]))
        else:
            head = "PR #%s %s → %s · 머지되지 않았다" % (n, "열림" if pr["state"] == "open" else "닫힘", base)
        lines = [head, "  " + pr["title"]]
        if base == "release":
            lines.append("release 대상 PR — dev·백오피스는 main 머지로 배포되므로 main 쪽 PR 로 본다")
        elif base != "main":
            lines.append("주의: base 가 %s 다 — 피처 브랜치 PR 의 커밋은 main 에 스쿼시돼 기록에 들어가지 않는다. "
                         "그 브랜치를 main 에 넣은 PR 로 다시 본다" % base)
        return {"lines": lines, "sha": sha, "files": files.splitlines(), "base": base}
    if re.fullmatch(r"[0-9a-fA-F]{7,40}", arg):
        commit = gh_json("api", "repos/{owner}/{repo}/commits/" + arg)
        # ponytail: 커밋 응답의 파일은 첫 300개까지다. 그보다 큰 변경은 PR 번호로 본다
        files = [x for f in commit.get("files") or [] for x in (f["filename"], f.get("previous_filename")) if x]
        lines = ["커밋 %s · %s" % (commit["sha"][:9], kst(commit["commit"]["committer"]["date"])),
                 "  " + commit["commit"]["message"].splitlines()[0]]
        return {"lines": lines, "sha": commit["sha"], "files": files, "base": None}
    raise ValueError("PR 번호나 7자 이상의 커밋 SHA 를 준다: %r" % arg)


def main(argv):
    if len(argv) != 1:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    try:
        found = target(argv[0])
    except Exception as error:
        print("조회 실패 — %s" % error, file=sys.stderr)
        return 1
    files, sha, lines = [f for f in found["files"] if f.strip()], found["sha"], found["lines"]
    reached = reach(files)
    if found["base"] == "release":          # 승격 PR 의 release 머지 커밋은 main 에서 배포하는 단위의 기록에 들어가지 않는다
        reached.update([("dev " + service, False) for service in DEV] + [("백오피스", False)])
    names = ["%s(%s)" % (k, ", ".join(v)) if isinstance(v, list) else k for k, v in reached.items() if v]
    lines.append("닿는 단위: %s · 변경 파일 %d개" % (", ".join(names) or "없음", len(set(files))))
    app = {f for f in files if f.startswith("app/")}
    if app:
        lines.append("앱 변경 %d파일 — 앱은 이 표에 없다(스토어·OTA)" % len(app))
    print("\n".join(lines), flush=True)
    if not sha:
        return 0
    try:
        state = raw("state.json")
    except Exception as error:
        state = error

    def dev(service):
        if isinstance(state, Exception):
            raise state
        return dev_record(state, service)

    jobs = [("dev " + s, lambda s=s: dev(s)) for s in DEV]
    jobs += [(name, lambda r=role, w=workflow, b=branch: prod_record(r, w, b)) for name, role, workflow, branch in PROD]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda job: unit(job[0], reached[job[0]], sha, job[1]), jobs))
    print("\n".join(text for text, _ in results))
    return 0 if all(ok for _, ok in results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
