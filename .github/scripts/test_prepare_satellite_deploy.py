#!/usr/bin/env python3
"""배포 준비 도구의 회귀 검사. 합성 입력, 실제 Compose 병합과 격리된 nginx 구문 검사를 쓴다.

이 테스트가 지키는 것은 셋이다: 서비스별 자격이 섞이지 않는다, 필수 입력이 빠지면 성공하지
않는다, 그리고 비밀이 표준출력·compose 보간 파일로 새지 않는다.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "server" / "scripts" / "prepare-satellite-deploy.py"
NGINX_EXAMPLE = ROOT / "server" / "scripts" / "nginx-satellites.include.conf.example"
DATA_OVERLAY = ROOT / "server" / "scripts" / "docker-compose.satellites.data.yml"
BUSINESS_API = ROOT / "server" / "business-api" / "src" / "main" / "java" / "com" / "oneorthree" / "business" / "api"

WRITER_SPEC = importlib.util.spec_from_file_location(
    "write_compose_env", ROOT / ".github" / "scripts" / "write-compose-env.py")
assert WRITER_SPEC and WRITER_SPEC.loader
WRITER = importlib.util.module_from_spec(WRITER_SPEC)
WRITER_SPEC.loader.exec_module(WRITER)

DIGEST = "sha256:" + "ab12cd34" * 8
IMAGES = {
    "--business-image": f"example.registry.test/gromo/business@{DIGEST}",
    "--notification-image": f"example.registry.test/gromo/notification@{DIGEST}",
    "--data-image": f"example.registry.test/gromo/back@{DIGEST}",
}


def secret() -> dict[str, str]:
    """세 서비스의 필수·전환 자격을 모두 채운 합성 SecretString. 값은 키마다 «다르게» 둔다 —
    같은 값이면 「다른 서비스 값이 섞였다」를 테스트가 구분하지 못한다."""
    keys: set[str] = set(WRITER.REQUIRED_KEYS) | set(WRITER.TRANSITION_KEYS)
    for required in WRITER.SERVICE_REQUIRED_KEYS.values():
        keys |= set(required)
    data = {key: f"secretvalue-{key.lower()}" for key in sorted(keys)}
    data["SVC_TOKEN_CONSOLE_TO_NOTI"] = "member-1:secretvalue-console-one,member-2:secretvalue-console-two"
    # 관측 백엔드 키와 콘솔 비밀번호는 공유 시크릿에 «있지만» 어느 서비스에도 가면 안 된다.
    data["LINK_PROXY_SECRET"] = "secretvalue-link-proxy"
    data["DD_API_KEY"] = "secretvalue-dd-api-key"
    data["GRAFANA_ADMIN_PASSWORD"] = "secretvalue-grafana"
    return data


class Fixture:
    """기존 환경(base compose + 공유 env)을 흉내 낸 임시 트리."""

    def __init__(self, directory: str) -> None:
        self.root = Path(directory)
        self.base = self.root / "docker-compose.fake.yml"
        self.base.write_text(
            "name: phone\n"
            "services:\n"
            "  app:\n"
            "    image: ${APP_IMAGE:-registry.test/back:latest}\n"
            "    environment:\n"
            "      SPRING_PROFILES_ACTIVE: dev\n"
            "      API_DB_URL: jdbc:postgresql://db:5432/${POSTGRES_DB}\n",
            encoding="utf-8")
        self.shared = self.root / ".env"
        self.shared.write_text("POSTGRES_DB='gromo'\nAPP_IMAGE='registry.test/back:old'\n", encoding="utf-8")
        self.output = self.root / "runtime"


def run(fixture: Fixture, *extra: str, payload: dict | None = None,
        with_data: bool = True) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(SCRIPT), "--environment", "dev",
               "--output-dir", str(fixture.output), "--base-compose", str(fixture.base),
               "--shared-env-file", str(fixture.shared),
               "--business-image", IMAGES["--business-image"],
               "--notification-image", IMAGES["--notification-image"]]
    if with_data:
        command += ["--data-image", IMAGES["--data-image"]]
    command += list(extra)
    return subprocess.run(command, input=json.dumps(secret() if payload is None else payload),
                          text=True, capture_output=True)


class PrepareSatelliteDeployTest(unittest.TestCase):

    def test_콘솔_단일_토큰은_기존_준비_파일을_변경하지_않고_거부한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            fixture.output.mkdir()
            previous = fixture.output / "notification.env"
            previous.write_text("previous")
            payload = secret()
            payload["SVC_TOKEN_CONSOLE_TO_NOTI"] = "private-invalid-console-token"
            result = run(fixture, payload=payload)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SVC_TOKEN_CONSOLE_TO_NOTI", result.stderr)
            self.assertEqual(previous.read_text(), "previous")
            self.assertEqual({path.name for path in fixture.output.iterdir()}, {"notification.env"})
            self.assertNotIn(payload["SVC_TOKEN_CONSOLE_TO_NOTI"], result.stdout + result.stderr)

    def test_상대_출력경로도_compose에는_절대경로로_기록한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture, "--output-dir", os.path.relpath(fixture.output))
            self.assertEqual(result.returncode, 0, result.stderr)
            values = (fixture.output / "compose.env").read_text()
            self.assertIn(str(fixture.output.resolve() / "data-api.env"), values)
            self.assertIn(str(fixture.output.resolve() / "business-api.env"), values)

    def test_nginx_호환과_최종전환_설정이_실제로_파싱된다(self) -> None:
        headers = (ROOT / "server/scripts/nginx-satellites-proxy-headers.conf.example").read_text()
        for phase in ("compat", "final"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                source = NGINX_EXAMPLE.read_text()
                if phase == "final":
                    start = source.index("location = /l/match {")
                    end = source.index("# §7.2 5단계:", start)
                    source = source[:start] + source[end:]
                    source = "\n".join(
                        line[2:] if line.startswith(("# location ", "#     ")) or line == "# }" else line
                        for line in source.splitlines())
                source = source.replace("__BUSINESS_UPSTREAM__", "127.0.0.1:18080")
                source = source.replace("__NOTIFICATION_UPSTREAM__", "127.0.0.1:18082")
                source = source.replace("__LINK_HOST__", "localhost")
                source = source.replace("__LINK_PROXY_SECRET__", "synthetic-probe-secret")
                path = Path(directory)
                (path / "nginx.conf").write_text(
                    "events {}\nhttp { server { listen 8080;\n" + source + "\n} }\n")
                (path / "headers.conf").write_text(
                    headers.replace("__LINK_PROXY_SECRET__", "synthetic-probe-secret"))
                result = subprocess.run([
                    "docker", "run", "--rm", "--network", "none", "--entrypoint", "nginx",
                    "-v", str(path / "nginx.conf") + ":/etc/nginx/nginx.conf:ro",
                    "-v", str(path / "headers.conf")
                    + ":/etc/nginx/snippets/gromo-satellites-proxy-headers.conf:ro",
                    "nginx:1.28-alpine", "-t",
                ], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_실제_dev_prod_compose에서_Data_자격과_이미지가_전량교체된다(self) -> None:
        for environment in ("dev", "prod"):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                fixture = Fixture(directory)
                fixture.base.write_text((ROOT / "server/scripts" /
                                         f"docker-compose.{environment}.yml").read_text())
                fixture.shared.write_text(
                    "POSTGRES_DB=gromo\nPOSTGRES_USER=legacy-admin\nPOSTGRES_PASSWORD=legacy-password\n"
                    "ECR_REPO=registry.test/legacy\nIMAGE_TAG=old\nAPP_IMAGE=registry.test/legacy:old\n"
                    "DD_API_KEY=old-dd-secret\nJWT_SECRET=old-jwt\nGOOGLE_CLIENT_ID=old-google\n"
                    "APPLE_CLIENT_ID=old-apple\nFCM_PROJECT_ID=old-fcm\nFCM_SERVICE_ACCOUNT_JSON=old-fcm-json\n"
                    "OPENAI_API_KEY=old-openai\nNOTI_DB_PASSWORD=old-noti-password\n")
                # prod 기본 env_file의 실물이 있어도 최종 app에는 합쳐지면 안 된다.
                (fixture.root / ".env.prod").write_text(fixture.shared.read_text())
                result = run(fixture, "--environment", environment, "--project-name", "test-satellite")
                self.assertEqual(result.returncode, 0, result.stderr)
                config = subprocess.run([
                    "docker", "compose", "-p", "test-satellite", "-f", str(fixture.base),
                    "-f", str(ROOT / "server/scripts/docker-compose.satellites.yml"),
                    "-f", str(DATA_OVERLAY), "--env-file", str(fixture.shared),
                    "--env-file", str(fixture.output / "compose.env"), "config", "--format", "json",
                ], capture_output=True, text=True)
                self.assertEqual(config.returncode, 0, config.stderr)
                app = json.loads(config.stdout)["services"]["app"]
                self.assertEqual(app["image"], IMAGES["--data-image"])
                values = app["environment"]
                self.assertEqual(values["API_DB_USERNAME"], secret()["API_DB_USERNAME"])
                self.assertEqual(values["API_DB_PASSWORD"], secret()["API_DB_PASSWORD"])
                self.assertEqual(values["JWT_SECRET"], secret()["JWT_SECRET"])
                self.assertEqual(values["SPRING_PROFILES_ACTIVE"], f"{environment},satellites")
                self.assertNotIn("DD_API_KEY", values)
                self.assertNotIn("NOTI_DB_PASSWORD", values)
                self.assertNotIn("POSTGRES_PASSWORD", values)
                if environment == "prod":
                    self.assertIn("-javaagent:", values["JAVA_OPTS"])

    def test_서비스별_env_가_실제로_분리되고_compose_보간에는_비밀이_없다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture)
            self.assertEqual(result.returncode, 0, result.stderr)

            business = (fixture.output / "business-api.env").read_text(encoding="utf-8")
            notification = (fixture.output / "notification.env").read_text(encoding="utf-8")
            data = (fixture.output / "data-api.env").read_text(encoding="utf-8")

            for forbidden in ("API_DB_URL", "API_DB_PASSWORD", "NOTI_DB_PASSWORD", "OPENAI_API_KEY"):
                self.assertNotIn(f"{forbidden}=", business, f"Business 에 {forbidden} 가 들어갔다")
            for forbidden in ("API_DB_URL", "API_DB_PASSWORD", "JWT_SECRET", "OPENAI_API_KEY"):
                self.assertNotIn(f"{forbidden}=", notification, f"알림에 {forbidden} 가 들어갔다")
            for forbidden in ("NOTI_DB_URL", "NOTI_DB_PASSWORD"):
                self.assertNotIn(f"{forbidden}=", data, f"Data 에 {forbidden} 가 들어갔다")
            for text in (business, notification, data):
                self.assertNotIn("DD_API_KEY=", text)
                self.assertNotIn("GRAFANA_ADMIN_PASSWORD=", text)

            compose_env = (fixture.output / "compose.env").read_text(encoding="utf-8")
            for value in secret().values():
                self.assertNotIn(value, compose_env, "compose 보간 파일로 비밀이 샜다")
            self.assertIn("DATA_API_ENV_FILE=", compose_env)
            self.assertIn("BUSINESS_API_IMAGE=", compose_env)

    def test_표준출력과_절차_파일에_시크릿_값이_나오지_않는다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture)
            self.assertEqual(result.returncode, 0, result.stderr)
            plan = (fixture.output / "deploy-plan.txt").read_text(encoding="utf-8")
            for value in secret().values():
                self.assertNotIn(value, result.stdout)
                self.assertNotIn(value, result.stderr)
                self.assertNotIn(value, plan)
            self.assertIn("배포하지 않았다", result.stdout)
            self.assertIn("실패 복구 순서", plan)
            self.assertIn("nginx", plan)

    def test_생성물_권한이_0600_이고_디렉터리는_0700_이다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            self.assertEqual(run(fixture).returncode, 0)
            self.assertEqual(stat.S_IMODE(fixture.output.stat().st_mode), 0o700)
            for name in ("business-api.env", "notification.env", "data-api.env", "compose.env"):
                self.assertEqual(stat.S_IMODE((fixture.output / name).stat().st_mode), 0o600, name)

    def test_태그_이미지는_거부한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture, "--business-image", "example.registry.test/gromo/business:latest")
            self.assertEqual(result.returncode, 1)
            self.assertIn("digest", result.stderr)
            self.assertFalse(fixture.output.exists(), "실패한 준비가 산출물을 남겼다")

    def test_필수_시크릿이_빠지면_아무것도_쓰지_않는다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            payload = secret()
            del payload["SVC_TOKEN_BIZ_TO_NOTI"]
            result = run(fixture, payload=payload)
            self.assertEqual(result.returncode, 1)
            self.assertIn("SVC_TOKEN_BIZ_TO_NOTI", result.stderr)
            self.assertFalse((fixture.output / "business-api.env").exists())
            self.assertFalse((fixture.output / "compose.env").exists())

    def test_공유_env_가_없으면_예시로_넘어가지_않고_실패한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            fixture.shared.unlink()
            result = run(fixture)
            self.assertEqual(result.returncode, 1)
            self.assertIn("공유 env", result.stderr)

    def test_기존_compose_가_요구하는_보간_값이_없으면_실패한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            # 기존 환경이 요구하는데 공유 env 에도, 우리 파일에도 없는 변수.
            fixture.base.write_text(
                fixture.base.read_text(encoding="utf-8")
                + "      MISSING: ${GROMO_TEST_ONLY_ABSENT_VAR}\n", encoding="utf-8")
            environment = dict(os.environ)
            environment.pop("GROMO_TEST_ONLY_ABSENT_VAR", None)
            command = [sys.executable, str(SCRIPT), "--environment", "dev",
                       "--output-dir", str(fixture.output), "--base-compose", str(fixture.base),
                       "--shared-env-file", str(fixture.shared),
                       "--business-image", IMAGES["--business-image"],
                       "--notification-image", IMAGES["--notification-image"]]
            result = subprocess.run(command, input=json.dumps(secret()), text=True,
                                    capture_output=True, env=environment)
            self.assertEqual(result.returncode, 1)
            self.assertIn("GROMO_TEST_ONLY_ABSENT_VAR", result.stderr)

    def test_prod_는_프로젝트명을_요구한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture, "--environment", "prod", "--data-profiles", "prod,satellites")
            self.assertEqual(result.returncode, 1)
            self.assertIn("--project-name", result.stderr)
            # 이름을 주면 통과한다 — 요구 자체가 목적이 아니라 고아 스택을 막는 것이 목적이다.
            self.assertEqual(
                run(fixture, "--environment", "prod", "--project-name", "gromo-prod",
                    "--data-profiles", "prod,satellites").returncode, 0)

    def test_satellites_프로파일이_빠진_Data_는_실패한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture, "--data-profiles", "dev")
            self.assertEqual(result.returncode, 1)
            self.assertIn("satellites", result.stderr)

    def test_공유_env_파일을_덮어쓰려_하면_거부한다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            fixture.output.mkdir(mode=0o700, parents=True)
            shared = fixture.output / "compose.env"
            shared.write_text("POSTGRES_DB='gromo'\nAPP_IMAGE='registry.test/back:old'\n", encoding="utf-8")
            result = run(fixture, "--shared-env-file", str(shared))
            self.assertEqual(result.returncode, 1)
            self.assertIn("공유 env", result.stderr)

    def test_Data_를_빼면_오버레이도_절차에서_빠진다(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Fixture(directory)
            result = run(fixture, with_data=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((fixture.output / "data-api.env").exists())
            plan = (fixture.output / "deploy-plan.txt").read_text(encoding="utf-8")
            self.assertNotIn(DATA_OVERLAY.name, plan)
            self.assertIn("up -d business-api notification", plan)


class SatelliteRoutingExampleTest(unittest.TestCase):
    """nginx 예시가 «실제» Business 경로와 어긋나지 않는지 정적으로 본다."""

    def setUp(self) -> None:
        self.example = NGINX_EXAMPLE.read_text(encoding="utf-8")

    def test_Business_컨트롤러의_모든_공개_경로가_예시에_있다(self) -> None:
        mapping = re.compile(r'@(?:Get|Post|Put|Delete|Patch)Mapping\(\s*(?:value\s*=\s*)?"([^"]+)"')
        base = re.compile(r'@RequestMapping\("([^"]+)"\)')
        missing = []
        for path in sorted(BUSINESS_API.parent.rglob("*Controller.java")):
            text = path.read_text(encoding="utf-8")
            prefix_match = base.search(text)
            prefix = prefix_match.group(1) if prefix_match else ""
            for route in mapping.findall(text):
                full = prefix + route
                if full == "/health":
                    continue  # 헬스는 compose healthcheck 전용이다. 공개 라우팅을 주지 않는다.
                # {id} 를 뺀 «고정» 조각이 예시에 모두 등장하는지로 본다.
                segments = [s for s in full.split("/") if s and not s.startswith("{")]
                if not all(segment in self.example for segment in segments):
                    missing.append(full)
        self.assertEqual(missing, [], f"nginx 예시에 없는 Business 경로: {missing}")

    def test_health_는_공개_라우팅을_받지_않는다(self) -> None:
        for line in self.example.splitlines():
            if "proxy_pass" in line:
                continue
            if line.strip().startswith("location") and "/health" in line:
                self.fail("헬스 경로에 공개 location 이 생겼다")

    def test_internal_과_management_는_공개되지_않는다(self) -> None:
        self.assertIn("location ^~ /internal/admin/ {", self.example)
        self.assertIn("location ^~ /internal/ { return 404; }", self.example)
        self.assertIn("location ^~ /actuator/ { return 404; }", self.example)
        # /internal 이나 관리 포트로 가는 proxy_pass 가 단 하나도 없어야 한다.
        for line in self.example.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or "proxy_pass" not in stripped:
                continue
            self.assertNotIn("/internal", stripped)
            self.assertNotIn("9091", stripped)
        self.assertNotIn(":9091", self.example.replace("management(9091)", ""))

    def test_전용_IP_헤더_계약이_링크_서버와_같은_이름이다(self) -> None:
        # link/src/lib/auth.ts 의 clientIp() 가 읽는 헤더와 «같은 이름»이어야 한다.
        self.assertIn("X-Link-Client-IP", self.example)
        self.assertIn("X-Link-Proxy-Secret", self.example)
        self.assertNotIn("proxy_set_header X-Forwarded-For $", self.example)

    def test_실제_호스트나_비밀값이_박혀_있지_않다(self) -> None:
        self.assertIn("__BUSINESS_UPSTREAM__", self.example)
        self.assertIn("__LINK_PROXY_SECRET__", self.example)
        for pattern in (r"\d{1,3}(?:\.\d{1,3}){3}", r"[a-z0-9-]+\.(?:com|net|io|dev|app)\b"):
            found = [m for m in re.findall(pattern, self.example) if m not in ("1.1",)]
            self.assertEqual(found, [], f"예시에 실제 주소처럼 보이는 값이 있다: {found}")

    def test_호환_경로가_한시적임을_명시한다(self) -> None:
        self.assertIn("/l/match", self.example)
        self.assertIn("COMPAT_MATCH_HANDLER_ENABLED", self.example)


if __name__ == "__main__":
    unittest.main()
