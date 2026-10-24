"""독립 CI/CD의 원본 실행·AAB·버전 충돌 신뢰 경계를 검사한다."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


artifact = module('android-artifact')
source = module('android-cd-source')
bundle = module('play-verify-bundle')
SHA = 'a' * 40


class AndroidPipelineTests(unittest.TestCase):
    def run_record(self, **changes):
        return {'id': 12, 'run_attempt': 2, 'head_sha': SHA, 'head_branch': 'main',
                'path': '.github/workflows/app-android-ci.yml', 'workflow_id': 90,
                'head_repository': {'id': 1}, 'status': 'completed', 'conclusion': 'success',
                'event': 'push', **changes}

    def test_ci_version_is_unique_monotonic_and_stable_across_retries(self):
        self.assertEqual(artifact.version_code('', '4', '100'), 104)
        self.assertEqual(artifact.version_code('1000', '4', '100'), 1100)
        self.assertGreater(artifact.version_code('', '4', '101'), artifact.version_code('', '4', '100'))
        for args in [('0', '4', '1'), ('1', '4', 'bad'), ('2100000000', '4', '1')]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                artifact.version_code(*args)

    def test_only_trusted_successful_main_ci_can_authorize_cd(self):
        self.assertEqual(source.validate(self.run_record(), 1, 90, 2)['head_sha'], SHA)
        self.assertEqual(source.validate(self.run_record(event='workflow_dispatch'), 1, 90)['id'], 12)
        for changes in ({'event': 'pull_request'}, {'head_branch': 'feature'}, {'head_repository': {'id': 2}},
                        {'conclusion': 'failure'}, {'status': 'in_progress'}, {'workflow_id': 91},
                        {'path': '.github/workflows/other.yml'}, {'head_sha': 'bad'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                source.validate(self.run_record(**changes), 1, 90, 2)
        with self.assertRaisesRegex(ValueError, 'attempt'):
            source.validate(self.run_record(run_attempt=3), 1, 90, 2)

    def test_metadata_binds_aab_to_exact_ci_attempt_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / 'app-release.aab', 'w') as archive:
                archive.writestr('base/manifest/AndroidManifest.xml', b'manifest fixture')
                archive.writestr('BundleConfig.pb', b'bundle fixture')
            expected = {'revision': SHA, 'run_id': '12', 'run_attempt': '2'}
            metadata = {**expected, 'schema': 1, 'version_code': 100, 'sha256': artifact.checksum(root / 'app-release.aab')}
            (root / 'metadata.json').write_text(json.dumps(metadata))
            self.assertEqual(artifact.verify(root, expected)['version_code'], 100)
            for key in expected:
                with self.subTest(key=key), self.assertRaises(ValueError):
                    artifact.verify(root, {**expected, key: 'other'})
            (root / 'app-release.aab').write_bytes(b'changed after CI')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                artifact.verify(root, expected)

    def test_bundle_version_reuse_requires_same_uploaded_bytes(self):
        record = {'versionCode': 100, 'sha256': 'b' * 64}
        self.assertTrue(bundle.verify([record], [100], 100, 'b' * 64))
        self.assertFalse(bundle.verify([record], [100], 101, 'c' * 64))
        with self.assertRaisesRegex(ValueError, '다른 AAB'):
            bundle.verify([record], [100], 100, 'c' * 64)
        with self.assertRaisesRegex(ValueError, '기존 versionCode'):
            bundle.verify([record], [100], 99, 'c' * 64)

    def test_cd_source_selects_exact_unexpired_attempt_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / 'event.json'
            event.write_text(json.dumps({'workflow_run': self.run_record()}))
            output = Path(directory) / 'output'
            def api(path):
                if path == '/actions/runs/12':
                    return self.run_record()
                if path == '/actions/workflows/app-android-ci.yml':
                    return {'id': 90}
                if path.startswith('/compare/'):
                    return {'status': 'ahead'}
                return {'artifacts': [{'name': 'android-ci-12-1', 'expired': False},
                                      {'name': 'android-ci-12-2', 'expired': False}]}
            with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_run',
                                         'GITHUB_EVENT_PATH': str(event), 'GITHUB_REPOSITORY_ID': '1',
                                         'GITHUB_OUTPUT': str(output)}), patch.object(source, 'api', api):
                source.main()
            self.assertIn('artifact-name=android-ci-12-2', output.read_text())
            self.assertIn('revision=' + SHA, output.read_text())

    def test_expired_or_missing_source_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / 'event.json'
            event.write_text(json.dumps({}))
            def api(path):
                if path == '/actions/runs/12':
                    return self.run_record()
                if path == '/actions/workflows/app-android-ci.yml':
                    return {'id': 90}
                if path.startswith('/compare/'):
                    return {'status': 'identical'}
                return {'artifacts': [{'name': 'android-ci-12-2', 'expired': True}]}
            with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                                         'GITHUB_EVENT_PATH': str(event), 'GITHUB_REPOSITORY_ID': '1', 'CI_RUN_ID': '12'}), \
                 patch.object(source, 'api', api), self.assertRaisesRegex(ValueError, '산출물'):
                source.main()
