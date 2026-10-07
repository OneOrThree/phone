"""Play Developer API 최소 클라이언트 (GROMO-2223). 표준 라이브러리 + openssl CLI 만 씀.

키 다루는 잡에서 pip 설치(서드파티 코드 실행)를 없애려고 google-auth 대신 직접 구현.
서비스 계정 JWT → OAuth 토큰 교환 → REST 호출.
"""
import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SCOPE = "https://www.googleapis.com/auth/androidpublisher"
API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def access_token(sa_path: str) -> str:
    with open(sa_path, encoding="utf-8") as f:
        sa = json.load(f)
    now = int(time.time())
    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = _b64(json.dumps({
        "iss": sa["client_email"], "scope": SCOPE, "aud": sa["token_uri"],
        "iat": now, "exp": now + 600,
    }).encode())
    signing_input = f"{header}.{claims}".encode()
    # 개인 키는 0600 임시 파일로만, 서명 직후 지움
    fd, key_path = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(sa_path)))
    try:
        with os.fdopen(fd, "w") as k:
            k.write(sa["private_key"])
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_path],
                             input=signing_input, capture_output=True, check=True).stdout
    finally:
        os.remove(key_path)
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": f"{header}.{claims}.{_b64(sig)}",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(sa["token_uri"], data=body), timeout=30) as r:
        return json.load(r)["access_token"]


class Play:
    def __init__(self, sa_path: str, package: str):
        self.token = access_token(sa_path)
        self.base = f"{API}/{package}"

    def call(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Authorization": f"Bearer {self.token}",
                                              "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raise SystemExit(f"::error::Play API {method} {path} {e.code}: {e.read()[:300]!r}")

    def read_edit(self):
        """조회용 edit 를 열어 (edit_id) 를 넘기고, 끝나면 커밋 없이 지우는 컨텍스트."""
        play = self

        class _Edit:
            def __enter__(self):
                self.id = play.call("POST", "/edits", {})["id"]
                return self.id

            def __exit__(self, *exc):
                play.call("DELETE", f"/edits/{self.id}")

        return _Edit()



