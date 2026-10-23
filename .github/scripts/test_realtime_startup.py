"""실제 Compose 정책과 대기 스크립트를 검사한다.

상태 재생은 검사 소요 시간을 0초로 둔 타이밍 모델이다.
실제 Docker 검사 실행·스케줄링 시간의 재현은 포함하지 않는다.
"""
import os
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[2]


class RealtimeStartupTest(unittest.TestCase):
    def test_공동_배포에서도_기동_검사_입력_변경을_놓치지_않는다(self):
        workflows = ROOT / ".github/workflows"
        realtime = yaml.load((workflows / "realtime-ci.dev.yml").read_text(), Loader=yaml.BaseLoader)
        core = yaml.load((workflows / "data-api-ci.dev.yml").read_text(), Loader=yaml.BaseLoader)
        inputs = {"server/scripts/docker-compose." + name + ".yml"
                  for name in ["dev", "realtime", "satellites", "business"]}
        inputs.add(".github/scripts/test_realtime_startup.py")
        self.assertTrue(inputs.issubset(realtime["on"]["pull_request"]["paths"]))
        self.assertTrue(inputs.issubset(core["on"]["push"]["paths"]))
        self.assertIn("workflow_call", realtime["on"])
        self.assertNotIn("push", realtime["on"])
        self.assertEqual(core["jobs"]["realtime"]["uses"], "./.github/workflows/realtime-ci.dev.yml")

    def compose_health(self, environment, overlay="docker-compose.satellites.yml"):
        spec = importlib.util.spec_from_file_location("startup_env_writer", ROOT / ".github/scripts/write-compose-env.py")
        writer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(writer)
        secret = {key: "test-" + key for key in writer.LEGACY_REQUIRED_KEYS}
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            empty = work / "empty.env"
            empty.touch()
            runtime = work / "runtime.env"
            runtime.write_text(writer.render(secret, "example/data:test", environment=environment))
            env = {key: value for key, value in os.environ.items() if not key.startswith("APP_HEALTH_")}
            env.update(REALTIME_IMAGE="example/realtime:test", BUSINESS_API_IMAGE="example/business:test",
                       NOTIFICATION_IMAGE="example/notification:test", BUSINESS_API_ENV_FILE=str(empty),
                       NOTIFICATION_ENV_FILE=str(empty), BUSINESS_REDIS_ACL_FILE=str(empty))
            args = ["docker", "compose", "--env-file", str(runtime)]
            for name in ["docker-compose.dev.yml", "docker-compose.realtime.yml", overlay]:
                args.extend(["-f", str(ROOT / "server/scripts" / name)])
            result = subprocess.run(args + ["config", "--format", "json"], env=env,
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            return {name: service.get("healthcheck") for name, service in json.loads(result.stdout)["services"].items()}

    def test_dev_네_서비스는_실제_Compose_결과에서_동일한_기동_정책을_쓴다(self):
        configured = self.compose_health("dev")
        for name in ["data-api", "business-api", "notification", "realtime"]:
            with self.subTest(service=name):
                health = configured[name]
                self.assertEqual((health["start_period"], health["interval"], health["timeout"], health["retries"]),
                                 ("2m0s", "10s", "5s", 6))

    def test_공용_위성_Compose의_prod_기본값은_유지한다(self):
        configured = self.compose_health("prod")
        for name in ["business-api", "notification"]:
            health = configured[name]
            self.assertEqual((health["start_period"], health["retries"]), ("30s", 30))

    def test_Business_단독_dev_진입점도_같은_정책을_쓴다(self):
        health = self.compose_health("dev", "docker-compose.business.yml")["business-api"]
        self.assertEqual((health["start_period"], health["interval"], health["retries"]), ("2m0s", "10s", 6))

    def replay(self, ready_at=150, fault="", grace=None, limit=900, interval=None, retries=None):
        health = yaml.safe_load((ROOT / "server/scripts/docker-compose.realtime.yml").read_text())["services"]["realtime"]["healthcheck"]
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "clock").write_text("0")
            # sleep만 가속한다. 판정·종료 코드·재시작 검출은 원본 Bash 스크립트를 실행한다.
            (work / "bash-env").write_text('unset SECONDS; SECONDS=0\nsleep() { SECONDS=$((SECONDS + $1)); echo "$SECONDS" > "$CLOCK"; }\n')
            docker = work / "docker"
            docker.write_text('''#!/usr/bin/env python3
import os
from pathlib import Path
import sys
t = int(Path(os.environ["CLOCK"]).read_text())
if sys.argv[1] == "logs":
    print("모의 Realtime 기동 로그")
elif sys.argv[1] == "inspect":
    fmt = sys.argv[3]
    if fmt == "{{.Created}}" or fmt == "{{.State.StartedAt}}":
        print("2000-01-01T00:00:00Z")
    else:
        fault = os.environ["FAULT"]
        status = "exited" if fault == "exit" and t >= 90 else "running"
        restarts = int(fault == "restart" and t >= 90)
        grace = int(os.environ["GRACE"])
        # 모델 가정: 검사는 interval 경계에서 즉시 끝나며 grace 경계의 실패부터 집계한다.
        # 실제 Docker 타이밍을 보장하는 공식이 아니라 대기 스크립트에 공급할 상태를 만든다.
        interval = int(os.environ["INTERVAL"])
        retries = int(os.environ["RETRIES"])
        failed_at = ((grace + interval - 1) // interval + retries - 1) * interval
        health = "healthy" if t >= int(os.environ["READY_AT"]) else "unhealthy" if t >= failed_at else "starting"
        print(status, health, restarts)
else:
    sys.exit(2)
''')
            docker.chmod(0o755)
            env = {**os.environ, "PATH": str(work) + os.pathsep + os.environ["PATH"],
                   "BASH_ENV": str(work / "bash-env"), "CLOCK": str(work / "clock"),
                   "GRACE": str(grace if grace is not None else int(health["start_period"][:-1])),
                   "READY_AT": str(ready_at), "FAULT": fault,
                   "INTERVAL": str(interval if interval is not None else int(health["interval"][:-1])), "RETRIES": str(retries if retries is not None else health["retries"]),
                   "STARTUP_HISTORY_DIR": str(work / "history"), "GITHUB_STEP_SUMMARY": str(work / "summary")}
            return subprocess.run(["bash", str(ROOT / ".github/scripts/wait-healthy.sh"), "phone-realtime", str(limit)],
                                  env=env, capture_output=True, text=True, timeout=10)

    def test_기존_60초_유예는_150초_기동을_조기_실패시킨다(self):
        result = self.replay(grace=60, interval=15, retries=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unhealthy (120s)", result.stdout)

    def test_현재_구성은_150초_기동을_허용한다(self):
        result = self.replay()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_프로세스_종료는_유예_중에도_실패한다(self):
        result = self.replay(fault="exit")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("종료됨", result.stdout)

    def test_프로세스_재시작은_유예_중에도_실패한다(self):
        result = self.replay(fault="restart")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("기동 중 재시작 발생", result.stdout)

    def test_준비되지_않으면_unhealthy로_실패한다(self):
        result = self.replay(ready_at=9999)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unhealthy (170s)", result.stdout)

    def test_시작_유예보다_짧은_대기_상한도_지킨다(self):
        result = self.replay(ready_at=9999, limit=45)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("45s 안에 healthy 안 됨", result.stdout)


if __name__ == "__main__":
    unittest.main()
