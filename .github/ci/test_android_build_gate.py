"""Gradle이 실제 호출하는 게이트에서 CI 빌드와 로컬 출시를 구분한다."""
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]


class AndroidBuildGateTests(unittest.TestCase):
    def invoke(self, changes=None, alias='ci-throwaway'):
        gradle = (ROOT / 'app/app-dev/android/app/build.gradle').read_text()
        relative = re.search(r'new File\(rootDir, "(.*?gate\.py)"\)', gradle).group(1)
        script = (ROOT / 'app/app-dev/android' / relative).resolve()
        env = {'PATH': os.environ['PATH'], 'GITHUB_ACTIONS': 'true',
               'GITHUB_WORKFLOW': 'Android CI', 'GITHUB_JOB': 'build',
               'GITHUB_REPOSITORY': 'OneOrThree/phone', 'GITHUB_RUN_ID': '123',
               'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': 'a' * 40,
               'GROMO_ANDROID_CI_ARTIFACT': '1',
               # 이전 구현의 실제 CI 입력. 새 구현에서는 사용하지 않는다.
               'ALLOW_SERVER_GAP': 'server-gate 잡이 판정'}
        env.update(changes or {})
        return subprocess.run([sys.executable, str(script), '--signing-alias', alias],
                              cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)

    def test_ci_throwaway_aab_does_not_require_local_release_evidence(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_local_release_still_requires_compatibility_evidence(self):
        result = self.invoke({'GROMO_ANDROID_CI_ARTIFACT': '', 'GITHUB_ACTIONS': ''}, alias='upload')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue('커밋되지 않은 변경' in result.stderr or 'APP_COMPATIBILITY_RUN_ID' in result.stderr,
                        result.stdout + result.stderr)

    def test_ci_marker_cannot_silently_accept_wrong_context_or_upload_key(self):
        for changes in ({'GITHUB_ACTIONS': ''}, {'GITHUB_WORKFLOW': 'other'},
                        {'GITHUB_JOB': 'sign'}, {'GITHUB_REPOSITORY': 'fork/phone'},
                        {'GITHUB_RUN_ID': 'bad'}, {'GITHUB_RUN_ATTEMPT': '0'}, {'GITHUB_SHA': 'bad'}):
            with self.subTest(changes=changes):
                result = self.invoke(changes)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Android CI 산출물 설정 오류', result.stderr)
        self.assertNotEqual(self.invoke(alias='upload').returncode, 0)


if __name__ == '__main__':
    unittest.main()
