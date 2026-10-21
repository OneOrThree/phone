"""AWS 시크릿에서 공개 SDK 설정만 내보내는 경계를 검증한다."""

import json
from pathlib import Path
import subprocess
import sys
import unittest


SCRIPT = Path(__file__).with_name("posthog-sdk-config.py")


class PostHogSdkConfigTest(unittest.TestCase):
    def run_config(self, **overrides):
        secret = {
            "POSTHOG_PROJECT_TOKEN": "phc_test123",
            "POSTHOG_REGION": "https://us.i.posthog.com",
            "PLAY_SERVICE_ACCOUNT_JSON": "private-play-key",
            "ANDROID_UPLOAD_STORE_PASSWORD": "private-store-password",
            "POSTHOG_CLI_API_KEY": "private-personal-key",
        }
        secret.update(overrides)
        return subprocess.run(
            [sys.executable, str(SCRIPT)], input=json.dumps(secret),
            text=True, capture_output=True, check=False,
        )

    def test_only_public_sdk_settings_are_exported(self):
        result = self.run_config()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), [
            "posthog-project-token=phc_test123",
            "posthog-host=https://us.i.posthog.com",
            "posthog-cli-host=https://us.posthog.com",
        ])

    def test_cloud_names_and_urls_resolve_to_matching_hosts(self):
        for region, cloud in [
            ("US", "us"), ("US Cloud", "us"),
            ("EU", "eu"), ("EU Cloud", "eu"),
            ("https://eu.i.posthog.com/", "eu"),
            ("https://eu.posthog.com", "eu"),
        ]:
            with self.subTest(region=region):
                result = self.run_config(POSTHOG_REGION=region)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f"posthog-host=https://{cloud}.i.posthog.com\n", result.stdout)
                self.assertIn(f"posthog-cli-host=https://{cloud}.posthog.com\n", result.stdout)

    def test_missing_or_invalid_token_fails_without_partial_output(self):
        for token in [None, "", " ", 123, "phx_personal", "phc_test\nINJECT=value"]:
            with self.subTest(token=token):
                result = self.run_config(POSTHOG_PROJECT_TOKEN=token)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("POSTHOG_PROJECT_TOKEN", result.stderr)
                self.assertNotIn("private-", result.stderr)

    def test_missing_or_unknown_region_fails_without_partial_output(self):
        for region in [None, "", 123, "ap-northeast-2", "https://invalid.example"]:
            with self.subTest(region=region):
                result = self.run_config(POSTHOG_REGION=region)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("POSTHOG_REGION", result.stderr)

    def test_invalid_secret_json_does_not_echo_credentials(self):
        for value in ["private-invalid-json", "[]", "null"]:
            with self.subTest(value=value):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT)], input=value,
                    text=True, capture_output=True, check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertNotIn(value, result.stderr)


if __name__ == "__main__":
    unittest.main()
