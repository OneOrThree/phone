"""실제 Redis에서 미리보기 Lua와 서비스별 ACL 경계를 검증한다."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

SPEC = importlib.util.spec_from_file_location("writer", Path(__file__).with_name("write-compose-env.py"))
WRITER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WRITER)


class BusinessRedisAclTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = "synthetic-business-redis-password"
        cls.directory = tempfile.TemporaryDirectory()
        cls.acl = Path(cls.directory.name) / "business.acl"
        WRITER.write_atomic(cls.acl, WRITER.business_redis_acl(
            {"BUSINESS_REDIS_PASSWORD": cls.password}), mode=0o644)
        cls.name = "gromo-redis-acl-" + uuid.uuid4().hex[:12]
        subprocess.run(["docker", "run", "--rm", "-d", "--name", cls.name,
                        "--mount", f"type=bind,source={cls.acl},target=/etc/redis/business.acl,readonly",
                        "redis:7-alpine", "redis-server", "--aclfile", "/etc/redis/business.acl",
                        "--save", "", "--appendonly", "no"], check=True, capture_output=True, text=True)
        cls.addClassCleanup(subprocess.run, ["docker", "stop", cls.name], capture_output=True)
        cls.addClassCleanup(cls.directory.cleanup)
        for _ in range(50):
            if "PONG" in cls.command("PING", user="health", password=""):
                return
            time.sleep(0.1)
        raise AssertionError("Redis ACL health 준비 실패")

    @classmethod
    def command(cls, *args, user="business", password=None):
        command = ["docker", "exec", cls.name, "redis-cli", "--raw", "--no-auth-warning"]
        if user is not None:
            command += ["--user", user, "--pass", cls.password if password is None else password]
        return subprocess.run(command + list(args), capture_output=True, text=True, timeout=10).stdout.strip()

    def test_미리보기_캐시와_원자_레이트리밋은_허용된다(self):
        key = "cache:business:preview:user:entry"
        self.assertEqual(self.command("SET", key, "PENDING", "NX", "EX", "90"), "OK")
        self.assertEqual(self.command("GET", key), "PENDING")
        script = "local n=redis.call('INCRBY',KEYS[1],ARGV[1]); if n==tonumber(ARGV[1]) then redis.call('EXPIRE',KEYS[1],60) end; return n"
        digest = self.command("SCRIPT", "LOAD", script)
        self.assertEqual(self.command("EVALSHA", digest, "1", "cache:business:rate:user", "2"), "2")
        self.assertEqual(self.command("EVAL", script, "1", "cache:business:rate:user", "3"), "5")

    def test_다른_키와_관리_명령은_스크립트에서도_거부된다(self):
        for args in [("GET", "noti:secret"), ("SET", "auth:rt:user", "value"),
                     ("CONFIG", "GET", "*"), ("ACL", "LIST"), ("FLUSHALL",)]:
            with self.subTest(args=args):
                self.assertIn("NOPERM", self.command(*args))
        self.assertIn("permissions", self.command(
            "EVAL", "return redis.call('GET','noti:secret')", "0"))

    def test_비인증과_틀린_비밀번호는_거부하고_health는_ping만_허용한다(self):
        self.assertIn("NOAUTH", self.command("PING", user=None))
        self.assertNotEqual(self.command("PING", password="wrong"), "PONG")
        self.assertEqual(self.command("PING", user="health", password=""), "PONG")
        self.assertIn("NOPERM", self.command("GET", "cache:business:preview:user:entry", user="health", password=""))
        self.assertNotIn(self.password, self.acl.read_text())


if __name__ == "__main__":
    unittest.main()
