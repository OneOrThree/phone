"""실제 Kafka 로그·KRaft 메타데이터의 컨테이너 재생성 후 보존을 검사한다."""
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]

class KafkaPersistenceTest(unittest.TestCase):
    def test_message_survives_container_recreation(self):
        project = 'gromo-kafka-persistence-' + uuid.uuid4().hex[:12]
        with tempfile.TemporaryDirectory() as directory:
            # 실제 오버레이의 설정을 사용하고 테스트 자원 이름만 격리한다.
            config = json.loads(subprocess.check_output(
                ['docker', 'compose', '-f', str(ROOT / 'server/scripts/docker-compose.kafka.yml'),
                 'config', '--format', 'json'], text=True))
            config['name'] = project
            config['services']['kafka']['container_name'] = project
            for name, value in config.get('networks', {}).items():
                value['name'] = project + '_' + name
            for name, value in config.get('volumes', {}).items():
                value['name'] = project + '_' + name
            compose_file = Path(directory) / 'compose.json'
            compose_file.write_text(json.dumps(config))
            base = ['docker', 'compose', '-p', project, '-f', str(compose_file)]
            def compose(*args, **kw):
                return subprocess.run(base + list(args), capture_output=True, text=True,
                                      check=True, timeout=180, **kw)
            def kafka(tool, *args, **kw):
                return compose('exec', '-T', 'kafka', '/opt/kafka/bin/kafka-' + tool + '.sh',
                               '--bootstrap-server', 'kafka:9092', *args, **kw)
            def ready():
                for _ in range(60):
                    try:
                        kafka('broker-api-versions')
                        return
                    except subprocess.CalledProcessError:
                        time.sleep(1)
                self.fail('Kafka 기동 실패')
            try:
                compose('up', '-d', 'kafka')
                ready()
                kafka('topics', '--create', '--topic', 'persistence-proof', '--partitions', '1',
                      '--replication-factor', '1')
                message = 'before-recreation-' + uuid.uuid4().hex
                kafka('console-producer', '--topic', 'persistence-proof',
                      '--producer-property', 'acks=all', input=message + '\n')
                before = kafka('console-consumer', '--topic', 'persistence-proof', '--from-beginning',
                               '--max-messages', '1', '--timeout-ms', '20000').stdout
                self.assertIn(message, before)
                compose('stop', 'kafka')
                compose('rm', '-f', 'kafka')
                compose('up', '-d', 'kafka')
                ready()
                topics = kafka('topics', '--list').stdout
                self.assertIn('persistence-proof', topics, '컨테이너 재생성으로 토픽 메타데이터가 유실됨')
                after = kafka('console-consumer', '--topic', 'persistence-proof', '--from-beginning',
                              '--max-messages', '1', '--timeout-ms', '20000').stdout
                self.assertIn(message, after)
            finally:
                compose('down', '--volumes', '--remove-orphans')

if __name__ == '__main__':
    unittest.main()
