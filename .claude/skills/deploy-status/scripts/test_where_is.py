"""where_is 판정과 출력을 고정 응답(fixtures/pr1543.json)으로 확인한다. 네트워크를 쓰지 않는다.

    python3 -m unittest discover -s .claude/skills/deploy-status/scripts -v

닿음 판정은 저장소의 실제 규칙 파일(dev-fingerprint-V2.py · prod-impact.py · catus-plan.py)을 불러 확인한다.
"""
import copy
import io
import json
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import where_is

WORLD = json.loads((Path(__file__).with_name("fixtures") / "pr1543.json").read_text(encoding="utf-8"))["responses"]
R = "repos/{owner}/{repo}/"
MERGE = "106ea4a85ebe8b1e76725b7e87a96593914ddf8b"


class Fake:
    """gh 대역 — 호출의 «repos/…» 경로로 고정 응답을 돌려준다. 없는 경로는 404 처럼 실패한다."""

    def __init__(self, responses):
        self.responses = responses

    def __call__(self, *args):
        endpoint = next(a for a in args if a.startswith("repos/"))
        if endpoint not in self.responses:
            raise RuntimeError("HTTP 404 " + endpoint)
        reply = self.responses[endpoint]
        return reply if isinstance(reply, str) else json.dumps(reply)


def run(arg, responses=None):
    real, out, err = where_is.gh, io.StringIO(), io.StringIO()
    where_is.gh = Fake(WORLD if responses is None else responses)
    where_is.contains.cache_clear()
    try:
        with redirect_stdout(out), redirect_stderr(err):
            code = where_is.main([arg])
    finally:
        where_is.gh = real
        where_is.contains.cache_clear()
    return code, out.getvalue().splitlines(), err.getvalue()


def world():
    return copy.deepcopy(WORLD)


def unit_line(lines, name):
    return next(line for line in lines if line.startswith(name + " — "))


class Pr1543(unittest.TestCase):
    def test_docs_only_data_api_change_reached_dev_only(self):
        code, lines, err = run("1543")
        self.assertEqual(code, 0, err)
        self.assertEqual(lines[0], "PR #1543 머지됨 → main · 머지 커밋 106ea4a85 · 2026-11-02 20:06 KST")
        self.assertIn("닿는 단위: dev data-api · 변경 파일 13개", lines)
        self.assertEqual(unit_line(lines, "dev data-api"), "dev data-api — 반영됨 — 기록 106ea4a85(포함) · 2026-11-02 20:36 KST")
        self.assertEqual(unit_line(lines, "dev realtime"), "dev realtime — 해당 없음 — 기록 106ea4a85(포함) · 2026-11-02 20:36 KST")
        self.assertEqual(unit_line(lines, "dev business-api"),
                         "dev business-api — 해당 없음 — 기록 8045104e1(미포함) · 2026-11-02 14:35 KST")
        self.assertEqual(unit_line(lines, "운영 서버"),
                         "운영 서버 — 해당 없음 — 기록 catus-v2.0.5-V2 = ed6beb309(미포함) · 2026-11-02 15:38 KST"
                         " · 최근 실행 success 2026-11-02 16:25 KST")
        self.assertEqual(len([line for line in lines if " — 기록 " in line]), 8)

    def test_unmerged_pr_prints_only_the_header(self):
        responses = world()
        responses[R + "pulls/1543"].update(state="open", merged_at=None)
        code, lines, err = run("#1543", responses)
        self.assertEqual(code, 0, err)
        self.assertEqual(lines[0], "PR #1543 열림 → main · 머지되지 않았다")
        self.assertFalse([line for line in lines if " — 기록 " in line])

    def test_failed_dev_record_is_unknown(self):
        responses = world()
        responses[R + "contents/state.json?ref=deployment-status"]["dev/business-api"]["result"] = "failure"
        code, lines, err = run("1543", responses)
        self.assertEqual(code, 1)
        self.assertEqual(unit_line(lines, "dev business-api"),
                         "dev business-api — 확인 못 함 — 마지막 기록이 failure(8045104e1)다 — 마지막 성공 배포는 이 기록으로 알 수 없다")

    def test_missing_record_is_unknown(self):
        responses = world()
        del responses[R + "git/ref/tags/redis-v1.0.4-V2"]
        code, lines, err = run("1543", responses)
        self.assertEqual(code, 1)
        self.assertTrue(unit_line(lines, "Redis").startswith("Redis — 확인 못 함 — HTTP 404"))

    def test_waiting_server_cd_blocks_app_gate(self):
        responses = world()
        waiting = {"workflow_runs": [{"status": "waiting", "conclusion": None, "created_at": "2026-11-02T13:00:00Z"}]}
        responses[R + "actions/workflows/prod-cd-V2.yml/runs?branch=release&per_page=1"] = waiting
        responses[R + "actions/workflows/kafka-cd.prod-V2.yml/runs?branch=release&per_page=1"] = waiting
        code, lines, err = run("1543", responses)
        self.assertTrue(unit_line(lines, "운영 서버").endswith(
            "최근 실행 waiting 2026-11-02 22:00 KST — 다음 성공 실행까지 앱 출시 게이트가 막는다"))
        self.assertTrue(unit_line(lines, "Kafka").endswith("최근 실행 waiting 2026-11-02 22:00 KST"))

    def test_release_pr_skips_units_deployed_from_main(self):
        responses = world()
        responses[R + "pulls/1543"]["base"]["ref"] = "release"
        responses[R + "pulls/1543/files?per_page=100"] = "server/data-api/src/main/java/A.java\nbackoffice/server/app.mjs\n"
        code, lines, err = run("1543", responses)
        self.assertIn("release 대상 PR — dev·백오피스는 main 머지로 배포되므로 main 쪽 PR 로 본다", lines)
        self.assertIn("닿는 단위: 운영 서버(data-api) · 변경 파일 2개", lines)
        self.assertTrue(unit_line(lines, "dev data-api").startswith("dev data-api — 해당 없음"))
        self.assertTrue(unit_line(lines, "백오피스").startswith("백오피스 — 해당 없음"))
        self.assertTrue(unit_line(lines, "운영 서버").startswith("운영 서버 — 아직 안 감"))

    def test_feature_branch_pr_is_flagged(self):
        responses = world()
        responses[R + "pulls/1543"]["base"]["ref"] = "bfeat/GROMO-1-epic"
        code, lines, err = run("1543", responses)
        self.assertTrue(lines[2].startswith("주의: base 가 bfeat/GROMO-1-epic 다"))

    def test_commit_input_uses_commit_files_and_old_paths(self):
        responses = world()
        responses[R + "commits/106ea4a85"] = {
            "sha": MERGE, "commit": {"committer": {"date": "2026-11-02T11:06:07Z"}, "message": "[CHORE] 제목 (#1543)\n\n본문"},
            "files": [{"filename": "server/data-api/README.md"},
                      {"filename": "docs/moved.md", "previous_filename": "backoffice/server/old.mjs"},
                      {"filename": "app/app-dev/src/App.tsx"}]}
        code, lines, err = run("106ea4a85", responses)
        self.assertEqual(code, 0, err)
        self.assertEqual(lines[:2], ["커밋 106ea4a85 · 2026-11-02 20:06 KST", "  [CHORE] 제목 (#1543)"])
        self.assertIn("닿는 단위: dev data-api, 백오피스 · 변경 파일 4개", lines)
        self.assertIn("앱 변경 1파일 — 앱은 이 표에 없다(스토어·OTA)", lines)
        self.assertTrue(unit_line(lines, "백오피스").startswith("백오피스 — 아직 안 감"))

    def test_bad_arguments(self):
        code, lines, err = run("xyz")
        self.assertEqual(code, 1)
        self.assertIn("PR 번호나 7자 이상의 커밋 SHA", err)
        with redirect_stderr(io.StringIO()):
            self.assertEqual(where_is.main([]), 2)


class Reach(unittest.TestCase):
    CASES = [
        # (변경 파일, 닿는 단위) — 운영 서버는 닿는 서비스 목록
        ("server/data-api/README.md", {"dev data-api"}),
        ("server/data-api/src/main/java/A.java", {"dev data-api", "운영 서버:data-api"}),
        ("server/realtime/src/main/java/A.java", {"dev realtime", "운영 서버:realtime"}),
        ("server/notification/src/main/resources/db/migration/V9__x.sql", {"dev notification", "운영 서버:notification"}),
        (".dockerignore", {"dev data-api", "dev realtime", "dev business-api", "dev notification",
                           "운영 서버:business-api", "운영 서버:data-api", "운영 서버:notification", "운영 서버:realtime"}),
        (".github/workflows/satellite-ci.dev-v2.yml", {"dev business-api", "dev notification"}),
        (".github/workflows/data-api-ci.dev-v2.yml", {"dev data-api", "dev realtime"}),
        ("backoffice/server/app.mjs", {"백오피스"}),
        ("backoffice/README.md", set()),
        ("server/scripts/v2/prod/kafka-V2.yml", {"Kafka"}),
        ("server/scripts/v2/prod/redis-V2.conf", {"Redis"}),
        ("server/scripts/v2/dev/kafka/compose.yml", set()),
        ("app/app-dev/src/App.tsx", set()),
        ("docs/engineering/pipeline-map.md", set()),
    ]

    def names(self, files):
        found = set()
        for unit, value in where_is.reach(files).items():
            self.assertIsNotNone(value, unit)
            if isinstance(value, list):
                found |= {"%s:%s" % (unit, service) for service in value}
            elif value:
                found.add(unit)
        return found

    def test_repository_rules(self):
        for path, expected in self.CASES:
            self.assertEqual(self.names([path]), expected, path)

    def test_copied_rules_match_prod_impact(self):
        """백오피스·Kafka·Redis 의 경로 조건은 prod-impact 규칙 3·4 를 옮겨 왔다 — 같은 판정인지 대조한다."""
        impact = where_is.load(where_is.PROD_IMPACT)
        self.assertEqual(where_is.FILES_JQ, impact.FILES_JQ)
        markers = {"백오피스": "운영 백오피스 배포", "Kafka": "kafka 새 태그", "Redis": "redis 새 태그"}
        for path, _ in self.CASES:
            found = impact.impacts(str(where_is.ROOT), [path])
            reached = where_is.reach([path])
            for unit, marker in markers.items():
                self.assertEqual(reached[unit], any(marker in line for line in found), (path, unit))
            self.assertEqual(bool(reached["운영 서버"]), any(line.startswith("운영 서버 재빌드 대상") for line in found), path)

    def test_missing_rule_file_is_none(self):
        real = where_is.DEV_FINGERPRINT
        try:
            where_is.DEV_FINGERPRINT = ".github/scripts/v2/dev/없는-파일.py"
            self.assertIsNone(where_is.reach(["server/data-api/README.md"])["dev data-api"])
        finally:
            where_is.DEV_FINGERPRINT = real


class Pieces(unittest.TestCase):
    def test_verdict(self):
        self.assertEqual(where_is.verdict(True, True), "반영됨")
        self.assertEqual(where_is.verdict(["data-api"], False), "아직 안 감")
        self.assertEqual(where_is.verdict([], True), "해당 없음")
        self.assertEqual(where_is.verdict(False, False), "해당 없음")
        self.assertEqual(where_is.verdict(None, True), "닿음 판정 못 함")

    def test_peel_follows_annotated_tags(self):
        self.assertEqual(where_is.peel({"object": {"type": "commit", "sha": "c1"}}, self.fail), "c1")
        tags = {"t1": {"object": {"type": "tag", "sha": "t2"}}, "t2": {"object": {"type": "commit", "sha": "c2"}}}
        self.assertEqual(where_is.peel({"object": {"type": "tag", "sha": "t1"}}, tags.get), "c2")
        loop = {"t1": {"object": {"type": "tag", "sha": "t1"}}}
        self.assertRaises(ValueError, where_is.peel, {"object": {"type": "tag", "sha": "t1"}}, loop.get)

    def test_dev_record(self):
        state = {"dev/data-api": {"result": "success", "revision": MERGE, "finished_at": "2026-11-02T11:36:40+00:00"}}
        self.assertEqual(where_is.dev_record(state, "data-api"), ("106ea4a85", MERGE, "2026-11-02T11:36:40+00:00", ""))
        self.assertRaises(ValueError, where_is.dev_record, state, "realtime")

    def test_kst(self):
        self.assertEqual(where_is.kst("2026-11-02T06:38:37Z"), "2026-11-02 15:38 KST")
        self.assertEqual(where_is.kst("2026-11-02T11:36:40.088145+00:00"), "2026-11-02 20:36 KST")
        self.assertEqual(where_is.kst(""), "시각 모름")


if __name__ == "__main__":
    unittest.main()
