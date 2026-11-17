"""macOS에서 실제 Mach-O/dSYM UUID로 배포 차단을 검사한다. 네트워크는 쓰지 않는다."""

import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest

APP = Path(__file__).resolve().parents[2]


class SentryArchiveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sentry archive test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        self.script = self.root / "scripts/sentry-xcode.sh"
        shutil.copy(APP / "scripts/sentry-xcode.sh", self.script)
        self.cli = self.root / "sentry-cli"
        self.calls = self.root / "calls.jsonl"
        self.cli.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['TEST_CALLS'], 'a') as f:
    f.write(json.dumps(sys.argv[1:]) + '\\n')
assert os.environ['SENTRY_ALLOW_FAILURE'] == 'false'
if sys.argv[1] == 'info':
    print(json.dumps({'auth': {'successful': os.environ.get('TEST_AUTH') != 'false'}}))
sys.exit(int(os.environ.get('TEST_CLI_EXIT', '0')))
""")
        self.cli.chmod(0o755)
        self.env = {key: value for key, value in os.environ.items() if not key.startswith("SENTRY_")}
        self.env.update(
            HOME=str(self.root), SENTRY_AUTH_TOKEN="test-placeholder",
            SENTRY_DOTENV_PATH=str(self.root / "missing.env"),
            SENTRY_CLI_EXECUTABLE=str(self.cli), TEST_CALLS=str(self.calls),
        )
        self.archive = self.root / "Cattus test.xcarchive"
        self.app = self.archive / "Products/Applications/Cattus.app"
        self.app.mkdir(parents=True)
        self.plist(self.archive / "Info.plist", {"ApplicationProperties": {"ApplicationPath": "Applications/Cattus.app"}})
        self.plist(self.app / "Info.plist", {"CFBundleExecutable": "Cattus"})
        source = self.root / "main.c"
        source.write_text("int main(void) { return 0; }\n")
        self.binary = self.app / "Cattus"
        subprocess.run(["xcrun", "clang", "-g", str(source), "-o", str(self.binary)], env=self.env, check=True, capture_output=True)
        self.dsym = self.archive / "dSYMs/Cattus.app.dSYM"
        self.dsym.parent.mkdir()
        subprocess.run(["xcrun", "dsymutil", str(self.binary), "-o", str(self.dsym)], env=self.env, check=True, capture_output=True)

    @staticmethod
    def plist(path, value):
        path.write_bytes(plistlib.dumps(value))

    def run_gate(self, mode, **env):
        result = subprocess.run(
            ["/bin/bash", str(self.script), mode, str(self.archive)],
            env={**self.env, **env}, capture_output=True, text=True,
        )
        self.output = result.stdout + result.stderr
        return result.returncode

    def cli_calls(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def test_valid_auth(self):
        self.assertEqual(self.run_gate("check-release"), 0, self.output)

    def test_missing_token_blocks_before_cli(self):
        self.assertNotEqual(self.run_gate("check-release", SENTRY_AUTH_TOKEN=""), 0)
        self.assertEqual(self.cli_calls(), [])

    def test_existing_but_invalid_token_file_blocks(self):
        token_file = self.root / "empty.env"
        token_file.touch()
        self.assertNotEqual(self.run_gate("check-release", SENTRY_AUTH_TOKEN="", SENTRY_DOTENV_PATH=str(token_file), TEST_AUTH="false"), 0)

    def test_auth_command_failure_blocks(self):
        self.assertNotEqual(self.run_gate("check-release", TEST_CLI_EXIT="1"), 0)

    def test_disable_flags_block_both_gates(self):
        for flag in ("SENTRY_DISABLE_AUTO_UPLOAD", "SENTRY_DISABLE_XCODE_DEBUG_UPLOAD"):
            for mode in ("check-release", "archive"):
                with self.subTest(flag=flag, mode=mode):
                    self.assertNotEqual(self.run_gate(mode, **{flag: "true"}), 0)
        self.assertEqual(self.cli_calls(), [])

    def test_matching_dsym_requires_uuid_and_server_processing(self):
        self.assertEqual(self.run_gate("archive"), 0, self.output)
        calls = self.cli_calls()
        self.assertEqual(len(calls), 2)
        self.assertIn("--require-all", calls[0])
        self.assertIn("--wait", calls[0])
        self.assertIn("--wait", calls[1])
        uuid = subprocess.check_output(["xcrun", "dwarfdump", "--uuid", str(self.binary)], env=self.env, text=True).split()[1]
        self.assertEqual(calls[0][calls[0].index("--id") + 1], uuid)
        self.assertEqual(calls[0][-1], str(self.dsym))

    def test_missing_dsym_blocks_before_upload(self):
        shutil.rmtree(self.dsym)
        self.assertNotEqual(self.run_gate("archive"), 0)
        self.assertEqual(self.cli_calls(), [])

    def test_different_build_dsym_blocks_before_upload(self):
        source = self.root / "other.c"
        source.write_text("int main(void) { return 7; }\n")
        subprocess.run(["xcrun", "clang", "-g", str(source), "-o", str(self.binary)], env=self.env, check=True, capture_output=True)
        self.assertNotEqual(self.run_gate("archive"), 0)
        self.assertEqual(self.cli_calls(), [])
        self.assertIn("UUID", self.output)

    def test_upload_failure_cannot_be_ignored(self):
        self.assertNotEqual(self.run_gate("archive", TEST_CLI_EXIT="1", SENTRY_ALLOW_FAILURE="true"), 0)
        self.assertEqual(len(self.cli_calls()), 1)


if __name__ == "__main__":
    unittest.main()
