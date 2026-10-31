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
        for name in ['data-api-ci.dev', 'realtime-ci.dev', 'satellite-ci.dev',
                     'prod-ci', 'prod-ci-V2', 'backoffice-ci']:
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
        for event, ref in [('workflow_dispatch', 'refs/heads/feat/topic'),
                           ('push', 'refs/heads/main'), ('push', 'refs/heads/release')]:
            self.assertTrue(policy.policy(event, {}, 'OneOrThree/phone', ref)['full-checks'])
        self.assertFalse(policy.policy('push', {}, 'OneOrThree/phone', 'refs/heads/feat/topic')['full-checks'])
        for name in ['data-api-ci.dev', 'realtime-ci.dev', 'satellite-ci.dev', 'backoffice-ci']:
            self.assertIn('workflow_dispatch', workflow(name)['on'])

    def test_manual_functional_tests_do_not_build_or_publish_dev_images(self):
        for name, job in [('data-api-ci.dev', 'build'), ('realtime-ci.dev', 'docker-build'),
                          ('satellite-ci.dev', 'images')]:
            self.assertEqual(workflow(name)['jobs'][job]['if'], "github.event_name != 'workflow_dispatch'")
        core = workflow('data-api-ci.dev')['jobs']
        for job in ['realtime', 'deploy']:
            self.assertIn("github.event_name == 'push'", core[job]['if'])
            self.assertIn("github.ref == 'refs/heads/main'", core[job]['if'])

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
        for name in ['prod-ci', 'prod-ci-V2']:
            self.assertNotIn('labeled', workflow(name)['on']['pull_request']['types'])

    def test_promotion_skips_nested_data_api_functional_tests(self):
        shared = workflow('satellite-check')
        self.assertEqual(shared['on']['workflow_call']['inputs']['run-functional-tests']['default'], 'true')
        self.assertEqual(shared['jobs']['public-command-contracts']['if'], 'inputs.run-functional-tests')
        candidate = workflow('satellite-ci.prod')['jobs']['checks']['with']['run-functional-tests']
        self.assertIn("github.head_ref == 'main'", candidate)
        self.assertIn('github.event.pull_request.head.repo.full_name == github.repository', candidate)

    def test_production_jobs_consume_the_policy_before_full_gradle_and_images(self):
        prod = workflow('prod-ci')['jobs']
        self.assertEqual(prod['contracts']['outputs']['full-checks'], '${{ steps.policy.outputs.full-checks }}')
        self.assertTrue(any(step.get('run') == 'python3 .github/scripts/pr-ci-policy.py'
                            for step in prod['contracts']['steps']))
        for name in ['checks', 'images']:
            self.assertIn("needs.contracts.outputs.full-checks == 'true'", prod[name]['if'])
        v2 = workflow('prod-ci-V2')['jobs']
        self.assertEqual(v2['verify']['outputs']['full-checks'], '${{ steps.policy.outputs.full-checks }}')
        self.assertIn("needs.verify.outputs.full-checks == 'true'", v2['checks']['if'])
        self.assertIn("needs.checks.result == 'skipped'", v2['publish']['if'])

    def test_dev_and_production_publication_routes_are_unchanged(self):
        for name in ['data-api-ci.dev', 'satellite-ci.dev']:
            self.assertEqual(workflow(name)['on']['push']['branches'], ['main'])
        for name in ['prod-ci', 'prod-ci-V2']:
            self.assertEqual(workflow(name)['on']['push']['branches'], ['release'])
        source = workflow('satellite-cd.dev')['jobs']['plan']['if']
        self.assertIn("github.event.workflow_run.event == 'push'", source)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", source)
        for name in ['prod-cd', 'prod-cd-V2']:
            self.assertIn('workflow_dispatch', workflow(name)['on'])
            self.assertNotIn('push', workflow(name)['on'])


if __name__ == '__main__':
    unittest.main()
