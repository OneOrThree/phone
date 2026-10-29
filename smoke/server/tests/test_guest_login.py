"""실제 curl 장애와 가상 시계로 재시도·예산·복구 자격의 경계를 검증한다."""
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
import signal
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('guest_login', HERE / 'guest_login.py')
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)
USER = '11111111-1111-4111-8111-111111111111'
SUCCESS = json.dumps({'data': {'accessToken': 'secret-access', 'refreshToken': 'secret-refresh',
                              'userId': USER, 'onboardingComplete': False}})
TIMEOUT = ('504', 0, '{"error":{"code":"UPSTREAM_TIMEOUT"}}')


class FakeTime:
    def __init__(self):
        self.now, self.waits = 0, []

    def clock(self):
        return self.now

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds


class RetryTests(unittest.TestCase):
    def run_case(self, responses, **kwargs):
        self.clock, self.rows, self.requests = FakeTime(), [], []
        config = login.settings({})
        config.update(kwargs.pop('config', {}))
        responses = iter(responses)
        def request(remaining):
            self.requests.append(remaining)
            return next(responses)
        return login.run_login('main', config, request, lambda _role: True, self.rows.append,
                               clock=self.clock.clock, sleep=self.clock.sleep, **kwargs)

    def test_first_success_has_no_wait_or_retry(self):
        result = self.run_case([('201', 0, SUCCESS)])
        self.assertEqual((result['attempts'], result['retries'], result['result']), (1, 0, 'success'))
        self.assertEqual(self.clock.waits, [])

    def test_success_after_two_timeouts_waits_exactly_five_seconds_each(self):
        result = self.run_case([TIMEOUT, TIMEOUT, ('201', 0, SUCCESS)])
        self.assertEqual(self.clock.waits, [5, 5])
        self.assertEqual((result['attempts'], result['retries']), (3, 2))
        self.assertEqual(result['first_error'], 'UPSTREAM_TIMEOUT')
        self.assertEqual(result['elapsed_ms'], 10000)
        self.assertEqual([row['waited_ms'] for row in self.rows if row['kind'] == 'attempt'], [0, 5000, 5000])
        self.assertNotIn('secret-', json.dumps(self.rows))

    def test_repeated_timeout_stops_without_a_final_sleep(self):
        result = self.run_case([TIMEOUT] * 3)
        self.assertEqual((result['result'], len(self.requests), self.clock.waits), ('max_attempts', 3, [5, 5]))

    def test_zero_retries_restores_one_shot(self):
        result = self.run_case([TIMEOUT], config={'retries': 0})
        self.assertEqual((result['attempts'], self.clock.waits), (1, []))

    def test_deadline_does_not_sleep_if_next_request_cannot_start(self):
        result = self.run_case([TIMEOUT], config={'total': 5})
        self.assertEqual((result['result'], self.clock.waits), ('deadline', []))

    def test_budget_exhaustion_does_not_sleep_or_send_again(self):
        result = self.run_case([TIMEOUT], available=lambda _role: False)
        self.assertEqual((result['result'], result['attempts'], self.clock.waits), ('budget_exhausted', 1, []))

    def test_error_allowlist_does_not_retry_auth_contract_or_rate_limit(self):
        cases = [('429', 0, '{"error":{"code":"RATE_LIMITED"}}'),
                 ('401', 0, '{}'), ('403', 0, '{}'), ('500', 0, '{}'),
                 ('502', 0, '{"error":{"code":"UPSTREAM_AUTH_FAILED"}}'),
                 ('502', 0, '{"error":{"code":"UPSTREAM_CONTRACT_ERROR"}}'),
                 ('503', 0, '{"error":{"code":"SECRET_PAYLOAD"}}'),
                 ('503', 0, '{"error":{"code":{}}}'),
                 ('503', 0, '{"error":{"message":"secret-access"}}'),
                 ('201', 0, '{"data":{}}'), ('201', 0, 'invalid-json'), ('000', 60, '')]
        for response in cases:
            with self.subTest(response=response[:2]):
                result = self.run_case([response])
                self.assertEqual((result['result'], result['attempts']), ('non_retryable', 1))
                self.assertEqual(self.clock.waits, [])
                self.assertNotIn('SECRET_PAYLOAD', json.dumps(self.rows))

    def test_gateway_and_transport_errors_can_recover(self):
        for response in [('502', 0, '<html>gateway</html>'), ('503', 0, ''), ('504', 0, ''),
                         ('503', 0, '{"error":{"code":"SERVICE_UNAVAILABLE"}}'),
                         *[('000', rc, '') for rc in (7, 28, 52, 56)]]:
            with self.subTest(response=response[:2]):
                result = self.run_case([response, ('201', 0, SUCCESS)])
                self.assertEqual(result['result'], 'success')
                self.assertEqual(self.clock.waits, [5])

    def test_received_non_retryable_status_or_app_error_wins_over_transport_failure(self):
        responses = [(code, rc, '') for code in ('400', '401', '403', '429', '500') for rc in (28, 52, 56)]
        responses += [('502', 28, '{"error":{"code":"UPSTREAM_AUTH_FAILED"}}'),
                      ('503', 56, '{"error":{"code":"UPSTREAM_CONTRACT_ERROR"}}')]
        for response in responses:
            with self.subTest(response=response):
                result = self.run_case([response])
                self.assertEqual((result['result'], result['attempts'], self.clock.waits), ('non_retryable', 1, []))

    def test_invalid_configuration_is_rejected(self):
        for env in [{'SMOKE_AUTH_MAX_RETRIES': '3'}, {'SMOKE_AUTH_MAX_RETRIES': '-1'},
                    {'SMOKE_AUTH_TOTAL_TIMEOUT_SECONDS': '41'}, {'SMOKE_HTTP_TIMEOUT': 'NaN'},
                    {'SMOKE_CONNECT_TIMEOUT': '0'}, {'SMOKE_GUEST_ROLES': 'main,main'}]:
            with self.subTest(env=env), self.assertRaises(ValueError):
                login.settings(env)

    def test_late_success_is_not_accepted_and_deadline_is_rechecked_after_sleep(self):
        config, fake, rows = login.settings({}), FakeTime(), []
        def late_request(_remaining):
            fake.now = 40
            return '201', 0, SUCCESS
        result = login.run_login('main', config, late_request, lambda _: True, rows.append,
                                 clock=fake.clock, sleep=fake.sleep)
        self.assertEqual(result['result'], 'deadline')
        calls = []
        fake.now = 0
        def request(_remaining):
            calls.append(True)
            return TIMEOUT
        def delayed_sleep(_seconds):
            fake.now = 41
        result = login.run_login('main', config, request, lambda _: True, rows.append,
                                 clock=fake.clock, sleep=delayed_sleep)
        self.assertEqual((result['result'], len(calls)), ('deadline', 1))


class SharedBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'requests.json'
        self.budget = login.budget.RequestBudget(self.path, login.ROLES)

    def test_future_initial_logins_are_reserved_even_after_earlier_retries(self):
        for role, attempts in [('main', 3), ('friend-owner', 3), ('friend-peer', 2)]:
            for _ in range(attempts):
                self.assertTrue(self.budget.claim(role))
        self.assertFalse(self.budget.available('friend-peer'))
        self.assertFalse(self.budget.claim('friend-peer'))
        self.assertTrue(self.budget.claim('core'))
        self.assertTrue(self.budget.claim('statistics'))
        self.assertEqual(sum(json.loads(self.path.read_text())['counts'].values()), 10)

    def test_separate_child_process_uses_the_same_budget(self):
        self.assertTrue(self.budget.claim('main'))
        script = '''import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('budget',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
assert module.RequestBudget(Path(sys.argv[2]), sys.argv[3].split(',')).claim('core')
'''
        subprocess.run(['python3', '-c', script, str(HERE / 'guest-budget.py'), str(self.path),
                        ','.join(sorted(login.ROLES))], check=True, capture_output=True)
        self.assertEqual(json.loads(self.path.read_text())['counts'], {'main': 1, 'core': 1})

    def test_concurrent_claims_cannot_exceed_limit_and_invalid_state_fails_closed(self):
        def claim(role):
            return login.budget.RequestBudget(self.path, login.ROLES).claim(role)
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(claim, sorted(login.ROLES) * 3))
        self.assertEqual(sum(results), 10)
        self.path.write_text('{broken')
        with self.assertRaises(ValueError):
            self.budget.claim('main')

    def test_budget_lock_cannot_wait_past_login_deadline(self):
        self.budget.claim('main')
        with self.path.with_name(self.path.name + '.lock').open('a+') as locked:
            login.fcntl.flock(locked, login.fcntl.LOCK_EX)
            waiting = login.budget.RequestBudget(self.path, login.ROLES, deadline=time.monotonic() + .05)
            self.assertFalse(waiting.claim('core'))
        self.assertNotIn('core', json.loads(self.path.read_text())['counts'])

    def test_interrupted_budget_write_preserves_prior_requests(self):
        self.assertTrue(self.budget.claim('main'))
        previous = self.path.read_text()
        with patch.object(login.budget.json, 'dump', side_effect=OSError('write interrupted')):
            with self.assertRaises(OSError):
                self.budget.claim('core')
        self.assertEqual(self.path.read_text(), previous)
        self.assertEqual(list(self.path.parent.glob('requests.json.*')), [self.path.with_name('requests.json.lock')])
        self.assertTrue(self.budget.claim('main'))
        self.assertEqual(json.loads(self.path.read_text())['counts'], {'main': 2})

    def test_existing_empty_budget_is_not_treated_as_a_new_run(self):
        self.path.write_text('')
        with self.assertRaises(ValueError):
            self.budget.claim('main')


class RealHttpTests(unittest.TestCase):
    def test_rate_limit_headers_with_slow_body_are_not_retried(self):
        with tempfile.TemporaryDirectory() as temporary:
            calls = []
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass

                def do_POST(self):
                    calls.append(True)
                    self.send_response(429)
                    self.end_headers()
                    self.wfile.flush()
                    time.sleep(.3)
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.daemon_threads = True
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                config, rows, waits = login.settings({'SMOKE_HTTP_TIMEOUT': '.1'}), [], []
                request = login.CurlRequest(Path(temporary), {'BASE_URL': f'http://127.0.0.1:{server.server_port}'},
                                            str(uuid.uuid4()), config)
                result = login.run_login('main', config, request, lambda _: True, rows.append, sleep=waits.append)
                self.assertEqual((result['result'], result['http_code'], result['curl_rc']), ('non_retryable', '429', 28))
                self.assertEqual((len(calls), result['attempts'], waits), (1, 1, []))
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_termination_during_request_or_retry_wait_sends_no_more_requests(self):
        for during_request in (False, True):
            with self.subTest(during_request=during_request), tempfile.TemporaryDirectory() as temporary:
                seen = threading.Event()
                calls = []
                class Handler(BaseHTTPRequestHandler):
                    def log_message(self, *_args):
                        pass

                    def do_POST(self):
                        calls.append(True)
                        seen.set()
                        if during_request:
                            time.sleep(2)
                            return
                        self.send_response(504)
                        self.end_headers()
                        self.wfile.write(TIMEOUT[2].encode())
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                server.daemon_threads = True
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                diagnostic = Path(temporary) / 'auth-attempts.jsonl'
                env = {**os.environ, 'BASE_URL': f'http://127.0.0.1:{server.server_port}',
                       'SMOKE_GUEST_DEVICE_ID': str(uuid.uuid4()), 'SMOKE_GUEST_ROLES': 'main',
                       'SMOKE_GUEST_STATE_DIR': temporary + '/state',
                       'SMOKE_AUTH_DIAGNOSTICS_FILE': str(diagnostic)}
                process = subprocess.Popen(['python3', str(HERE / 'guest_login.py'), '--directory',
                                            temporary, '--role', 'main'], env=env,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    self.assertTrue(seen.wait(3))
                    if not during_request:
                        deadline = time.monotonic() + 2
                        while not diagnostic.exists() and time.monotonic() < deadline:
                            time.sleep(.01)
                        self.assertTrue(diagnostic.exists())
                    process.send_signal(signal.SIGTERM)
                    stdout, stderr = process.communicate(timeout=2)
                    self.assertEqual(process.returncode, 143, (stdout, stderr))
                    self.assertEqual(len(calls), 1)
                    self.assertFalse((Path(temporary) / 'auth-result.json').exists())
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()
                    server.shutdown()
                    server.server_close()
                    thread.join()

    def test_real_curl_recovers_after_timeout_or_lost_response_with_same_device(self):
        for mode in ('timeout', 'lost-response'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                devices, users = [], {}
                class Handler(BaseHTTPRequestHandler):
                    def log_message(self, *_args):
                        pass

                    def do_POST(self):
                        device = self.headers.get('X-Device-Id')
                        devices.append(device)
                        users.setdefault(device, USER)
                        if len(devices) == 1:
                            if mode == 'timeout':
                                time.sleep(.15)
                            self.connection.close()
                            return
                        self.send_response(201)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('X-Device-Bootstrap', 'secret-bootstrap')
                        self.end_headers()
                        self.wfile.write(SUCCESS.encode())
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                server.daemon_threads = True
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    directory, fake, rows = Path(temporary), FakeTime(), []
                    device = str(uuid.uuid4())
                    marker = directory / 'last-request'
                    env = {'BASE_URL': f'http://127.0.0.1:{server.server_port}',
                           'SMOKE_GUEST_LAST_REQUEST_FILE': str(marker)}
                    config = login.settings({'SMOKE_HTTP_TIMEOUT': '0.05'})
                    request = login.CurlRequest(directory, env, device, config)
                    result = login.run_login('main', config, request, lambda _: True, rows.append,
                                             clock=fake.clock, sleep=fake.sleep)
                    self.assertEqual((result['result'], result['attempts']), ('success', 2))
                    self.assertEqual(devices, [device, device])
                    self.assertEqual(len(users), 1)
                    self.assertEqual(fake.waits, [5])
                    self.assertEqual(json.loads((directory / 'body.json').read_text())['data']['userId'], USER)
                    self.assertIn('secret-bootstrap', (directory / 'headers').read_text())
                    self.assertGreaterEqual(int(marker.read_text()), int(time.time()) - 2)
                    for secret in (device, 'secret-access', 'secret-refresh', 'secret-bootstrap', USER):
                        self.assertNotIn(secret, json.dumps(rows))
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()


if __name__ == '__main__':
    unittest.main()
