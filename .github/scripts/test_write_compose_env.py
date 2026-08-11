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


if __name__ == "__main__":
    unittest.main()
