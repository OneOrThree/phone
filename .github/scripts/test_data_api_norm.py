"""로컬 게이트가 호스트 DB 없이 검사를 실행하고 실패를 숨기지 않는지 검증한다.

스텁 gradlew 는 인자 목록을 기록할 뿐 Gradle 문법(--tests 가 test 에 붙는지, --rerun 이 태스크마다 붙는지)을
해석하지 않는다. 그 부분은 실제 Gradle 실행으로 보증한다(GROMO-2328 에서 전체 스위트 통과를 확인). 이 테스트가
초록이라고 be-gradle.yml 과 norm.sh 의 태스크가 일치한다는 뜻도 아니다 — 그 대조는 사람이 한다.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DataApiNormTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='data api norm ')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.log = self.root / 'calls.jsonl'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        shutil.copy2(ROOT / 'server/data-api/norm.sh', self.root / 'norm.sh')
        # 실제 컨테이너/Gradle 대신 외부 명령 경계에서 호출과 실패 전파를 관찰한다.
        stub = '''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
command = Path(sys.argv[0]).name
with open(os.environ['NORM_TEST_LOG'], 'a') as log:
    log.write(json.dumps({
        'command': command, 'args': sys.argv[1:],
        'profile': os.environ.get('SPRING_PROFILES_ACTIVE'),
        'datasource': os.environ.get('SPRING_DATASOURCE_URL'),
    }) + '\\n')
if command == 'docker':
    sys.exit(0 if sys.argv[1:] == ['info'] and not os.environ.get('NORM_NO_DOCKER') else 9)
if sys.argv[1] == os.environ.get('NORM_FAIL_TASK'):
    sys.exit(7)
'''
        for path in (self.bin / 'docker', self.root / 'gradlew'):
            path.write_text(stub)
            path.chmod(0o755)
        self.env = {
            **os.environ,
            'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
            'NORM_TEST_LOG': str(self.log),
            'SPRING_PROFILES_ACTIVE': 'local',
            'SPRING_DATASOURCE_URL': 'jdbc:postgresql://localhost:5432/development',
        }
        for key in ('NORM_NO_DOCKER', 'NORM_FAIL_TASK'):
            self.env.pop(key, None)

    def run_gate(self, *args, **environment):
        self.log.unlink(missing_ok=True)
        result = subprocess.run(
            ['bash', str(self.root / 'norm.sh'), *args],
            cwd=ROOT, env={**self.env, **environment},
            text=True, capture_output=True, timeout=10,
        )
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result, calls

    def test_full_gate_uses_testcontainers_without_managing_host_database(self):
        result, calls = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call['args'] for call in calls if call['command'] == 'docker'],
                         [['info']])
        gradle = [call for call in calls if call['command'] == 'gradlew']
        self.assertEqual([call['args'] for call in gradle], [
            ['checkstyleMain', '--rerun', 'checkstyleTest', '--rerun'],
            ['spotbugsMain', '--rerun'],
            ['test', '--rerun', 'bootJar', '--stacktrace'],
        ])
        self.assertEqual(gradle[-1]['profile'], 'ci')
        self.assertEqual(gradle[-1]['datasource'],
                         'jdbc:postgresql://127.0.0.1:1/norm-no-host-db')
        self.assertIn('모든 검사 통과', result.stdout)

    def test_filtered_run_preserves_argument_boundaries_and_reports_scope(self):
        result, calls = self.run_gate('--tests', '*CurrencyServiceTest', '--tests', '*OutboxTest*')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[-1]['args'], [
            'test', '--rerun', '--tests', '*CurrencyServiceTest', '--tests', '*OutboxTest*',
            'bootJar', '--stacktrace',
        ])
        self.assertIn('지정한 테스트', result.stdout)
        self.assertNotIn('모든 검사 통과', result.stdout)

    def test_missing_docker_fails_before_gradle(self):
        result, calls = self.run_gate(NORM_NO_DOCKER='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call['command'] for call in calls], ['docker'])
        self.assertIn('Testcontainers', result.stderr)

    def test_each_failure_stops_later_checks_and_propagates_exit_status(self):
        for index, task in enumerate(('checkstyleMain', 'spotbugsMain', 'test')):
            with self.subTest(task=task):
                result, calls = self.run_gate(NORM_FAIL_TASK=task)
                self.assertEqual(result.returncode, 7)
                gradle = [call for call in calls if call['command'] == 'gradlew']
                self.assertEqual(len(gradle), index + 1)
                self.assertNotIn('통과', result.stdout)


if __name__ == '__main__':
    unittest.main()
