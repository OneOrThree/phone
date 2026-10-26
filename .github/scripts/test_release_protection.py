"""승격 이력을 보존하는 보호 정책과 변경 전 상태 검증을 검사한다."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('protection', Path(__file__).with_name('release-protection.py'))
protection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protection)
POLICY = json.loads(protection.POLICY.read_text())


def snapshot(current=None, **changes):
    return {'repository': 'OneOrThree/phone', 'branch': 'release', 'allow_merge_commit': True,
            'protection': current, 'rules': [], **changes}


class FakeAPI:
    def __init__(self, before):
        self.current = copy.deepcopy(before)
        self.writes = []

    def request(self, path, method='GET', payload=None, missing_ok=False):
        if method == 'PUT':
            self.writes.append((path, payload))
            self.current['protection'] = copy.deepcopy(payload)
            return payload
        if path == '':
            return {'allow_merge_commit': self.current['allow_merge_commit']}
        if path.endswith('/protection'):
            return self.current['protection']
        if path.startswith('/rules/'):
            return self.current['rules']
        return {'name': 'release'}


class ProtectionTests(unittest.TestCase):
    def test_offline_cli_creates_plan_without_github_cli(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'snapshot.json'
            output = Path(directory) / 'plan.json'
            source.write_text(json.dumps(snapshot()))
            result = subprocess.run([sys.executable, protection.__file__, '--snapshot', str(source),
                                     '--output', str(output)], env={**os.environ, 'PATH': directory},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('GitHub 설정 변경 없음', result.stdout)
            self.assertEqual(json.loads(output.read_text())['before'], snapshot())

    def test_unprotected_branch_requires_pr_without_new_ci_gate(self):
        result = protection.desired(snapshot(), POLICY)
        self.assertIsNotNone(result['required_pull_request_reviews'])
        self.assertEqual(result['required_pull_request_reviews']['required_approving_review_count'], 0)
        self.assertIsNone(result['required_status_checks'])
        self.assertTrue(result['enforce_admins'])
        self.assertTrue(result['required_conversation_resolution'])
        self.assertFalse(result['allow_force_pushes'])
        self.assertFalse(result['allow_deletions'])
        self.assertFalse(result['required_linear_history'])

    def test_preserves_existing_checks_and_stronger_review_and_push_restrictions(self):
        current = {'required_status_checks': {'strict': True, 'contexts': ['contracts'],
                   'checks': [{'context': 'contracts', 'app_id': 42}]},
                   'restrictions': {'users': [{'login': 'owner'}], 'teams': [{'slug': 'ops'}], 'apps': []},
                   'required_pull_request_reviews': {'required_approving_review_count': 2,
                       'require_code_owner_reviews': True, 'require_last_push_approval': True,
                       'bypass_pull_request_allowances': {'users': [{'login': 'bypass'}]}}}
        original = copy.deepcopy(current)
        result = protection.desired(snapshot(current), POLICY)
        self.assertEqual(result['required_status_checks']['checks'], [{'context': 'contracts', 'app_id': 42}])
        self.assertEqual(result['restrictions']['teams'], ['ops'])
        reviews = result['required_pull_request_reviews']
        self.assertEqual(reviews['required_approving_review_count'], 2)
        self.assertTrue(reviews['require_code_owner_reviews'])
        self.assertTrue(reviews['require_last_push_approval'])
        self.assertEqual(reviews['bypass_pull_request_allowances']['users'], [])
        self.assertEqual(current, original)

    def test_other_repository_or_branch_and_disabled_merge_commit_are_rejected(self):
        for changes in ({'repository': 'other/repo'}, {'branch': 'main'}, {'allow_merge_commit': False}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                protection.desired(snapshot(**changes), POLICY)

    def test_plan_is_read_only_and_apply_verifies_result(self):
        before = snapshot()
        plan = protection.make_plan(before, POLICY)
        self.assertIsNone(before['protection'])
        api = FakeAPI(before)
        after = protection.apply_plan(plan, api)
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(after['protection'], plan['payload'])

    def test_live_drift_prevents_write(self):
        plan = protection.make_plan(snapshot(), POLICY)
        api = FakeAPI(snapshot({'allow_deletions': {'enabled': True}}))
        with self.assertRaisesRegex(ValueError, '설정이 변경됨'):
            protection.apply_plan(plan, api)
        self.assertEqual(api.writes, [])

    def test_tampered_payload_or_snapshot_prevents_write(self):
        for field in ('payload', 'before'):
            plan = protection.make_plan(snapshot(), POLICY)
            plan[field]['branch' if field == 'before' else 'allow_deletions'] = 'main' if field == 'before' else True
            api = FakeAPI(snapshot())
            with self.subTest(field=field), self.assertRaises(ValueError):
                protection.apply_plan(plan, api)
            self.assertEqual(api.writes, [])

    def test_ruleset_is_reported_but_not_overwritten(self):
        before = snapshot(rules=[{'type': 'pull_request', 'ruleset_id': 1}])
        plan = protection.make_plan(before, POLICY)
        api = FakeAPI(before)
        with self.assertRaisesRegex(ValueError, 'ruleset'):
            protection.apply_plan(plan, api)
        self.assertEqual(api.writes, [])
