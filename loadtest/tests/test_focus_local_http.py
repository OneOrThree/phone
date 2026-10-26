"""실제 k6 + localhost HTTP 서버로 응답 유실 세 가지와 원장/보상 수를 대조한다."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location('focus_capacity', SCRIPTS / 'aws-capacity.py')
capacity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capacity)
RUN = '00000000-0000-4000-8000-000000000001'
ISLAND = '00000000-0000-4000-8000-000000000003'
SESSION = '00000000-0000-4000-8000-000000000004'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Request-Id', self.headers.get('X-Request-Id', RUN))
        self.send_header('CF-Ray', '0123456789abcdef-ICN')
        self.end_headers()
        try:
            self.wfile.write(json.dumps({'data': data}).encode())
        except (BrokenPipeError, ConnectionResetError):
            pass

    def lose_response(self):
        self.connection.shutdown(socket.SHUT_RDWR)
        self.close_connection = True

    def do_GET(self):
        self.server.calls.append(('GET', self.path))
        if self.server.fault == 'current_null':
            self.reply(None)
        elif self.server.fault == 'current_foreign':
            self.reply({**self.server.current, 'subject': 'unrelated-run'})
        else:
            self.reply(self.server.current)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        key = self.headers['Idempotency-Key']
        self.server.calls.append(('POST', self.path, key))
        if self.path == '/focus-sessions':
            self.server.starts += 1
            self.server.current = {'id': SESSION, 'islandId': ISLAND, 'subject': body['subject'],
                'status': 'active', 'version': 1, 'startedAt': '2026-10-22T00:00:00Z'}
            self.server.outbox.append('start')
            if self.server.fault == 'start_interrupt':
                self.server.started.set()
                time.sleep(.5)
            if self.server.fault == 'start_response_lost':
                self.lose_response()
                return
            self.reply(self.server.current)
        elif self.path.endswith('/pause') or self.path.endswith('/resume'):
            self.server.current = {**self.server.current, 'version': self.server.current['version'] + 1,
                'status': 'paused' if self.path.endswith('/pause') else 'active'}
            self.reply(self.server.current)
        elif self.path.endswith('/finish'):
            self.server.finish_attempts += 1
            if self.server.fault == 'finish_send_failed' and self.server.finish_attempts == 1:
                self.lose_response()
                return
            if key not in self.server.completed_keys:
                self.server.completed_keys.add(key)
                self.server.settlements += 1
                self.server.outbox.append('finish')
                self.server.current = None
            if self.server.fault == 'finish_response_lost':
                self.lose_response()
                return
            self.reply({'recordId': SESSION})
        else:
            raise AssertionError('unexpected route')


class FocusLocalHttpTest(unittest.TestCase):
    def test_interrupt_after_saved_start_retains_intent_for_owned_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.daemon_threads = True
            server.fault, server.current = 'start_interrupt', None
            server.starts = server.settlements = server.finish_attempts = 0
            server.calls, server.outbox, server.completed_keys = [], [], set()
            server.started = threading.Event()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            out = Path(temporary)
            users = out / 'users.json'
            fixtures = [{'userId': RUN, 'token': 'private-token', 'islandId': ISLAND}]
            users.write_text(json.dumps(fixtures))
            args = SimpleNamespace(url=f'http://127.0.0.1:{server.server_port}', users=users,
                pre_vus=1, max_vus=1, run_id=RUN, journey_p95_limit=1000,
                p95_limit=2000, stop=capacity.StopController())
            def interrupt():
                if server.started.wait(5):
                    args.stop.reason = 'SIGINT'
            stopper = threading.Thread(target=interrupt, daemon=True)
            stopper.start()
            try:
                row = capacity.stage(args, {'id': 'focus_lifecycle', 'kind': 'write_journey'},
                    1, 20, 'focus-interrupt', out)
                self.assertEqual(row['verdict'], 'PARTIAL')
                ledger = capacity.read_focus_ledger(out, RUN)
                self.assertEqual(ledger['startedCycles'], 1)
                result = capacity.cleanup_focus(args.url, fixtures, 1, RUN, ledger)
                self.assertTrue(result['complete'], result)
                self.assertEqual(server.starts, 1)
                self.assertEqual(server.settlements, 1)
                self.assertIsNone(server.current)
                self.assertEqual(server.outbox, ['start', 'finish'])
            finally:
                server.shutdown()
                server.server_close()
                thread.join()
                stopper.join()

    def test_real_k6_response_loss_cases_match_mock_server_ledger(self):
        for fault in ['normal', 'start_response_lost', 'finish_send_failed', 'finish_response_lost', 'current_null', 'current_foreign']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temporary:
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                server.daemon_threads = True
                server.fault, server.current = fault, None
                server.starts = server.settlements = server.finish_attempts = 0
                server.calls, server.outbox, server.completed_keys = [], [], set()
                server.protected_session = {'id': 'outside-fixture', 'state': 'active'}
                protected = dict(server.protected_session)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    out = Path(temporary)
                    users = out / 'users.json'
                    users.write_text(json.dumps([{'userId': 'synthetic-user', 'token': 'private-token', 'islandId': ISLAND}]))
                    args = SimpleNamespace(url=f'http://127.0.0.1:{server.server_port}', users=users,
                        pre_vus=1, max_vus=1, run_id=RUN, journey_p95_limit=5000,
                        p95_limit=2000, stop=capacity.StopController())
                    row = capacity.stage(args, {'id': 'focus_lifecycle', 'kind': 'write_journey'},
                                         1, 1, 'focus-1rps', out)
                    ledger = capacity.read_focus_ledger(out, RUN)
                    cycles = server.starts
                    self.assertIn(cycles, (1, 2))
                    unconfirmed = fault in ('current_null', 'current_foreign')
                    self.assertEqual(server.settlements, 0 if unconfirmed else cycles)
                    self.assertEqual(server.outbox, ['start'] if unconfirmed else ['start', 'finish'] * cycles)
                    if not unconfirmed:
                        self.assertIsNone(server.current)
                    self.assertEqual(server.protected_session, protected)
                    self.assertEqual(ledger['startedCycles'], cycles)
                    self.assertEqual(ledger['finishedCycles'], cycles)
                    self.assertEqual(ledger['successfulCycles'], cycles if fault == 'normal' else cycles - 1 if fault == 'finish_send_failed' else 0)
                    self.assertEqual(ledger['unknownSettlements'], 1 if fault == 'finish_response_lost' or unconfirmed else 0)
                    self.assertEqual(ledger['serverLedger']['status'], 'NOT_COLLECTED')
                    self.assertNotIn('private-token', json.dumps(ledger))
                    self.assertNotIn('synthetic-user', json.dumps(ledger))
                    if fault == 'normal':
                        self.assertEqual(row['verdict'], 'PASS')
                        self.assertEqual(ledger['httpRequests'], 5 * cycles)
                    else:
                        self.assertNotEqual(row['verdict'], 'PASS')
                        if not unconfirmed:
                            self.assertEqual(ledger['firstFailure']['step'], 'start' if fault == 'start_response_lost' else 'finish')
                    finish_keys = [call[2] for call in server.calls if call[0] == 'POST' and call[1].endswith('/finish')]
                    self.assertEqual(len(finish_keys), 0 if unconfirmed else cycles + (fault == 'finish_send_failed'))
                    self.assertEqual(len(set(finish_keys)), 0 if unconfirmed else cycles)
                    self.assertTrue(all(finish_keys.count(key) <= 2 for key in set(finish_keys)))
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()


if __name__ == '__main__':
    unittest.main()
