"""검증 산출물 혼입과 변경 범위 오판으로 검사가 빠지는 회귀를 막는다."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


jar = load('ci-jar')
planner = load('satellite-ci-plan')


class JarTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.libs = self.project / 'build/libs'
        self.libs.mkdir(parents=True)
        self.artifact = self.project / 'ci-artifact'
        self.expected = jar.identity('notification', 'a' * 40, '123')
        with zipfile.ZipFile(self.libs / 'notification.jar', 'w') as archive:
            archive.writestr('BOOT-INF/classes/Application.class', b'class fixture')

    def test_exact_jar_bytes_survive_pack_and_verify(self):
        (self.libs / 'notification-plain.jar').write_bytes(b'not the executable')
        jar.pack(self.project, self.artifact, self.expected)
        jar.verify(self.artifact, self.expected)
        self.assertEqual((self.libs / 'notification.jar').read_bytes(),
                         (self.artifact / 'app.jar').read_bytes())

    def test_other_revision_run_or_service_is_rejected(self):
        jar.pack(self.project, self.artifact, self.expected)
        for field in self.expected:
            with self.subTest(field=field), self.assertRaises(ValueError):
                jar.verify(self.artifact, {**self.expected, field: 'other'})

    def test_corrupted_download_is_rejected(self):
        jar.pack(self.project, self.artifact, self.expected)
        with (self.artifact / 'app.jar').open('ab') as file:
            file.write(b'corrupt')
        with self.assertRaises(ValueError):
            jar.verify(self.artifact, self.expected)

    def test_missing_or_ambiguous_jar_is_rejected(self):
        (self.libs / 'extra.jar').write_bytes(b'ambiguous')
        with self.assertRaises(ValueError):
            jar.pack(self.project, self.artifact, self.expected)
        for file in self.libs.iterdir():
            file.unlink()
        with self.assertRaises(ValueError):
            jar.pack(self.project, self.artifact, self.expected)

    def test_plain_jar_is_not_an_executable(self):
        with zipfile.ZipFile(self.libs / 'notification.jar', 'w') as archive:
            archive.writestr('Application.class', b'class fixture')
        with self.assertRaises(ValueError):
            jar.pack(self.project, self.artifact, self.expected)


class PlanTest(unittest.TestCase):
    def test_data_only_does_not_request_satellite_images(self):
        self.assertEqual(planner.plan(['server/data-api/src/main/A.java']),
                         {'business-api': False, 'notification': False})

    def test_service_build_inputs_select_the_service(self):
        for service in planner.SERVICES:
            for path in ('src/main/A.java', 'src/test/A.java', 'build.gradle',
                         'gradle/wrapper/gradle-wrapper.properties', 'Dockerfile', '.dockerignore'):
                with self.subTest(service=service, path=path):
                    self.assertTrue(planner.plan([f'server/{service}/{path}'])[service])

    def test_common_and_unknown_inputs_fail_open_to_full_validation(self):
        for path in ('.github/scripts/ci-jar.py', '.github/actions/ci-jar/action.yml',
                     '.github/workflows/satellite-ci.yml', 'server/scripts/docker-compose.satellites.yml',
                     'new-shared-build-input'):
            with self.subTest(path=path):
                self.assertTrue(all(planner.plan([path]).values()))
        self.assertTrue(all(planner.plan([]).values()))

    def test_both_services_and_documents(self):
        self.assertTrue(all(planner.plan(['server/business-api/a', 'server/notification/b']).values()))
        self.assertFalse(any(planner.plan(['docs/contracts/a.yaml']).values()))

    def test_real_git_diff_includes_deleted_and_renamed_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
            git('init', '-q')
            git('config', 'user.name', 'CI fixture')
            git('config', 'user.email', 'fixture@example.invalid')
            file = root / 'server/business-api/Dockerfile'
            file.parent.mkdir(parents=True)
            file.write_text('FROM scratch\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD')
            target = root / 'docs/moved'
            target.parent.mkdir()
            file.rename(target)
            git('add', '-A')
            git('commit', '-qm', 'move')
            head = git('rev-parse', 'HEAD')
            event = root / 'event.json'
            event.write_text(json.dumps({'pull_request': {'base': {'sha': base}, 'head': {'sha': head}}}))
            output, summary = root / 'output', root / 'summary'
            subprocess.run(['python3', planner.__file__], cwd=root, check=True, capture_output=True,
                           env={**os.environ, 'GITHUB_EVENT_PATH': str(event),
                                'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_OUTPUT': str(output),
                                'GITHUB_STEP_SUMMARY': str(summary)})
            selected = json.loads(output.read_text().split('=', 1)[1])
            self.assertTrue(selected['business-api'])
            self.assertFalse(selected['notification'])


if __name__ == '__main__':
    unittest.main()
