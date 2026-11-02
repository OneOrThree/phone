"""요청 SHA와 실제 이미지 및 변경 없는 서비스의 혼합 버전 경계."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('target', Path(__file__).with_name('smoke-target.py'))
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)
SHA = 'a' * 40


class TargetTests(unittest.TestCase):
    def test_unchanged_service_may_keep_older_revision(self):
        records = {'data-api': {'revision': SHA}, 'realtime': {'revision': SHA},
                   'business-api': {'revision': 'b' * 40}}
        self.assertEqual(target.target_state({'revision': SHA, 'services': ['data-api', 'realtime']},
                                            records, lambda *_: False), 'matched')

    def test_proven_later_revision_is_superseded(self):
        self.assertEqual(target.target_state({'revision': SHA, 'services': ['data-api']},
                         {'data-api': {'revision': 'b' * 40}}, lambda *_: True), 'superseded')

    def test_unknown_or_unrelated_revision_fails(self):
        for actual in ('', 'latest', 'b' * 40):
            with self.subTest(actual=actual), self.assertRaises(ValueError):
                target.target_state({'revision': SHA, 'services': ['data-api']},
                                    {'data-api': {'revision': actual}}, lambda *_: False)

    def test_invalid_plan_cannot_silently_skip(self):
        with self.assertRaises(ValueError):
            target.target_state({'revision': SHA, 'services': ['other']}, {}, lambda *_: True)

    def test_automatic_execution_rejects_missing_plan(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {'RUNNER_TEMP': directory, 'GITHUB_EVENT_NAME': 'push',
                                     'GITHUB_SHA': SHA, 'SMOKE_TARGET_PLAN': ''}), \
             patch.object(target, 'inspect_targets', return_value={}), \
             patch.object(target.sys, 'argv', ['smoke-target.py']), self.assertRaises(ValueError):
            target.main()

    def test_dispatch_with_plan_checks_requested_target(self):
        records = {'data-api': {'revision': 'a' * 40}}
        plan = json.dumps({'revision': 'b' * 40, 'services': ['data-api']})
        with tempfile.TemporaryDirectory() as directory, patch.object(target, 'inspect_targets', return_value=records), \
                patch.dict(os.environ, {'RUNNER_TEMP': directory, 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                                        'SMOKE_TARGET_PLAN': plan}), \
                self.assertRaisesRegex(ValueError, '일치하지 않음'):
            target.main()

    def test_failed_revision_check_still_preserves_actual_image_evidence(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(os.environ, {'RUNNER_TEMP': directory, 'GITHUB_EVENT_NAME': 'push',
                                     'GITHUB_SHA': SHA, 'SMOKE_TARGET_PLAN': json.dumps({'revision': SHA, 'services': ['data-api']})}), \
             patch.object(target, 'inspect_targets', return_value={'data-api': {'revision': ''}}), \
             patch.object(target.sys, 'argv', ['smoke-target.py']):
            with self.assertRaises(ValueError):
                target.main()
            saved = json.loads((Path(directory) / 'smoke-results/targets.json').read_text())
            self.assertEqual(saved['state'], 'unverified')
            self.assertEqual(saved['services']['data-api']['revision'], '')
