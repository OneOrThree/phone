#!/usr/bin/env python3
"""PR 머지 4조건을 같은 head 커밋에서 판정하고, 여러 PR 을 감시한다.

    python3 pr_state.py <PR번호>             # 네 줄이 모두 OK 면 exit 0, 하나라도 NO 거나 조회가 실패하면 exit 1
    python3 pr_state.py --watch <목록 파일>   # 90초마다 PR 마다 한 줄, 바뀐 줄만 낸다

조건의 정본은 docs/conventions/git-pr-conventions.md 의 머지 조건이다. 판정은 judge() 한 곳이다.
① 해결 안 된 리뷰 스레드 중 마지막 댓글이 PR 작성자가 아닌 것이 0개
② head 에 대한 리뷰어 판정이 있다 — codex 요약 댓글의 codex-review-state 가 head 커밋을 completed·발견 없음으로 끝냈거나,
   head 커밋 시각 뒤에 만든 `**Claude finished` 댓글이 있다(산문은 사람이 읽는다).
   요약 상태가 있으면 codex 는 그 커밋 SHA 로만 가른다 — push 중에 끝난 옛 리뷰의 👍 를 head 판정으로 세지 않는다.
   요약 상태가 없는 옛 PR 만 head 커밋 시각 뒤의 codex 👍 를 센다
③ 검사가 1개 이상이고 모두 끝났으며 결과가 SUCCESS·NEUTRAL·SKIPPED
④ mergeStateStatus == CLEAN
감시: 목록 파일에는 PR 번호를 공백이나 줄바꿈으로 나눠 적는다. 머지·닫힘은 한 번 알리고 목록에서 뺀다. 목록이 비면 끝난다.
조회만 한다. 저장소는 이 체크아웃의 gh 기본 저장소다. 다른 저장소는 GH_REPO=owner/repo 로 준다.
"""
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
INTERVAL = 90
KST = timezone(timedelta(hours=9))
CODEX = "chatgpt-codex-connector"
CLAUDE = "claude"
CODEX_STATE = re.compile(r"<!-- codex-review-state:v1 (\{.*?\}) -->")
CLAUDE_ERROR = re.compile(r"\*\*Claude encountered an error after ([^*]+)\*\*")
PASS = ("SUCCESS", "NEUTRAL", "SKIPPED")
QUERY = """query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
state mergeStateStatus baseRefName author{login}
reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path comments(last:1){nodes{author{login}}}}}
reactions(content:THUMBS_UP,last:50){nodes{user{login} createdAt}}
commits(last:1){nodes{commit{oid committedDate statusCheckRollup{contexts(first:100){pageInfo{hasNextPage}
nodes{__typename ... on CheckRun{name status conclusion} ... on StatusContext{context state}}}}}}}}}}"""


def ts(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))     # 3.9 의 fromisoformat 은 Z 를 못 읽는다


def kst(text):
    return ts(text).astimezone(KST).strftime("%m-%d %H:%M KST")


def bot(login, name):
    """REST 는 «이름[bot]», GraphQL 은 «이름» 으로 줄 때가 있다."""
    return (login or "").split("[")[0] == name


# ── 판정 ────────────────────────────────────────────────────────────────────

def threads(pr):
    label = "① 미답변 루트 스레드 0"
    found = pr["reviewThreads"]
    if found["pageInfo"]["hasNextPage"]:    # ponytail: 스레드는 100개까지만 본다. 넘으면 NO 로 알리고 웹에서 센다
        return label, False, "스레드가 100개를 넘는다 — 웹에서 센다"
    author = (pr.get("author") or {}).get("login")
    unanswered = []
    for thread in found["nodes"]:
        last = thread["comments"]["nodes"]
        if not thread["isResolved"] and last and (last[-1].get("author") or {}).get("login") != author:
            unanswered.append(thread.get("path") or "?")
    return label, not unanswered, "%d건%s" % (len(unanswered), " — " + ", ".join(unanswered[:3]) if unanswered else "")


def verdict(head, head_time, comments, thumbs):
    """② — comments 는 REST issue 댓글(만든 순서), thumbs 는 PR 본문의 👍.

    ponytail: claude·👍 는 head 커밋 시각과 비교한다. 오래전에 만든 커밋을 나중에 push 하면 그 사이의 옛 판정이 섞인다.
    codex 는 커밋 SHA 로 가르므로 이 한계가 없다.
    """
    label = "② head 이후 리뷰어 판정"

    def after(text):
        return ts(text) > ts(head_time)

    state, finished, last = None, 0, None
    for comment in comments:
        login, body = comment["user"]["login"], comment.get("body") or ""
        found = CODEX_STATE.search(body) if bot(login, CODEX) else None
        if found:
            try:
                state = json.loads(found.group(1)).get("code_review") or {}
            except ValueError:
                pass
        elif bot(login, CLAUDE):
            done = body.startswith("**Claude finished")
            error = CLAUDE_ERROR.search(body[:200])
            last = "완료" if done else "오류 %s" % error.group(1) if error else "진행 중"
            if done and after(comment["created_at"]):
                finished += 1

    thumbs_after = sum(1 for r in thumbs if bot((r.get("user") or {}).get("login"), CODEX) and after(r["createdAt"]))
    if state is None:
        codex_ok, codex = thumbs_after > 0, "codex 요약 없음"
    else:
        sha, status = state.get("commit_sha") or "", state.get("status")
        codex_ok = sha == head and status == "completed" and state.get("has_any_findings") is False
        if sha != head:
            codex = "codex 옛 커밋 %s(%s)" % (sha[:9] or "?", status)
        elif codex_ok:
            codex = "codex head 깨끗"
        else:
            codex = "codex head %s" % ("지적 있음" if state.get("has_any_findings") else status)
    codex += " · 👍 head 뒤 %d" % thumbs_after
    claude = "claude 없음" if last is None else "claude head 뒤 완료 %d · 마지막 %s" % (finished, last)
    if last == "오류 0s":
        claude += "(인증 거절 의심)"
    return label, codex_ok or finished > 0, "head %s(%s) · %s · %s" % (head[:9], kst(head_time), codex, claude)


def checks(rollup):
    label = "③ CI 전부 통과"
    contexts = (rollup or {}).get("contexts") or {"nodes": [], "pageInfo": {}}
    if contexts["pageInfo"].get("hasNextPage"):     # ponytail: 검사는 100개까지만 본다. 넘으면 NO 로 알린다
        return label, False, "검사가 100개를 넘는다 — 웹에서 본다"
    passed, waiting, failed = 0, 0, []
    for check in contexts["nodes"]:
        if check["__typename"] == "CheckRun":
            done, result = check.get("status") == "COMPLETED", check.get("conclusion")
        else:                                           # StatusContext
            done, result = check.get("state") not in ("PENDING", "EXPECTED"), check.get("state")
        if not done:
            waiting += 1
        elif result in PASS:
            passed += 1
        else:
            failed.append("%s=%s" % (check.get("name") or check.get("context"), result))
    total = len(contexts["nodes"])
    detail = "통과 %d/%d" % (passed, total) + (" · 대기 %d" % waiting if waiting else "") \
        + (" · 실패 " + ", ".join(failed[:3]) if failed else "")
    return label, total > 0 and passed == total, detail


def judge(pr, comments):
    """[(조건, 통과, 설명)] 네 줄. pr 은 QUERY 의 pullRequest, comments 는 REST issue 댓글이다."""
    commit = pr["commits"]["nodes"][0]["commit"]
    return [threads(pr),
            verdict(commit["oid"], commit["committedDate"], comments, pr["reactions"]["nodes"]),
            checks(commit.get("statusCheckRollup")),
            ("④ mergeStateStatus CLEAN", pr["mergeStateStatus"] == "CLEAN", pr["mergeStateStatus"])]


def report(n, pr, rows):
    """판정 네 줄과 요약 줄. 요약 줄의 head 는 전체 SHA 다 — `gh pr merge --match-head-commit` 에 그대로 쓴다."""
    lines = ["%s %s — %s" % ("OK" if ok else "NO", label, detail) for label, ok, detail in rows]
    lines.append("PR #%d %s → %s · head %s · %d/4" % (n, pr["state"], pr["baseRefName"],
                                                      pr["commits"]["nodes"][0]["commit"]["oid"], sum(ok for _, ok, _ in rows)))
    return lines


def watch_line(n, pr, rows):
    passed = sum(ok for _, ok, _ in rows)
    parts = ["%s%s(%s)" % (label.split()[0], "OK" if ok else "NO", detail) for label, ok, detail in rows]
    end = " → 4조건 충족" if passed == 4 and pr["state"] == "OPEN" else ""
    return "#%d %s %d/4 · %s%s" % (n, pr["state"], passed, " ".join(parts), end)


# ── 조회 ────────────────────────────────────────────────────────────────────

def gh(*args):
    done = subprocess.run(["gh"] + list(args), cwd=str(ROOT), capture_output=True, text=True, timeout=60)
    if done.returncode:
        lines = [x for x in done.stderr.splitlines() if x.strip()]
        raise RuntimeError(lines[-1] if lines else "gh 종료 코드 %d" % done.returncode)
    return done.stdout


def fetch(n):
    data = json.loads(gh("api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", "n=%d" % n,
                         "-f", "query=" + QUERY))
    pr = data["data"]["repository"]["pullRequest"]
    lines = gh("api", "--paginate", "repos/{owner}/{repo}/issues/%d/comments?per_page=100" % n, "--jq", ".[] | tojson")
    return pr, [json.loads(line) for line in lines.splitlines() if line.strip()]


def look(n):
    pr, comments = fetch(n)
    return pr, judge(pr, comments)


# ── 감시 ────────────────────────────────────────────────────────────────────

def read_list(path):
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    return list(dict.fromkeys(int(x.lstrip("#")) for x in text.split() if x.lstrip("#").isdigit()))


def drop(path, n):
    """ponytail: 다시 읽고 바로 쓴다. 그 사이에 다른 쪽이 덧붙인 번호는 잃을 수 있다."""
    path.write_text("".join("%d\n" % x for x in read_list(path) if x != n), encoding="utf-8")


def watch_once(path, last, look=look):
    """한 바퀴 돌고 낼 줄 목록을 돌려준다. last 는 PR 마다 마지막으로 낸 줄이다."""
    out = []
    for n in read_list(path):
        try:
            pr, rows = look(n)
            done = pr["state"] in ("MERGED", "CLOSED")
            line = watch_line(n, pr, rows) + (" — 목록에서 뺐다" if done else "")
        except Exception as error:      # 일시 오류 — 바뀌었을 때만 알리고 다음 바퀴에 다시 본다
            done, line = False, "#%d 조회 실패 — %s" % (n, error)
        if last.get(n) != line:
            out.append(line)
        last[n] = line
        if done:
            drop(path, n)
            last.pop(n, None)
    return out


def watch(path, sleep=time.sleep):
    last = {}
    while True:
        for line in watch_once(path, last):
            print(line, flush=True)
        if not read_list(path):
            print("감시할 PR 이 없다 — 끝낸다", flush=True)
            return 0
        sleep(INTERVAL)


def main(argv):
    if len(argv) == 2 and argv[0] == "--watch":
        return watch(Path(argv[1]))
    if len(argv) == 1 and argv[0].lstrip("#").isdigit():
        n = int(argv[0].lstrip("#"))
        try:
            pr, rows = look(n)
        except Exception as error:
            print("PR #%d 조회 실패 — %s" % (n, error), file=sys.stderr)
            return 1
        print("\n".join(report(n, pr, rows)))
        return 0 if all(ok for _, ok, _ in rows) else 1
    print(__doc__.split("\n\n")[1], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
