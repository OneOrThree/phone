"""공유 Redis 실제 ACL·영속화 및 배포 전환 관문 회귀. 외부 주소에 접속하지 않는다."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid
import yaml

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


writer = load("shared_writer", ROOT / ".github/scripts/write-compose-env.py")
guard = load("shared_guard", ROOT / ".github/scripts/check-shared-redis.py")
retirement = load("retirement", ROOT / "server/scripts/check-redis-retirement.py")


class SharedRedisTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.secret = dict(REDIS_DATA_PASSWORD="synthetic-data", REDIS_REALTIME_PASSWORD="synthetic-realtime",
                          BUSINESS_REDIS_PASSWORD="synthetic-business")
        cls.directory = tempfile.TemporaryDirectory()
        cls.acl = Path(cls.directory.name) / "shared.acl"
        cls.acl.write_text(writer.shared_redis_acl(cls.secret))
        cls.name = "gromo-shared-test-" + uuid.uuid4().hex[:12]
        subprocess.run(["docker", "run", "-d", "--rm", "--network", "none", "--name", cls.name,
                        "-v", f"{cls.acl}:/etc/redis/shared.acl:ro", "redis:7.4.11-alpine",
                        "redis-server", "--aclfile", "/etc/redis/shared.acl", "--maxmemory", "128mb",
                        "--maxmemory-policy", "noeviction", "--appendonly", "yes"],
                       check=True, capture_output=True)
        cls.addClassCleanup(cls.directory.cleanup)
        cls.addClassCleanup(subprocess.run, ["docker", "stop", cls.name], capture_output=True)
        cls.wait()

    @classmethod
    def command(cls, user, *args):
        password = "synthetic-" + user if user != "health" else ""
        return subprocess.run(["docker", "exec", cls.name, "redis-cli", "--raw", "--no-auth-warning",
                               "--user", user, "--pass", password, *args],
                              capture_output=True, text=True, check=True, timeout=10).stdout.strip()

    @classmethod
    def wait(cls):
        for _ in range(50):
            if cls.command("health", "PING") == "PONG":
                return
            time.sleep(0.1)
        raise AssertionError("로컬 Redis 기동 실패")

    def test_roles_cannot_write_or_read_other_namespaces(self):
        self.assertEqual(self.command("data", "SET", "presence:focus:u", "1"), "OK")
        self.assertEqual(self.command("realtime", "GET", "presence:focus:u"), "1")
        self.assertIn("NOPERM", self.command("realtime", "SET", "presence:focus:u", "0"))
        self.assertIn("NOPERM", self.command("business", "GET", "presence:focus:u"))
        self.assertIn("NOPERM", self.command("data", "GET", "cache:business:revoked-session:sid"))
        for role in ["data", "realtime", "business"]:
            self.assertIn("NOPERM", self.command(role, "FLUSHALL"))
            self.assertIn("NOPERM", self.command(role, "ACL", "LIST"))
        self.assertEqual(self.command("realtime", "PUBLISH", "chat:fanout", "fixture"), "0")
        self.assertIn("NOPERM", self.command("business", "PUBLISH", "chat:fanout", "fixture"))
        self.assertIn("NOPERM", self.command("realtime", "PUBLISH", "noti:events", "fixture"))
        self.assertEqual(self.command("realtime", "EVAL",
                         "redis.call('TIME'); return redis.call('INCR',KEYS[1])", "1", "movement:epoch"), "1")

    def test_compose_healthcheck_authenticates_and_rejects_invalid_account(self):
        for environment in ("dev", "prod"):
            with self.subTest(environment=environment):
                source = ROOT / "server/scripts" / f"docker-compose.{environment}.yml"
                check = yaml.safe_load(source.read_text())["services"]["redis"]["healthcheck"]["test"]
                self.assertEqual(check[0], "CMD")
                command = ["docker", "exec", self.name, *check[1:]]
                result = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertEqual((result.returncode, result.stdout.strip()), (0, "PONG"))
                command[command.index("health")] = "missing-account"
                failed = subprocess.run(command, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(failed.returncode, 0)

    def test_actual_preview_scripts_work_with_generated_acl(self):
        root = ROOT / "server/business-api/src/main/resources/redis"
        slots = [f"cache:business:preview:slot:v1:{i}" for i in range(64)]
        marker = "cache:business:withdrawn:fixture"
        def script(name, keys, *args):
            return self.command("business", "EVAL", (root / f"preview-{name}.lua").read_text(),
                                str(len(keys)), *keys, *args)
        self.assertEqual(script("claim", slots + [marker], "fixture:id", "fixture", "g", '{"pending":true}'), "1")
        self.assertEqual(script("complete", slots + [marker], "fixture:id", "g", '{"ready":true}', "300"), "1")
        self.assertEqual(script("find", slots + [marker], "fixture:id"), '{"ready":true}')
        self.assertEqual(script("erase", slots + [marker, "cache:business:rate:fixture"], "fixture",
                                str(int(time.time() * 1000) + 60000)), "1")
        self.assertEqual(script("claim", slots + [marker], "fixture:next", "fixture", "g", "{}"), "0")

    def test_restart_preserves_marker_and_ttl(self):
        key = "cache:business:revoked-session:restart"
        self.assertEqual(self.command("business", "SET", key, "1", "EX", "60"), "OK")
        subprocess.run(["docker", "restart", self.name], capture_output=True, check=True, timeout=20)
        self.wait()
        self.assertEqual(self.command("business", "GET", key), "1")
        self.assertIn("noeviction", self.command("health", "CONFIG", "GET", "maxmemory-policy"))


class TransitionGuardTest(unittest.TestCase):
    def test_legacy_requires_bridge_even_with_correct_shared_acl(self):
        acl = b"fixture"
        state = {"Config": {"Env": ["ACL_REVISION=" + hashlib.sha256(acl).hexdigest()],
                 "Cmd": ["redis-server", "--maxmemory", "384mb", "--maxmemory-policy", "noeviction",
                         "--appendonly", "yes", "--appendfsync", "everysec",
                         "--aclfile", "/etc/redis/shared.acl"]},
                 "HostConfig": {"Memory": 576 * 1024 * 1024},
                 "State": {"Health": {"Status": "healthy"}}}
        with self.assertRaises(ValueError):
            guard.check({}, acl, state, "old")
        guard.check({"BUSINESS_REDIS_LEGACY_HOST": "business-redis", "BUSINESS_REDIS_LEGACY_PASSWORD": "fixture"},
                    acl, state, "old")
        with self.assertRaises(ValueError):
            guard.check({}, b"changed", state, "")
        state["HostConfig"]["Memory"] = 0
        with self.assertRaisesRegex(ValueError, "메모리 한도"):
            guard.check({}, acl, state, "")

    def test_retirement_requires_supported_image_and_elapsed_marker_lifetime(self):
        now = datetime.now(timezone.utc)
        app = {"Config": {"Labels": {"com.oneorthree.redis-layout": "shared-v1"},
                         "Env": ["BUSINESS_REDIS_HOST=redis", "BUSINESS_REDIS_LEGACY_HOST=business-redis"]},
               "State": {"Health": {"Status": "healthy"}, "StartedAt": (now - timedelta(hours=3)).isoformat()}}
        retirement.check(app, now, 7200)
        app["State"]["StartedAt"] = now.isoformat()
        with self.assertRaises(ValueError):
            retirement.check(app, now, 7200)
