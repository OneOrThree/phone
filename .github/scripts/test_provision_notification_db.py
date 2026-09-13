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

    def provision(self, data_user: str = "core_app", *, check: bool = True,
                  admin_user: str = "postgres") -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", "exec", "--env", "PGHOST=127.0.0.1", "--env", f"PGUSER={admin_user}",
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

    def test_알림_역할을_받은_다른_LOGIN_계정은_생성_전에_거부한다(self) -> None:
        self.sql("CREATE ROLE noti_app LOGIN PASSWORD 'old-test-only';"
                 "CREATE ROLE other_app LOGIN PASSWORD 'other-test-only';"
                 "GRANT noti_app TO other_app;")
        failed = self.provision(check=False)
        if failed.returncode == 0:
            # 이전 구현에서는 실제로 타 서비스가 DB owner로 전환하여 테이블까지 생성했다.
            escaped = self.sql("SET ROLE noti_app; CREATE TABLE escaped (id integer); SELECT current_user;",
                               user="other_app", database="gromo_notification", password="other-test-only")
            self.assertIn("noti_app", escaped.stdout)
        self.assertNotEqual(failed.returncode, 0, "다른 LOGIN 계정이 알림 DB owner 권한을 얻었습니다")
        self.assertIn("다른 계정", failed.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM pg_database WHERE datname='gromo_notification'")
                         .stdout.strip(), "0")
        self.sql("SELECT 1", user="noti_app", password="old-test-only")

    def test_중간_NOLOGIN_역할을_통한_알림_권한도_거부한다(self) -> None:
        self.sql("CREATE ROLE noti_app LOGIN; CREATE ROLE shared_group NOLOGIN;"
                 "CREATE ROLE other_app LOGIN; GRANT noti_app TO shared_group;"
                 "GRANT shared_group TO other_app;")
        failed = self.provision(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("다른 계정", failed.stderr)

    def test_SET_INHERIT가_꺼져도_ADMIN_재부여_권한을_거부한다(self) -> None:
        self.sql("CREATE ROLE noti_app LOGIN; CREATE ROLE other_app LOGIN;"
                 "GRANT noti_app TO other_app WITH ADMIN TRUE, SET FALSE, INHERIT FALSE;")
        failed = self.provision(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("다른 계정", failed.stderr)

    def test_현재_역할_생성_관리자의_PG16_자동_grant는_멱등_실행을_허용한다(self) -> None:
        self.sql("CREATE ROLE provision_admin LOGIN CREATEROLE CREATEDB PASSWORD 'admin-test-only';"
                 "GRANT core_app TO provision_admin;")
        self.sql("SET createrole_self_grant = 'SET';"
                 "CREATE ROLE noti_app LOGIN NOINHERIT;", user="provision_admin")
        grant = self.sql("SELECT bool_or(admin_option),bool_or(inherit_option),bool_or(set_option)"
                         " FROM pg_auth_members"
                         " WHERE roleid='noti_app'::regrole AND member='provision_admin'::regrole;")
        self.assertEqual(grant.stdout.strip(), "t|f|t")
        self.provision(admin_user="provision_admin")
        self.provision(admin_user="provision_admin")
        self.sql("SELECT 1", user="noti_app", database="gromo_notification", password="noti$'test-only")

    def test_관리자_예외의_하위_일반_계정은_거부한다(self) -> None:
        self.sql("CREATE ROLE provision_admin LOGIN CREATEROLE CREATEDB PASSWORD 'admin-test-only';"
                 "CREATE ROLE other_app LOGIN; GRANT provision_admin TO other_app;")
        self.sql("CREATE ROLE noti_app LOGIN;", user="provision_admin")
        failed = self.provision(admin_user="provision_admin", check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("다른 계정", failed.stderr)

    def test_기존_알림_계정이_다른_역할을_받은_검사도_유지한다(self) -> None:
        self.sql("CREATE ROLE noti_app LOGIN; CREATE ROLE shared_group NOLOGIN;"
                 "GRANT shared_group TO noti_app;")
        failed = self.provision(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("기존 알림 계정", failed.stderr)

    def test_Data가_알림_역할을_받은_검사도_유지한다(self) -> None:
        self.sql("CREATE ROLE noti_app LOGIN; GRANT noti_app TO core_app;")
        failed = self.provision(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("Data API 계정이 알림 역할", failed.stderr)

    def test_다른_CREATEROLE_계정을_현재_관리자_예외로_취급하지_않는다(self) -> None:
        self.sql("CREATE ROLE noti_app LOGIN; CREATE ROLE other_admin LOGIN CREATEROLE;"
                 "GRANT noti_app TO other_admin;")
        failed = self.provision(check=False)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("다른 계정", failed.stderr)


if __name__ == "__main__":
    unittest.main()
