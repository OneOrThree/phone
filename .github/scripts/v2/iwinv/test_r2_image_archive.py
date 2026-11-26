import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("r2-image-archive.py")
SPEC = importlib.util.spec_from_file_location("r2_image_archive", SCRIPT_PATH)
MOD = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MOD)


class R2ImageArchiveTest(unittest.TestCase):
    def test_object_key_accepts_all_five_services_and_two_slots(self):
        for slot in ("a", "b"):
            for svc in ("data-api", "realtime", "business-api", "notification", "backoffice"):
                self.assertEqual(MOD.object_key(slot, svc), f"images/{slot}/{svc}.tar.gz")
        with self.assertRaises(ValueError):
            MOD.object_key("c", "data-api")
        with self.assertRaises(ValueError):
            MOD.object_key("a", "unknown")

    def test_endpoint_and_bucket_validation(self):
        valid = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/"
        self.assertEqual(MOD.validate_endpoint(valid), valid.rstrip("/"))
        for bad in (
            "http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
            "https://s3.ap-northeast-2.amazonaws.com",
            "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/extra",
            "https://short.r2.cloudflarestorage.com",
        ):
            with self.assertRaises(ValueError):
                MOD.validate_endpoint(bad)
        self.assertEqual(MOD.validate_bucket("cattus-releases"), "cattus-releases")
        with self.assertRaises(ValueError):
            MOD.validate_bucket("INVALID_BUCKET")

    def test_fetch_and_verify_detects_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "img.tar.gz"
            payload = b"fake-tar-gz-bytes"
            good_sha = hashlib.sha256(payload).hexdigest()
            bad_sha = "0" * 64
            endpoint = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"
            manifest = {
                "service": "data-api",
                "slot": "a",
                "key": "images/a/data-api.tar.gz",
                "sha256": good_sha,
            }

            def fake_transfer(direction, ep, bkt, key, local_path, env):
                local_path.write_bytes(payload)

            with mock.patch.object(MOD, "s3_transfer", side_effect=fake_transfer):
                MOD.fetch_and_verify(manifest, dest, endpoint, "cattus-releases", {})
                manifest["sha256"] = bad_sha
                with self.assertRaises(ValueError):
                    MOD.fetch_and_verify(manifest, dest, endpoint, "cattus-releases", {})

    def test_merge_manifests_builds_deploy_compatible_schema(self):
        with tempfile.TemporaryDirectory() as td:
            p1 = Path(td) / "data-api.json"
            p2 = Path(td) / "backoffice.json"
            p1.write_text(json.dumps({
                "service": "data-api", "slot": "a", "key": "images/a/data-api.tar.gz",
                "revision": "abc123", "image": "cattus-iwinv/data-api:v1",
                "sha256": "a" * 64, "bytes": 100,
            }), encoding="utf-8")
            p2.write_text(json.dumps({
                "service": "backoffice", "slot": "a", "key": "images/a/backoffice.tar.gz",
                "revision": "abc123", "image": "cattus-iwinv/backoffice:v1",
                "sha256": "b" * 64, "bytes": 200,
            }), encoding="utf-8")
            combined = MOD.merge_manifests([p1, p2], "catus-iwinv-v1.0.0", "rel-1", "a", "abc123")
            self.assertEqual(combined["platform"], "linux/amd64")
            self.assertEqual(set(combined["archives"].keys()), {"data-api", "backoffice"})
            self.assertEqual(combined["archives"]["backoffice"]["bytes"], 200)


if __name__ == "__main__":
    unittest.main()
