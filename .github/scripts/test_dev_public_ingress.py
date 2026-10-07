"""dev 공개 Nginx가 2.0 서비스만 연결하는지 실제 Nginx로 검증한다."""

from pathlib import Path
import json
import subprocess
import tempfile
import time
import unittest
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
ROUTES = ROOT / "server/scripts/nginx-dev-2.0-routes.conf.example"


class DevPublicIngressTest(unittest.TestCase):
    def test_realtime_host_port_is_loopback_only(self):
        compose = ROOT / "server/scripts/docker-compose.realtime.yml"
        base = ROOT / "server/scripts/docker-compose.dev.yml"
        with tempfile.TemporaryDirectory(prefix="gromo-realtime-port-") as directory:
            env = Path(directory) / "env"
            env.write_text("APP_IMAGE=example/data:dev\nREALTIME_IMAGE=example/realtime:dev\n")
            result = subprocess.run(
                ["docker", "compose", "--env-file", str(env), "-f", str(base),
                 "-f", str(compose), "config", "--format", "json"],
                check=True, capture_output=True, text=True,
            )
        ports = json.loads(result.stdout)["services"]["realtime"]["ports"]
        self.assertTrue(any(port["host_ip"] == "127.0.0.1"
                            and int(port["published"]) == 8081
                            and int(port["target"]) == 8081 for port in ports))
        self.assertFalse(any(port["host_ip"] in ("", "0.0.0.0", "::") for port in ports))

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="gromo-dev-ingress-")
        cls.addClassCleanup(cls.temp.cleanup)
        directory = Path(cls.temp.name)
        (directory / "routes.conf").write_text(ROUTES.read_text())
        (directory / "nginx.conf").write_text("""events {}
http {
    server {
        listen 8080;
        include /fixtures/routes.conf;
    }
    server {
        listen 8083;
        location / { return 200 'business'; }
    }
    server {
        listen 8081;
        location / { return 200 'realtime:$http_upgrade:$http_connection'; }
    }
}
""")
        cls.container = "gromo-dev-ingress-" + uuid.uuid4().hex[:12]
        cls.addClassCleanup(cls.remove_container)
        subprocess.run(["docker", "run", "-d", "--rm", "--name", cls.container,
                        "-p", "127.0.0.1::8080", "-v", f"{directory}:/fixtures:ro",
                        "nginx:1.28-alpine", "nginx", "-c", "/fixtures/nginx.conf",
                        "-g", "daemon off;"], check=True, capture_output=True, text=True)
        port = subprocess.run(["docker", "port", cls.container, "8080/tcp"],
                              check=True, capture_output=True, text=True).stdout.strip().split(":")[-1]
        cls.base = f"http://127.0.0.1:{port}"
        for _ in range(30):
            try:
                cls.get("/health")
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError("Nginx가 기동하지 않았습니다")

    @classmethod
    def remove_container(cls):
        subprocess.run(["docker", "rm", "-f", cls.container], capture_output=True)

    @classmethod
    def get(cls, path, headers=None):
        try:
            with urlopen(Request(cls.base + path, headers=headers or {}), timeout=5) as response:
                return response.status, response.read().decode()
        except HTTPError as error:
            with error:
                return error.code, error.read().decode()

    def test_2_0_business_and_realtime_routes(self):
        for path, expected in (
            ("/auth/sessions/guest", "business"),
            ("/screens/board", "business"),
            ("/api/v1/users/me/device-token", "business"),
            ("/api/v1/users/me/notification-settings", "business"),
            ("/api/v1/link-previews", "business"),
            ("/health", "business"),
            ("/ws/realtime", "realtime::upgrade"),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.get(path), (200, expected))

    def test_realtime_upgrade_headers_reach_upstream(self):
        self.assertEqual(
            self.get("/ws/realtime", {"Upgrade": "websocket", "Connection": "Upgrade"}),
            (200, "realtime:websocket:upgrade"),
        )

    def test_legacy_and_internal_routes_are_closed(self):
        for path in ("/api/v1/users/me", "/api/v1/users/me/device-token-extra",
                     "/internal/admin/status", "/actuator/health", "/old", "/ws/chat"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path)[0], 404)


if __name__ == "__main__":
    unittest.main()
