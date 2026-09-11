"""신규 공개 API ingress의 실제 nginx 회귀 검사. Docker와 curl이 필수다.

실행: python3 -m unittest discover -s .github/scripts -p 'test_public_api_ingress.py'
운영 서버에 접속하지 않고 임시 컨테이너의 합성 upstream만 호출한다.
"""

import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[2]
IMAGE = "nginx:1.28-alpine"
PUBLIC_ROOTS = (
    "/auth/sessions", "/me", "/islands", "/focus-sessions", "/invitations",
    "/rankings", "/statistics", "/screens", "/link-previews",
)


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=90)


class PublicApiIngressTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="gromo-public-ingress-")
        cls.addClassCleanup(cls.temp.cleanup)
        cls.directory = Path(cls.temp.name)
        cls.name = "gromo-public-ingress-" + uuid.uuid4().hex[:12]
        cls.addClassCleanup(cls.remove_container)
        snippets = cls.directory / "snippets"
        snippets.mkdir()
        snippet = (ROOT / "server/scripts/nginx-satellites-proxy-headers.conf.example").read_text()
        (snippets / "gromo-satellites-proxy-headers.conf").write_text(
            snippet.replace("__LINK_PROXY_SECRET__", "synthetic-private-proof")
        )
        include = (ROOT / "server/scripts/nginx-satellites.include.conf.example").read_text()
        include = include.replace("__BUSINESS_UPSTREAM__", "business")
        include = include.replace("__NOTIFICATION_UPSTREAM__", "127.0.0.1:18082")
        (cls.directory / "routes.conf").write_text(include)
        fields = {
            "backend": "$server_port", "uri": "$request_uri", "method": "$request_method",
            "authorization": "$http_authorization", "key": "$http_idempotency_key",
            "user": "$http_x_user_id", "caller": "$http_x_caller",
            "callerId": "$http_x_caller_id", "internalCaller": "$http_x_internal_caller",
            "serviceCaller": "$http_x_service_caller", "ip": "$http_x_link_client_ip",
            "proof": "$http_x_link_proxy_secret", "forwarded": "$http_x_forwarded_for",
            "realIp": "$http_x_real_ip", "cloudflareIp": "$http_cf_connecting_ip",
            "contentType": "$http_content_type",
        }
        response = json.dumps(fields)
        # 외부 서비스 없이 같은 임시 nginx 안의 서로 다른 서버를 합성 upstream으로 쓴다.
        backends = "\n".join(
            f"""server {{
                listen {port};
                default_type application/json;
                access_log /tmp/business.log combined;
                location = /me/retry {{ return 502; }}
                location / {{ return 200 '{response}'; }}
            }}""" for port in (18080, 18081, 18082, 18083)
        )
        config = """events {}
        http {
            access_log off;
            upstream business {
                server 127.0.0.1:18080;
                server 127.0.0.1:18083;
            }
            server {
                listen 8080;
                # 상위 설정이 쓰기 재시도를 허용해도 신규 경로가 반드시 덮어써야 한다.
                proxy_next_upstream error timeout http_502 non_idempotent;
                include /fixtures/routes.conf;
                location ~ ^/api/ { proxy_pass http://127.0.0.1:18081; }
                location / { proxy_pass http://127.0.0.1:18081; }
            }
        """ + backends + "\n}\n"
        (cls.directory / "nginx.conf").write_text(config)
        run("docker", "run", "--detach", "--rm", "--name", cls.name,
            "--publish", "127.0.0.1::8080",
            "--volume", f"{cls.directory}:/fixtures:ro",
            "--volume", f"{snippets}:/etc/nginx/snippets:ro",
            "--entrypoint", "nginx", IMAGE, "-c", "/fixtures/nginx.conf", "-g", "daemon off;")
        mapped = run("docker", "port", cls.name, "8080/tcp").stdout.strip()
        cls.base = "http://" + mapped
        deadline = time.monotonic() + 15
        while True:
            try:
                status, _ = cls.request("/probe")
                if status == 200:
                    break
            except (subprocess.CalledProcessError, ValueError):
                pass
            if time.monotonic() >= deadline:
                raise AssertionError("임시 nginx 기동 실패: " + run("docker", "logs", cls.name).stderr)
            time.sleep(0.1)

    @classmethod
    def remove_container(cls):
        # 이 테스트가 생성한 정확한 이름만 정리한다.
        subprocess.run(["docker", "rm", "--force", cls.name],
                       capture_output=True, text=True, timeout=30, check=False)

    @classmethod
    def request(cls, path, method="GET", headers=(), body=None):
        args = ["curl", "--silent", "--show-error", "--max-time", "5", "--path-as-is",
                "--request", method, "--write-out", "\n%{http_code}"]
        for header in headers:
            args.extend(("--header", header))
        if body is not None:
            args.extend(("--data-binary", body))
        response = run(*args, cls.base + path).stdout
        payload, status = response.rsplit("\n", 1)
        return int(status), payload

    def assert_backend(self, path, ports=("18080", "18083"), **kwargs):
        status, payload = self.request(path, **kwargs)
        self.assertEqual(200, status, (path, payload))
        actual = json.loads(payload)
        self.assertIn(actual["backend"], ports, path)
        self.assertEqual(path, actual["uri"])
        return actual

    def test_public_roots_and_children_keep_uri_and_query(self):
        for root in PUBLIC_ROOTS:
            for suffix in ("", "/", "/child?cursor=abc%2Fdef&limit=20"):
                with self.subTest(path=root + suffix):
                    self.assert_backend(root + suffix)

    def test_similar_prefixes_and_other_apis_keep_legacy_backend(self):
        for root in PUBLIC_ROOTS:
            with self.subTest(path=root + "-other"):
                self.assert_backend(root + "-other", ports=("18081",))
        for path in ("/auth", "/auth/other", "/api/v1/users/me", "/api/v1/groups", "/other"):
            self.assert_backend(path, ports=("18081",))

    def test_private_surfaces_are_denied_and_admin_is_preserved(self):
        for path in ("/internal", "/internal/", "/internal/commands", "/actuator",
                     "/actuator/health", "/%69nternal/commands", "/%61ctuator/health"):
            with self.subTest(path=path):
                self.assertEqual(404, self.request(path)[0])
        admin = self.assert_backend("/internal/admin/jobs", ports=("18082",),
                                    headers=("Authorization: Bearer synthetic-console",))
        self.assertEqual("Bearer synthetic-console", admin["authorization"])

    def test_app_credentials_survive_and_external_delegation_is_removed(self):
        headers = ("Authorization: Bearer synthetic-app", "Idempotency-Key: synthetic-key",
                   "Content-Type: application/json", "X-User-Id: forged-user", "X-Caller: forged",
                   "X-Caller-Id: forged", "X-Internal-Caller: forged", "X-Service-Caller: forged",
                   "X-Link-Client-IP: 192.0.2.1", "X-Link-Proxy-Secret: forged",
                   "X-Forwarded-For: 192.0.2.2", "X-Real-IP: 192.0.2.3",
                   "CF-Connecting-IP: 192.0.2.4")
        for method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            actual = self.assert_backend("/islands/example/orders", method=method,
                                         headers=headers, body='{"productId":"synthetic"}')
            self.assertEqual(method, actual["method"])
            self.assertEqual("Bearer synthetic-app", actual["authorization"])
            self.assertEqual("synthetic-key", actual["key"])
            self.assertEqual("application/json", actual["contentType"])
            for field in ("user", "caller", "callerId", "internalCaller", "serviceCaller",
                          "ip", "proof", "forwarded", "realIp", "cloudflareIp"):
                self.assertEqual("", actual[field], field)
        duplicate = self.assert_backend("/me", headers=("Idempotency-Key: first", "Idempotency-Key: second"))
        self.assertEqual("first, second", duplicate["key"])

    def test_legacy_preview_and_link_transition_remain_intact(self):
        for path in ("/api/v1/link-previews", "/api/v1/link-previews/example/thumbnail"):
            self.assert_backend(path)
        for path in ("/api/v1/users/me/device-token", "/api/v1/users/me/notification-settings",
                     "/api/v1/groups/00000000-0000-0000-0000-000000000001/invite-link",
                     "/api/v1/invite-links/claim",
                     "/api/v1/me/challenge-results/00000000-0000-0000-0000-000000000001/claim",
                     "/api/v1/me/challenge-results/00000000-0000-0000-0000-000000000001/ack",
                     "/l/match"):
            actual = self.assert_backend(path, headers=("X-Link-Proxy-Secret: forged",))
            self.assertEqual("synthetic-private-proof", actual["proof"])
            self.assertNotEqual("", actual["ip"])
        self.assertEqual(503, self.request("/l/example")[0])
        self.assertEqual(503, self.request("/l/referrer")[0])

    def test_failed_write_is_not_retried_on_another_upstream(self):
        status, _ = self.request("/me/retry", method="POST", body='{"command":"synthetic"}')
        self.assertEqual(502, status)
        logs = run("docker", "exec", self.name, "cat", "/tmp/business.log").stdout
        attempts = [line for line in logs.splitlines() if '"POST /me/retry ' in line]
        self.assertEqual(1, len(attempts), attempts)


if __name__ == "__main__":
    unittest.main()
