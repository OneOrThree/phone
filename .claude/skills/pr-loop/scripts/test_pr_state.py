"""pr_state 판정을 고정 응답(fixtures/pr1545.json)으로 확인한다. 네트워크를 쓰지 않는다.

    python3 -m unittest discover -s .claude/skills/pr-loop/scripts -v
"""
import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import pr_state

FIXTURE = json.loads((Path(__file__).with_name("fixtures") / "pr1545.json").read_text(encoding="utf-8"))
HEAD = "514c352b4b690e7bb6d1eea92e6a904f4420f72e"


def world():
    """머지된 PR #1545 — codex 요약 상태가 head 를 깨끗하게 끝냈고, claude 는 0초 오류, 검사 13개 통과, UNKNOWN."""
    return copy.deepcopy(FIXTURE["graphql"]), copy.deepcopy(FIXTURE["comments"])


def row(rows, mark):
    return next(r for r in rows if r[0].startswith(mark))


def codex_state(commit_sha, findings=False, status="completed"):
    state = {"code_review": {"commit_sha": commit_sha, "has_any_findings": findings, "status": status}}
    return {"user": {"login": "chatgpt-codex-connector[bot]"}, "created_at": "2026-11-02T12:14:02Z",
            "body": "<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 %s -->" % json.dumps(state)}


def claude(body, created):
    return {"user": {"login": "claude[bot]"}, "created_at": created, "body": body}


class Captured(unittest.TestCase):
    def test_merged_pr_has_three_ok_and_unknown_merge_state(self):
        pr, comments = world()
        rows = pr_state.judge(pr, comments)
        self.assertEqual([ok for _, ok, _ in rows], [True, True, True, False])
        self.assertEqual(row(rows, "②")[2], "head 514c352b4(11-02 21:11 KST) · codex head 깨끗 · 👍 head 뒤 1"
                                            " · claude head 뒤 완료 0 · 마지막 오류 0s(인증 거절 의심)")
        self.assertEqual(row(rows, "③")[2], "통과 13/13")
        self.assertEqual(row(rows, "④")[2], "UNKNOWN")
        self.assertEqual(pr_state.report(1545, pr, rows)[-1], "PR #1545 MERGED → main · head %s · 3/4" % HEAD)


class Threads(unittest.TestCase):
    def thread(self, resolved, last_author, path="a.py"):
        return {"isResolved": resolved, "path": path, "comments": {"nodes": [{"author": {"login": last_author}}]}}

    def test_reviewer_last_word_is_unanswered(self):
        pr, comments = world()
        pr["reviewThreads"]["nodes"] = [self.thread(False, "chatgpt-codex-connector", "app/x.ts"),
                                        self.thread(False, "pr-author"), self.thread(True, "chatgpt-codex-connector")]
        label, ok, detail = row(pr_state.judge(pr, comments), "①")
        self.assertFalse(ok)
        self.assertEqual(detail, "1건 — app/x.ts")

    def test_author_reply_or_resolution_answers(self):
        pr, comments = world()
        pr["reviewThreads"]["nodes"] = [self.thread(False, "pr-author"), self.thread(True, "someone")]
        self.assertTrue(row(pr_state.judge(pr, comments), "①")[1])

    def test_more_than_hundred_threads_is_not_ok(self):
        pr, comments = world()
        pr["reviewThreads"]["pageInfo"]["hasNextPage"] = True
        self.assertFalse(row(pr_state.judge(pr, comments), "①")[1])


class Verdict(unittest.TestCase):
    def judge2(self, comments, thumbs=None, pr=None):
        pr = pr or world()[0]
        if thumbs is not None:
            pr["reactions"]["nodes"] = thumbs
        return row(pr_state.judge(pr, comments), "②")

    def test_codex_state_on_old_commit_is_not_a_verdict_even_with_late_thumbs(self):
        label, ok, detail = self.judge2([codex_state("0" * 40)])       # 픽스처의 👍 는 head 커밋 뒤에 붙었다
        self.assertFalse(ok)
        self.assertIn("codex 옛 커밋 000000000(completed) · 👍 head 뒤 1", detail)

    def test_codex_findings_or_failure_on_head_is_not_clean(self):
        label, ok, detail = self.judge2([codex_state(HEAD, findings=True)])
        self.assertFalse(ok)
        self.assertIn("codex head 지적 있음", detail)
        label, ok, detail = self.judge2([codex_state(HEAD, findings=None, status="failed")])     # 사용 한도 초과 등
        self.assertFalse(ok)
        self.assertIn("codex head failed", detail)
        self.assertFalse(self.judge2([codex_state(HEAD, status="in_progress")])[1])

    def test_claude_finished_after_head_counts(self):
        done = claude("**Claude finished @someone's task in 42s** —— [View job](x)", "2026-11-02T12:30:00Z")
        label, ok, detail = self.judge2([codex_state("0" * 40), done])
        self.assertTrue(ok)
        self.assertIn("claude head 뒤 완료 1 · 마지막 완료", detail)

    def test_claude_finished_before_head_does_not_count(self):
        done = claude("**Claude finished @someone's task in 42s**", "2026-11-02T12:00:00Z")
        self.assertFalse(self.judge2([codex_state("0" * 40), done])[1])

    def test_claude_error_and_running_are_not_verdicts(self):
        comments = [claude("**Claude encountered an error after 1m 2s** —— [View job](x)", "2026-11-02T12:30:00Z")]
        label, ok, detail = self.judge2(comments, thumbs=[])
        self.assertFalse(ok)
        self.assertIn("마지막 오류 1m 2s", detail)
        self.assertNotIn("인증 거절", detail)
        detail = self.judge2([claude("Claude Code is working…", "2026-11-02T12:30:00Z")], thumbs=[])[2]
        self.assertIn("마지막 진행 중", detail)

    def test_legacy_thumbs_after_head_count_only_without_state(self):
        late = [{"user": {"login": "chatgpt-codex-connector[bot]"}, "createdAt": "2026-11-02T12:18:41Z"}]
        early = [{"user": {"login": "chatgpt-codex-connector[bot]"}, "createdAt": "2026-11-02T12:00:00Z"}]
        label, ok, detail = self.judge2([], thumbs=late)
        self.assertTrue(ok)
        self.assertIn("codex 요약 없음 · 👍 head 뒤 1", detail)
        self.assertFalse(self.judge2([], thumbs=early)[1])
        self.assertFalse(self.judge2([], thumbs=[{"user": None, "createdAt": "2026-11-02T12:18:41Z"}])[1])
        self.assertFalse(self.judge2([], thumbs=[{"user": {"login": "someone"}, "createdAt": "2026-11-02T12:18:41Z"}])[1])

    def test_broken_state_json_counts_as_no_state(self):
        broken = {"user": {"login": "chatgpt-codex-connector[bot]"}, "created_at": "2026-11-02T12:14:02Z",
                  "body": "<!-- codex-review-state:v1 {not json} -->"}
        self.assertIn("codex 요약 없음", self.judge2([broken])[2])


class Checks(unittest.TestCase):
    def ci(self, nodes, more=False):
        pr, comments = world()
        contexts = pr["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["contexts"]
        contexts["nodes"], contexts["pageInfo"]["hasNextPage"] = nodes, more
        return row(pr_state.judge(pr, comments), "③")

    def run_(self, status, conclusion=None, name="build"):
        return {"__typename": "CheckRun", "name": name, "status": status, "conclusion": conclusion}

    def test_waiting_failed_cancelled_are_not_all_passed(self):
        label, ok, detail = self.ci([self.run_("COMPLETED", "SUCCESS"), self.run_("IN_PROGRESS")])
        self.assertFalse(ok)
        self.assertEqual(detail, "통과 1/2 · 대기 1")
        label, ok, detail = self.ci([self.run_("COMPLETED", "FAILURE", "lint"), self.run_("COMPLETED", "CANCELLED", "test")])
        self.assertFalse(ok)
        self.assertEqual(detail, "통과 0/2 · 실패 lint=FAILURE, test=CANCELLED")

    def test_neutral_skipped_and_status_contexts(self):
        nodes = [self.run_("COMPLETED", "NEUTRAL"), self.run_("COMPLETED", "SKIPPED"),
                 {"__typename": "StatusContext", "context": "ext", "state": "SUCCESS"}]
        self.assertTrue(self.ci(nodes)[1])
        self.assertFalse(self.ci([{"__typename": "StatusContext", "context": "ext", "state": "PENDING"}])[1])
        self.assertFalse(self.ci([{"__typename": "StatusContext", "context": "ext", "state": "ERROR"}])[1])

    def test_no_checks_or_too_many_is_not_ok(self):
        self.assertFalse(self.ci([])[1])
        self.assertFalse(self.ci([self.run_("COMPLETED", "SUCCESS")], more=True)[1])
        pr, comments = world()
        pr["commits"]["nodes"][0]["commit"]["statusCheckRollup"] = None
        self.assertFalse(row(pr_state.judge(pr, comments), "③")[1])


class Watch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "prs.txt"
        self.states = {}

    def tearDown(self):
        self.tmp.cleanup()

    def look(self, n):
        if self.states[n] == "error":
            raise RuntimeError("HTTP 502")
        pr, comments = world()
        pr["state"], pr["mergeStateStatus"] = self.states[n], "CLEAN" if self.states[n] == "OPEN" else "UNKNOWN"
        return pr, pr_state.judge(pr, comments)

    def test_prints_changes_once_and_drops_merged(self):
        self.path.write_text("#1 2\n2\n", encoding="utf-8")
        self.states = {1: "OPEN", 2: "MERGED"}
        last = {}
        lines = pr_state.watch_once(self.path, last, self.look)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("#1 OPEN 4/4 · ①OK(0건) ②OK(head 514c352b4"))
        self.assertTrue(lines[0].endswith("→ 4조건 충족"))
        self.assertTrue(lines[1].endswith(" — 목록에서 뺐다"))
        self.assertEqual(pr_state.read_list(self.path), [1])
        self.assertEqual(pr_state.watch_once(self.path, last, self.look), [])      # 바뀐 것이 없으면 조용하다
        self.states[1] = "error"
        self.assertEqual(pr_state.watch_once(self.path, last, self.look), ["#1 조회 실패 — HTTP 502"])
        self.assertEqual(pr_state.watch_once(self.path, last, self.look), [])      # 같은 오류는 한 번만
        self.states[1] = "CLOSED"
        self.assertEqual(len(pr_state.watch_once(self.path, last, self.look)), 1)
        self.assertEqual(pr_state.read_list(self.path), [])

    def test_watch_ends_when_list_is_empty(self):
        self.path.write_text("", encoding="utf-8")
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(pr_state.watch(self.path, sleep=self.fail), 0)
        self.assertEqual(out.getvalue(), "감시할 PR 이 없다 — 끝낸다\n")
        self.assertEqual(pr_state.read_list(Path(self.tmp.name) / "missing.txt"), [])


class Main(unittest.TestCase):
    def test_exit_codes(self):
        real, out = pr_state.look, io.StringIO()

        def missing(n):
            raise RuntimeError("HTTP 404")
        try:
            with redirect_stdout(out), redirect_stderr(out):
                pr_state.look = missing
                self.assertEqual(pr_state.main(["1"]), 1)                    # 조회 실패
                pr_state.look = lambda n: (world()[0], pr_state.judge(*world()))
                self.assertEqual(pr_state.main(["1545"]), 1)                 # ④ UNKNOWN
                pr_state.look = lambda n: self.clean()
                self.assertEqual(pr_state.main(["#1545"]), 0)
                self.assertEqual(pr_state.main([]), 2)
        finally:
            pr_state.look = real
        self.assertIn("PR #1 조회 실패 — HTTP 404", out.getvalue())

    def clean(self):
        pr, comments = world()
        pr["state"], pr["mergeStateStatus"] = "OPEN", "CLEAN"
        return pr, pr_state.judge(pr, comments)


if __name__ == "__main__":
    unittest.main()
