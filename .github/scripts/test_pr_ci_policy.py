"""실제 workflow의 대상 필터와 승격·수동 검사·발행 경계를 재생한다."""
import fnmatch
import importlib.util
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('policy', Path(__file__).with_name('pr-ci-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def workflow(name):
    return yaml.load((ROOT / '.github/workflows' / (name + '.yml')).read_text(), Loader=yaml.BaseLoader)


def pr(base, head='feature/topic', repo='OneOrThree/phone', labels=()):
    return {'pull_request': {'base': {'ref': base},
                            'head': {'ref': head, 'repo': {'full_name': repo}},
                            'labels': [{'name': name} for name in labels]}}


def accepts_pr(name, base):
    event = workflow(name)['on'].get('pull_request')
    if event is None:
        return False
    included = any(fnmatch.fnmatchcase(base, pattern) for pattern in event.get('branches', ['*']))
    return included and not any(fnmatch.fnmatchcase(base, pattern) for pattern in event.get('branches-ignore', []))


class PolicyTests(unittest.TestCase):
    def test_feature_stack_has_no_automatic_server_functional_workflow(self):
        for name in ['data-api-ci.dev-v2', 'realtime-ci.dev-v2', 'satellite-ci.dev-v2',
                     'prod-ci-V2', 'backoffice-ci']:
            with self.subTest(workflow=name):
                self.assertFalse(accepts_pr(name, 'feat/integration'))
                self.assertTrue(accepts_pr(name, 'main'))

    def test_full_checks_for_main_and_selective_release_but_not_main_promotion(self):
        for event, expected in [(pr('feat/integration'), False), (pr('main'), True),
                                (pr('release', 'main'), False), (pr('release', 'release-backoffice/topic'), True),
                                (pr('release', 'main', 'other/fork'), True)]:
            with self.subTest(event=event):
                self.assertEqual(policy.policy('pull_request', event, 'OneOrThree/phone', '')['full-checks'], expected)

    def test_manual_feature_validation_and_publication_pushes_keep_checks(self):
        for event, ref in [('workflow_dispatch', 'refs/heads/feat/topic'), ('push', 'refs/heads/main'), ('push', 'refs/heads/release')]:
            self.assertTrue(policy.policy(event, {}, 'OneOrThree/phone', ref)['full-checks'])
        self.assertFalse(policy.policy('push', {}, 'OneOrThree/phone', 'refs/heads/feat/topic')['full-checks'])
        for name in ['data-api-ci.dev-v2', 'satellite-ci.dev-v2', 'backoffice-ci']:
            self.assertIn('workflow_dispatch', workflow(name)['on'])
        self.assertIn('workflow_call', workflow('realtime-ci.dev-v2')['on'])

    def test_feature_branch_cannot_publish_v2_dev_images(self):
        for name in ['data-api-ci.dev-v2', 'satellite-ci.dev-v2']:
            condition = workflow(name)['jobs']['images']['if']
            self.assertIn("github.ref == 'refs/heads/main'", condition)
            self.assertIn("github.event_name == 'workflow_dispatch'", condition)
        self.assertNotIn('images', workflow('realtime-ci.dev-v2')['jobs'])

    def test_main_promotion_rejects_conflicting_or_unknown_release_labels(self):
        self.assertEqual(policy.policy('pull_request', pr('release', 'main', labels=['release:minor']),
                                       'OneOrThree/phone', '')['version-bump'], 'minor')
        for labels in [['release:major', 'release:patch'], ['release:other']]:
            with self.assertRaises(ValueError):
                policy.policy('pull_request', pr('release', 'main', labels=labels),
                              'OneOrThree/phone', '', validate_labels=True)

    def test_only_lightweight_label_gate_reruns_when_labels_change(self):
        events = workflow('pr-ci-policy')['on']['pull_request']['types']
        self.assertIn('labeled', events)
        self.assertIn('unlabeled', events)
        step = next(step for step in workflow('pr-ci-policy')['jobs']['policy']['steps']
                    if step.get('id') == 'policy')
        self.assertEqual(step['run'], 'python3 .github/scripts/pr-ci-policy.py --validate-labels')
        # 발행·검사 분류는 라벨과 무관하므로 이전 라벨 스냅샷으로 재실행해도 막히지 않는다.
        self.assertFalse(policy.policy('pull_request', pr('release', 'main', labels=['release:invalid']),
                                       'OneOrThree/phone', '')['full-checks'])
        for name in ['prod-ci-V2']:
            self.assertNotIn('labeled', workflow(name)['on']['pull_request']['types'])

    def test_promotion_skips_nested_data_api_functional_tests(self):
        shared = workflow('satellite-check')
        self.assertEqual(shared['on']['workflow_call']['inputs']['run-functional-tests']['default'], 'true')
        self.assertEqual(shared['jobs']['public-command-contracts']['if'], 'inputs.run-functional-tests')
        candidate = workflow('satellite-ci.prod')['jobs']['checks']['with']['run-functional-tests']
        self.assertIn("github.head_ref == 'main'", candidate)
        self.assertIn('github.event.pull_request.head.repo.full_name == github.repository', candidate)

    def test_production_jobs_consume_the_policy_before_full_gradle_and_images(self):
        jobs = workflow('prod-ci-V2')['jobs']
        self.assertEqual(jobs['verify']['outputs']['full-checks'], '${{ steps.policy.outputs.full-checks }}')
        self.assertIn("needs.verify.outputs.full-checks == 'true'", jobs['checks']['if'])
        self.assertIn("needs.checks.result == 'skipped'", jobs['publish']['if'])

    def test_dev_and_production_publication_routes_are_unchanged(self):
        for name in ['data-api-ci.dev-v2', 'satellite-ci.dev-v2']:
            self.assertEqual(workflow(name)['on']['push']['branches'], ['main'])
        self.assertEqual(workflow('prod-ci-V2')['on']['push']['branches'], ['release'])
        self.assertEqual(set(workflow('prod-cd-V2')['on']), {'workflow_dispatch'})
        auto = workflow('cd-auto.dev-v2')['on']['workflow_run']
        self.assertEqual(auto['branches'], ['main'])
        self.assertIn('Data API CI (dev)-v2', auto['workflows'])


if __name__ == '__main__':
    unittest.main()
