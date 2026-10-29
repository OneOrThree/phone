"""dev 배포 조합 그대로 렌더해 4개 서비스의 로그 메타데이터(OBS_*)가 서비스·환경·배포 커밋과 맞는지 확인한다(GROMO-2555).

조합은 deploy-core-dev.py(Data·Realtime)와 satellite-cd.dev.yml(Business·Notification)의 compose 파일 순서와 같다.
렌더에 필요한 값은 전부 합성이며 비밀이 아니다. 어긋난 OBS 값이 배포 전에 걸러지는지는
test_deploy_core_dev.py 와 test_prepare_satellite_deploy.py 가 본다.
"""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "server" / "scripts"
REVISION = "0123456789abcdef0123456789abcdef01234567"
DIGEST = "example.test/gromo/{}@sha256:" + "ab" * 32


def render(files, extra_env, directory):
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("OBS_", "DEPLOY_ENV", "IMAGE_", "APP_IMAGE"))}
    env.update({"DEPLOY_ENV": "dev", "IMAGE_REVISION": REVISION, "POSTGRES_DB": "gromo", "POSTGRES_USER": "u",
                "POSTGRES_PASSWORD": "p", "APP_IMAGE": DIGEST.format("data"), "IMAGE_VERSION": REVISION, "JWT_SECRET": "j", "SVC_TOKEN_REALTIME_TO_DATA": "t",
                "REDIS_DATA_PASSWORD": "synthetic-data", "REDIS_REALTIME_PASSWORD": "synthetic-realtime"}, **extra_env)
    command = ["docker", "compose", "-p", "obs-metadata-test"]
    for name in files:
        command += ["-f", str(SCRIPTS / f"docker-compose.{name}.yml")]
    result = subprocess.run(command + ["config", "--format", "json"], env=env, cwd=directory,
                            capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)["services"]


class ObsMetadataTest(unittest.TestCase):
    def assert_metadata(self, services, expected):
        for service in expected:
            with self.subTest(service=service):
                environment = services[service]["environment"]
                self.assertEqual(environment["OBS_SERVICE"], service)
                self.assertEqual(environment["OBS_ENV"], "dev")
                self.assertEqual(environment["OBS_VERSION"], REVISION)
                self.assertEqual(environment["DD_TRACE_128_BIT_TRACEID_LOGGING_ENABLED"], "true")

    def test_data_and_realtime_follow_core_deploy_order(self):
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory) / "empty.env"
            empty.write_text("")
            for overlays in ([], ["datadog", "kafka"]):
                with self.subTest(overlays=overlays):
                    services = render(["dev", *overlays, "realtime", "satellites.data.dev"], {
                        "APP_IMAGE": DIGEST.format("data"), "REALTIME_IMAGE": DIGEST.format("realtime"),
                        "DATA_API_ENV_FILE": str(empty), "DATA_API_PROFILES": "dev,satellites,realtime-authorization",
                        "DD_API_KEY": "x"}, directory)
                    self.assert_metadata(services, ["data-api", "realtime"])

    def test_business_and_notification_follow_satellite_deploy_order(self):
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory) / "empty.env"
            empty.write_text("")
            services = render(["dev", "satellites", "satellites.dev"], {
                "BUSINESS_API_IMAGE": DIGEST.format("business"), "NOTIFICATION_IMAGE": DIGEST.format("notification"),
                "BUSINESS_API_ENV_FILE": str(empty), "NOTIFICATION_ENV_FILE": str(empty)}, directory)
            self.assert_metadata(services, ["business-api", "notification"])

    def test_missing_revision_renders_unknown_so_the_deploy_checks_can_reject_it(self):
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory) / "empty.env"
            empty.write_text("")
            env = {"BUSINESS_API_IMAGE": DIGEST.format("business"), "NOTIFICATION_IMAGE": DIGEST.format("notification"),
                   "BUSINESS_API_ENV_FILE": str(empty), "NOTIFICATION_ENV_FILE": str(empty), "IMAGE_REVISION": ""}
            services = render(["dev", "satellites", "satellites.dev"], env, directory)
            self.assertEqual(services["business-api"]["environment"]["OBS_VERSION"], "unknown")


if __name__ == "__main__":
    unittest.main()
