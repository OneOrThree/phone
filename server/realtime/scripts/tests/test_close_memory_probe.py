"""클라이언트 성공만으로 서버 OOM/관측 누락을 성공 처리하지 않는 회귀."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import subprocess

spec = importlib.util.spec_from_file_location("close_probe", Path(__file__).parents[1] / "close-memory-probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class RecoveryGateTest(unittest.TestCase):
    def sample(self, memory):
        return {"running": True, "oomKilled": False, "restartCount": 0, "health": "UP", "memory": memory,
                "metrics": ["realtime_websocket_sessions 0.0", "realtime_stomp_sessions 0.0",
                            'executor_queued_tasks{name="realtime-outbound"} 0.0']}

    def test_complete_measurement_accepts_recovery(self):
        self.assertTrue(probe.recovered(self.sample("1024000\noom 0\noom_kill 0\n")))

    def test_missing_or_partial_cgroup_measurement_rejects_recovery(self):
        for memory in ["", "1024000\n", "1024000\noom 0\n", "oom 0\noom_kill 0\n"]:
            with self.subTest(memory=memory):
                self.assertFalse(probe.recovered(self.sample(memory)))

    def test_oom_event_rejects_recovery_even_if_process_is_running(self):
        self.assertFalse(probe.recovered(self.sample("1024000\noom 1\noom_kill 0\n")))

    def test_remaining_session_or_queue_rejects_recovery(self):
        for metric in ["realtime_websocket_sessions 1.0", "realtime_stomp_sessions 1.0",
                       'executor_queued_tasks{name="realtime-outbound"} 1.0']:
            sample = self.sample("1024000\noom 0\noom_kill 0\n")
            sample["metrics"] = [line for line in sample["metrics"] if line.split()[0] != metric.split()[0]] + [metric]
            with self.subTest(metric=metric):
                self.assertFalse(probe.recovered(sample))


class CloseAndCleanupTest(unittest.TestCase):
    def test_normal_requires_peer_close_frame_and_code_1000(self):
        for code, received in [(1006, None), (None, None), (1000, None), (1001, object())]:
            socket = SimpleNamespace(close_code=code, protocol=SimpleNamespace(close_rcvd=received))
            self.assertFalse(probe.close_result([socket], "normal")["passed"])
            self.assertTrue(probe.close_result([socket], "forced")["passed"])
        socket = SimpleNamespace(close_code=1000, protocol=SimpleNamespace(close_rcvd=object()))
        self.assertTrue(probe.close_result([socket], "normal")["passed"])

    def test_cleanup_query_failure_is_not_empty_success(self):
        with patch.object(probe, "docker", side_effect=["run", "", RuntimeError("daemon unavailable")]):
            self.assertEqual(probe.cleanup_resources(["app"], False, "network", "run"),
                             ["app:cleanup_unverified"])

    def test_cleanup_timeout_does_not_skip_next_resource(self):
        with patch.object(probe, "docker", side_effect=[subprocess.TimeoutExpired("docker", 1), "run", "", ""]) as docker:
            self.assertEqual(probe.cleanup_resources(["db", "app"], False, "network", "run"),
                             ["app:cleanup_unverified"])
            self.assertEqual(docker.call_count, 4)

    def test_cleanup_preserves_different_label(self):
        with patch.object(probe, "docker", return_value="another-run") as docker:
            self.assertEqual(probe.cleanup_resources(["app"], True, "network", "run"),
                             ["app:label_mismatch", "network:label_mismatch"])
            self.assertEqual(docker.call_count, 2)


if __name__ == "__main__":
    unittest.main()
