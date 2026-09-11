#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("write-compose-env.py")
SPEC = importlib.util.spec_from_file_location("write_compose_env", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def secret(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {key: f"value-{key}" for key in MODULE.REQUIRED_KEYS}
    base.update(overrides)
    return base


class WriteComposeEnvTest(unittest.TestCase):
    def test_compose가_메타문자와_줄바꿈을_원문으로_복원한다(self) -> None:
        password = "p$WORD # literal\\path'quote\nnext"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_file = root / "runtime" / "dev.env"
            compose_file = root / "compose.yml"
            compose_file.write_text(
                "services:\n"
                "  app:\n"
                "    image: ${APP_IMAGE}\n"
                "    environment:\n"
                "      PASSWORD: ${POSTGRES_PASSWORD}\n",
                encoding="utf-8",
            )
            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--output",
                    str(env_file),
                    "--app-image",
                    "example/app@sha256:abc",
                ],
                input=json.dumps(secret(POSTGRES_PASSWORD=password)),
                text=True,
                check=True,
            )

            configured = subprocess.run(
                [
                    "docker",
                    "compose",
                    "--env-file",
                    str(env_file),
                    "-f",
                    str(compose_file),
                    "config",
                    "--format",
                    "json",
                ],
                text=True,
                check=True,
                capture_output=True,
            )
            parsed = json.loads(configured.stdout)
            # compose config는 literal $를 재직렬화할 때 $$로 표시한다. 컨테이너 보간 단계에서는
            # 다시 단일 $가 되며, 나머지 메타문자·실제 줄바꿈은 원문 그대로여야 한다.
            self.assertEqual(
                parsed["services"]["app"]["environment"]["PASSWORD"],
                password.replace("$", "$$"),
            )
            self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(env_file.parent.stat().st_mode & 0o777, 0o700)

    def test_필수_시크릿이_없으면_기존_파일을_덮어쓰지_않는다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "dev.env"
            env_file.write_text("previous", encoding="utf-8")
            incomplete = secret()
            incomplete.pop("JWT_SECRET")

            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--output",
                    str(env_file),
                    "--app-image",
                    "example/app:latest",
                ],
                input=json.dumps(incomplete),
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(env_file.read_text(encoding="utf-8"), "previous")

    def test_공유_secret의_서비스별_자격이_실제_compose에서_격리된다(self) -> None:
        combined = secret(
            API_DB_URL="jdbc:postgresql://db:5432/gromo",
            API_DB_USERNAME="gromo_data", API_DB_PASSWORD="data-only",
            NOTI_DB_URL="jdbc:postgresql://db:5432/gromo_notification",
            NOTI_DB_USERNAME="gromo_notification", NOTI_DB_PASSWORD="noti-only",
            SVC_TOKEN_BIZ_TO_DATA="biz-data", SVC_TOKEN_BIZ_TO_NOTI="biz-noti",
            BUSINESS_REDIS_PASSWORD="redis-only-password", GOOGLE_DRIVE_API_KEY="drive-only",
            SVC_TOKEN_BIZ_TO_LINK="biz-link", SVC_TOKEN_DATA_TO_NOTI="data-noti",
            SVC_TOKEN_DATA_TO_LINK="data-link", SVC_TOKEN_NOTI_TO_DATA="noti-data",
            SVC_TOKEN_CONSOLE_TO_NOTI="console-noti", LINK_CAPABILITY_KEY="capability",
            LINK_IP_SALT="existing-salt", DD_API_KEY="agent-only", CONSOLE_SUDO_PASSWORD_HASH="console-only",
            DATA_API_BASE_URL="http://app:8080", NOTIFICATION_BASE_URL="http://notification:8082",
            LINK_BASE_URL="https://link.example.test", KAFKA_BOOTSTRAP_SERVERS="kafka:9092",
            FCM_SERVICE_ACCOUNT_JSON={"project_id": "test", "private_key": "fake$'\\\nkey"},
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {}
            for service in ("data-api", "business-api", "notification"):
                path = root / service / "service.env"
                subprocess.run(
                    [sys.executable, str(SCRIPT), "--output", str(path), "--service", service,
                     "--image", f"example/{service}:test", "--environment", "dev"],
                    input=json.dumps(combined), text=True, check=True, capture_output=True,
                )
                paths[service] = path
            compose = SCRIPT.parents[2] / "server/scripts/docker-compose.satellites.yml"
            interpolation = root / "compose.env"
            interpolation.write_text(
                f"BUSINESS_API_IMAGE=example/business-api:test\n"
                f"NOTIFICATION_IMAGE=example/notification:test\n"
                f"BUSINESS_API_ENV_FILE={paths['business-api']}\n"
                f"NOTIFICATION_ENV_FILE={paths['notification']}\n"
                f"BUSINESS_REDIS_ACL_FILE={root / 'business.acl'}\n",
            )
            result = subprocess.run(
                ["docker", "compose", "--env-file", str(interpolation), "-f", str(compose),
                 "config", "--format", "json"], check=True, capture_output=True, text=True,
            )
            services = json.loads(result.stdout)["services"]
            biz = services["business-api"]["environment"]
            noti = services["notification"]["environment"]
            self.assertEqual(biz["SVC_TOKEN_BIZ_TO_DATA"], "biz-data")
            self.assertEqual(biz["SVC_TOKEN_BIZ_TO_LINK"], "biz-link")
            self.assertEqual(biz["JWT_SECRET"], combined["JWT_SECRET"])
            self.assertEqual(biz["BUSINESS_REDIS_PASSWORD"], "redis-only-password")
            self.assertEqual(biz["GOOGLE_DRIVE_API_KEY"], "drive-only")
            self.assertEqual(biz["BUSINESS_REDIS_USERNAME"], "business")
            self.assertEqual(set(services["business-redis"]["networks"]), {"business-cache"})
            self.assertNotIn("environment", services["business-redis"])
            self.assertEqual(noti["NOTI_DB_PASSWORD"], "noti-only")
            self.assertEqual(noti["SVC_TOKEN_DATA_TO_NOTI"], "data-noti")
            self.assertEqual(noti["SVC_TOKEN_CONSOLE_TO_NOTI"], "console-noti")
            self.assertEqual(noti["KAFKA_BOOTSTRAP_SERVERS"], "kafka:9092")
            for key in ("FCM_SERVICE_ACCOUNT_JSON", "NOTI_DB_PASSWORD", "API_DB_PASSWORD",
                        "SVC_TOKEN_CONSOLE_TO_NOTI", "SVC_TOKEN_DATA_TO_LINK"):
                self.assertNotIn(key, biz)
            for key in ("JWT_SECRET", "API_DB_PASSWORD", "SVC_TOKEN_BIZ_TO_LINK", "LINK_CAPABILITY_KEY", "BUSINESS_REDIS_PASSWORD", "GOOGLE_DRIVE_API_KEY"):
                self.assertNotIn(key, noti)
            for environment in (biz, noti):
                self.assertNotIn("DD_API_KEY", environment)
                self.assertNotIn("CONSOLE_SUDO_PASSWORD_HASH", environment)
            self.assertNotIn("ports", services["business-api"])
            self.assertNotIn("ports", services["notification"])

    def test_전환용_Data는_구_기동_자격을_보존하고_final은_회수한다(self) -> None:
        combined = secret(
            API_DB_URL="jdbc:postgresql://db/gromo", API_DB_USERNAME="data", API_DB_PASSWORD="pw",
            SVC_TOKEN_BIZ_TO_DATA="bd", SVC_TOKEN_NOTI_TO_DATA="nd",
            SVC_TOKEN_DATA_TO_NOTI="dn", SVC_TOKEN_DATA_TO_LINK="dl", LINK_CAPABILITY_KEY="key",
            LINK_IP_SALT="existing-salt", LINK_BASE_URL="https://links.example.test",
            NOTIFICATION_BASE_URL="http://notification:8082", KAFKA_BOOTSTRAP_SERVERS="kafka:9092",
        )
        transition = MODULE.render(combined, "example/data:1", "data-api")
        final = MODULE.render(combined, "example/data:2", "data-api", "final", "prod")
        for key in ("JWT_SECRET", "GOOGLE_CLIENT_ID", "APPLE_CLIENT_ID", "FCM_PROJECT_ID",
                    "FCM_SERVICE_ACCOUNT_JSON"):
            self.assertIn(f"{key}=", transition)
            self.assertNotIn(f"{key}=", final)
        self.assertIn("SVC_TOKEN_DATA_TO_LINK='dl'", final)
        self.assertIn("SPRING_PROFILES_ACTIVE='prod,satellites'", final)

    def test_신규_서비스의_필수값_누락_null_공백은_실패한다(self) -> None:
        baseline = {
            "JWT_SECRET": "jwt", "SVC_TOKEN_BIZ_TO_DATA": "bd",
            "SVC_TOKEN_BIZ_TO_NOTI": "bn", "SVC_TOKEN_BIZ_TO_LINK": "bl",
        }
        for key in baseline:
            for value in (None, "", "  "):
                with self.subTest(key=key, value=value):
                    with self.assertRaisesRegex(ValueError, key):
                        MODULE.render({**baseline, key: value}, "example/biz:1", "business-api")


if __name__ == "__main__":
    unittest.main()
