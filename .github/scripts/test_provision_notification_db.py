#!/usr/bin/env python3
"""운영과 같은 psql 초기화 스크립트를 격리한 실제 Postgres에서 실행한다."""
from __future__ import annotations

import subprocess
import time
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[2] / "server/scripts"


class ProvisionNotificationDatabaseTest(unittest.TestCase):
    def setUp(self) -> None:
        result = subprocess.run(
            ["docker", "run", "--detach", "--rm", "--env", "POSTGRES_PASSWORD=admin-test-only",
             "--volume", f"{SCRIPTS}:/task:ro", "postgres:16-alpine"],
            text=True, capture_output=True, check=True,
        )
        self.container = result.stdout.strip()
        self.addCleanup(lambda: subprocess.run(
            ["docker", "stop", "--time", "1", self.container], capture_output=True, check=False,
        ))
        for _ in range(40):
            ready = self.sql("SELECT 1", check=False)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            self.fail("격리 Postgres가 시작되지 않았습니다")
        self.sql("CREATE ROLE core_app LOGIN PASSWORD 'core-test-only'; CREATE DATABASE gromo OWNER core_app;")

    def sql(self, statement: str, *, user: str = "postgres", database: str = "postgres",
            password: str = "admin-test-only", check: bool = True) -> subprocess.CompletedProcess[str]:
        # psql -c 한 문자열의 CREATE DATABASE 암묵 TX를 피하도록 stdin 스크립트로 전달한다.
        return subprocess.run(
            ["docker", "exec", "--interactive", "--env", f"PGPASSWORD={password}", self.container,
             "psql", "-X", "--host", "127.0.0.1", "--username", user, "--dbname", database,
             "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align"],
            input=statement, text=True, capture_output=True, check=check,
        )

    def provision(self, data_user: str = "core_app", *, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", "exec", "--env", "PGHOST=127.0.0.1", "--env", "PGUSER=postgres",
             "--env", "PGPASSWORD=admin-test-only", "--env", f"API_DB_USERNAME={data_user}",
             "--env", "CORE_DB_NAME=gromo", "--env", "NOTI_DB_USERNAME=noti_app",
             "--env", "NOTI_DB_PASSWORD=noti$'test-only", self.container,
             "bash", "/task/provision-notification-db.sh"],
            text=True, capture_output=True, check=check,
        )

    def test_기존_볼륨에_멱등_생성하고_양방향_접속을_차단한다(self) -> None:
        self.provision()
        self.sql("CREATE TABLE preserved (id integer); INSERT INTO preserved VALUES (1);",
                 user="noti_app", database="gromo_notification", password="noti$'test-only")
        self.provision()
        kept = self.sql("SELECT count(*) FROM preserved", user="noti_app",
                        database="gromo_notification", password="noti$'test-only")
        self.assertEqual(kept.stdout.strip(), "1")
        self.assertNotEqual(self.sql("SELECT 1", user="noti_app", database="gromo",
                                    password="noti$'test-only", check=False).returncode, 0)
        self.assertNotEqual(self.sql("SELECT 1", user="core_app", database="gromo_notification",
                                    password="core-test-only", check=False).returncode, 0)
        self.sql("SELECT 1", user="core_app", database="gromo", password="core-test-only")

    def test_Data가_관리자면_DB를_만들기_전에_실패한다(self) -> None:
        failed = self.provision(data_user="postgres", check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("전용 계정", failed.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_database WHERE datname='gromo_notification'")
                         .stdout.strip(), "0")

    def test_다른_소유자의_기존_DB를_자동_인수하지_않는다(self) -> None:
        self.sql("CREATE DATABASE gromo_notification OWNER core_app")
        failed = self.provision(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("소유자", failed.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_roles WHERE rolname='noti_app'").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main()
