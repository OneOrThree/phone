"""전용 fixture라도 현재 실행 소유가 아니면 쓰지 않는 사후 정리 계약."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from loadtest_focus import assess_focus_stage, cleanup_focus, read_focus_ledger, fixture_fingerprint, validate_focus_fixtures

RUN = '00000000-0000-4000-8000-000000000001'
JOURNEY = '00000000-0000-4000-8000-000000000002'
ISLAND = '00000000-0000-4000-8000-000000000003'
SESSION = '00000000-0000-4000-8000-000000000004'
USER = {'userId': 'private-user-id', 'token': 'private-token', 'islandId': ISLAND}


class FocusCleanupTest(unittest.TestCase):
    def test_malformed_initial_current_is_unknown_and_never_written(self):
        for initial in ({}, {'id': JOURNEY}, {'id': SESSION}):
            with self.subTest(initial=initial), tempfile.TemporaryDirectory() as temporary:
                ledger = self.ledger(Path(temporary))
                calls = []
                def request(user, method, *args):
                    calls.append(method)
                    return {'status': 200, 'data': initial}
                result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=request)
                self.assertEqual(calls, ['GET'])
                self.assertFalse(result['complete'])
                self.assertEqual(result['unknown'], 1)
                self.assertEqual(result['preservedForeign'], 0)

    def test_malformed_current_after_acknowledged_finish_remains_unknown(self):
        for after in ({}, {'id': JOURNEY}, {'id': SESSION}):
            with self.subTest(after=after), tempfile.TemporaryDirectory() as temporary:
                ledger = self.ledger(Path(temporary))
                initial = {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}', 'islandId': ISLAND,
                           'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}
                replies = iter([{'status': 200, 'data': initial},
                    {'status': 200, 'data': {'recordId': SESSION}}, {'status': 200, 'data': after}])
                result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=lambda *args: next(replies))
                self.assertEqual(result['finished'], 1)
                self.assertFalse(result['complete'])
                self.assertEqual(result['unknown'], 1)
                self.assertIsNone(result['checks'][0]['remainingOwnedActive'])

    def test_after_get_failure_is_unconfirmed_not_cleaned(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary))
            initial = {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}', 'islandId': ISLAND,
                       'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}
            replies = iter([{'status': 200, 'data': initial}, {'status': 200, 'data': {'recordId': SESSION}},
                            {'status': 503, 'data': None}])
            result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=lambda *args: next(replies))
        self.assertIsNone(result['checks'][0]['remainingOwnedActive'])
        self.assertFalse(result['complete'])
        self.assertEqual(result['unknown'], 1)

    def multi_ledger(self, out, count):
        users = [dict(USER, token=f'token-{i}') for i in range(count)]
        events = [dict(type='focus_request', phase='intent', step='start', runId=RUN,
                       journeyId=f'00000000-0000-4000-8000-1000000000{i:02d}', fixtureAlias=f'fixture-{i + 1}',
                       fixtureFingerprint=fixture_fingerprint(users)) for i in range(count)]
        (out / 'stage-http-diagnostics.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
        return users, read_focus_ledger(out, RUN)

    def test_truncated_chunked_body_is_unknown_and_cleanup_continues(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.server.gets += 1
                self.wfile.write(b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n')
                if self.server.gets == 1:
                    self.wfile.write(b'20\r\n{"da')  # 청크 길이만큼 못 채우고 끊김 -> IncompleteRead
                else:
                    self.wfile.write(b'd\r\n{"data":null}\r\n0\r\n\r\n')
                self.close_connection = True
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.gets = 0
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                users, ledger = self.multi_ledger(Path(temporary), 2)
                result = cleanup_focus(f'http://127.0.0.1:{server.server_port}', users, 2, RUN, ledger)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(server.gets, 2)  # 첫 계정 응답 유실 뒤에도 둘째 계정까지 진행
        self.assertEqual(result['checks'][0]['reason'], 'CURRENT_RESPONSE_UNCONFIRMED')
        self.assertIsNone(result['checks'][0]['remainingOwnedActive'])
        self.assertEqual(result['checks'][1]['ownership'], 'NONE')
        self.assertEqual((result['failed'], result['complete']), (1, False))

    def test_finish_failures_count_toward_consecutive_error_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            users, ledger = self.multi_ledger(Path(temporary), 4)
            posts = []
            def request(user, method, path, body, headers):
                alias = users.index(user)
                if method == 'GET':
                    return {'status': 200, 'data': {'id': SESSION, 'subject': f'lt:{RUN}:00000000-0000-4000-8000-1000000000{alias:02d}',
                        'islandId': ISLAND, 'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}}
                posts.append(alias)
                return {'status': 503, 'data': None}
            result = cleanup_focus('http://localhost', users, 4, RUN, ledger, request=request)
        self.assertEqual(len(posts), 3)
        self.assertEqual(result['failed'], 3)
        self.assertEqual(result['uncheckedAccounts'], 1)
        self.assertFalse(result['complete'])

    def ledger(self, out, users=None):
        event = dict(type='focus_request', phase='intent', step='start', runId=RUN,
                     journeyId=JOURNEY, fixtureAlias='fixture-1', fixtureFingerprint=fixture_fingerprint(users or [USER]), sessionId=None,
                     idempotencyKey='00000000-0000-4000-8000-000000000005', expectedVersion=None)
        (out / 'stage-http-diagnostics.jsonl').write_text(json.dumps(event) + '\n')
        return read_focus_ledger(out, RUN)

    def test_only_run_owned_current_is_finished_and_other_user_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            second = dict(USER, token='another-token')
            ledger = self.ledger(Path(temporary), [USER, second])
            current = {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}', 'islandId': ISLAND,
                       'version': 2, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}
            foreign = dict(current, id='00000000-0000-4000-8000-000000000099', subject='다른 실행의 주제')
            state = {'fixture-1': current, 'fixture-2': foreign}
            calls = []

            def request(user, method, path, body, headers):
                alias = 'fixture-1' if user is USER else 'fixture-2'
                calls.append((alias, method, path))
                if method == 'GET':
                    return {'status': 200, 'data': state[alias]}
                self.assertEqual(alias, 'fixture-1')
                self.assertEqual(body, {'expectedVersion': 2})
                state[alias] = None
                return {'status': 200, 'data': {'recordId': SESSION}}

            summary = cleanup_focus('http://localhost', [USER, second], 2,
                                    RUN, ledger, request=request)
            self.assertEqual(summary['finished'], 1)
            self.assertEqual(summary['preservedForeign'], 1)
            self.assertIs(state['fixture-2'], foreign)
            self.assertEqual(sum(method == 'POST' for _, method, _ in calls), 1)
            self.assertNotIn('private-token', json.dumps(summary))
            self.assertNotIn('private-user-id', json.dumps(summary))
            self.assertNotIn('다른 실행의 주제', json.dumps(summary))

    def test_uppercase_fixture_island_matches_lowercase_server_session(self):
        island = 'abcdefab-cdef-4bcd-8bcd-abcdefabcdef'
        user = dict(USER, islandId=island.upper())
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary), [user])
            state = {'cur': {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}', 'islandId': island,
                             'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}}
            def request(u, method, path, body, headers):
                if method == 'GET':
                    return {'status': 200, 'data': state['cur']}
                state['cur'] = None
                return {'status': 200, 'data': {'recordId': SESSION}}
            result = cleanup_focus('http://localhost', [user], 1, RUN, ledger, request=request)
        self.assertEqual((result['finished'], result['preservedForeign']), (1, 0))
        self.assertTrue(result['complete'], result)

    def test_foreign_session_does_not_resolve_unconfirmed_settlement(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary))  # 시작 intent 만 있고 종료 확인은 없는 여정
            foreign = {'id': '00000000-0000-4000-8000-000000000099', 'subject': '다른 실행의 주제', 'islandId': ISLAND,
                       'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}
            methods = []
            def request(u, method, *args):
                methods.append(method)
                return {'status': 200, 'data': foreign}
            result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=request)
        self.assertEqual(methods, ['GET'])  # 다른 실행 세션은 건드리지 않는다
        self.assertEqual(result['preservedForeign'], 1)
        self.assertGreaterEqual(result['unknown'], 1)
        self.assertFalse(result['complete'])

    def test_preflight_never_finishes_an_existing_session_even_with_matching_intent(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary))
            calls = []
            def request(user, method, path, body, headers):
                calls.append(method)
                return {'status': 200, 'data': {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}',
                    'islandId': ISLAND, 'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}}
            result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=request, preflight=True)
            self.assertEqual(calls, ['GET'])
            self.assertFalse(result['complete'])
            self.assertEqual(result['preservedForeign'], 1)

    def test_unknown_finish_and_empty_current_do_not_claim_settlement_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary))
            responses = iter([
                {'status': 200, 'data': {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}',
                    'islandId': ISLAND, 'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}},
                {'status': 0, 'data': None}, {'status': 200, 'data': None}])
            methods, snapshots = [], []
            def request(user, method, path, body, headers):
                methods.append(method)
                return next(responses)
            result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=request,
                checkpoint=lambda value: snapshots.append(json.loads(json.dumps(value))))
            self.assertEqual(methods, ['GET', 'POST', 'GET'])
            self.assertEqual(result['finished'], 0)
            self.assertEqual(result['unknown'], 1)
            self.assertFalse(result['complete'])
            self.assertTrue(result['checks'][0]['needsServerLedger'])
            self.assertTrue(any(r['checks'][0].get('idempotencyKey') for r in snapshots))

    def test_finish_replay_uses_original_key_and_never_retries_known_409_or_second_replay(self):
        for status, replay, expected_posts in [(0, False, 1), (409, False, 0), (0, True, 0)]:
            with self.subTest(status=status, replay=replay), tempfile.TemporaryDirectory() as temporary:
                out = Path(temporary)
                self.ledger(out)
                key = '00000000-0000-4000-8000-000000000006'
                with (out / 'stage-http-diagnostics.jsonl').open('a') as file:
                    for phase in ['intent', 'response']:
                        file.write(json.dumps(dict(type='focus_request', phase=phase, step='finish', runId=RUN,
                            journeyId=JOURNEY, fixtureAlias='fixture-1', fixtureFingerprint=fixture_fingerprint([USER]), sessionId=SESSION,
                            idempotencyKey=key, expectedVersion=2, status=status, replay=replay)) + '\n')
                ledger = read_focus_ledger(out, RUN)
                active = {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}', 'islandId': ISLAND,
                          'version': 2, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}
                posts = []
                def request(user, method, path, body, headers):
                    if method == 'GET':
                        return {'status': 200, 'data': None if posts else active}
                    posts.append(headers['Idempotency-Key'])
                    return {'status': 200, 'data': {'recordId': SESSION}}
                cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=request)
                self.assertEqual(len(posts), expected_posts)
                if posts:
                    self.assertEqual(posts, [key])

    def test_missing_intent_or_mismatched_run_does_not_authorize_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = read_focus_ledger(Path(temporary), RUN)
            ledger['fixtureFingerprint'] = fixture_fingerprint([USER])
            calls = []
            def request(user, method, path, body, headers):
                calls.append(method)
                return {'status': 200, 'data': {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}',
                    'islandId': ISLAND, 'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}}
            result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger, request=request)
            self.assertEqual(calls, ['GET'])
            self.assertEqual(result['preservedForeign'], 0)
            self.assertFalse(result['complete'])
            self.assertEqual(result['unknown'], 1)
            self.assertEqual(result['checks'][0]['ownership'], 'UNKNOWN')
            with self.assertRaises(ValueError):
                cleanup_focus('http://localhost', [USER], 1, JOURNEY, ledger, request=request)

    def test_empty_current_keeps_unacknowledged_start_unknown(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary))
            result = cleanup_focus('http://localhost', [USER], 1, RUN, ledger,
                request=lambda *args: {'status': 200, 'data': None})
            self.assertFalse(result['complete'])
            self.assertEqual(result['finished'], 0)
            self.assertEqual(result['unknown'], 1)

    def test_child_cleanup_checkpoint_reuses_original_key_at_most_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary)
            self.ledger(out)
            key = '00000000-0000-4000-8000-000000000005'
            check = dict(fixtureAlias='fixture-1', journeyId=JOURNEY, sessionId=SESSION,
                         idempotencyKey=key, expectedVersion=1, replay=False, finishResponseStatus=0)
            checkpoint = out / 'focus-cleanup-after.json'
            checkpoint.write_text(json.dumps({'runId': RUN, 'fixtureFingerprint': fixture_fingerprint([USER]), 'checks': [check]}))
            active = {'id': SESSION, 'subject': f'lt:{RUN}:{JOURNEY}', 'islandId': ISLAND,
                      'version': 1, 'status': 'active', 'startedAt': '2026-10-22T00:00:00Z'}
            posts = []
            def request(user, method, path, body, headers):
                if method == 'GET':
                    return {'status': 200, 'data': active}
                posts.append((headers['Idempotency-Key'], body))
                return {'status': 0, 'data': None}
            result = cleanup_focus('http://localhost', [USER], 1, RUN, read_focus_ledger(out, RUN), request=request)
            checkpoint.write_text(json.dumps(result))
            again = cleanup_focus('http://localhost', [USER], 1, RUN, read_focus_ledger(out, RUN), request=request)
            self.assertEqual(posts, [(key, {'expectedVersion': 1})])
            self.assertFalse(again['complete'])

    def test_reordered_fixture_or_changed_token_cannot_reuse_ledger(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = self.ledger(Path(temporary))
            calls = []
            result = cleanup_focus('http://localhost', [dict(USER, token='different')], 1, RUN, ledger,
                request=lambda *args: calls.append(args))
            self.assertEqual(calls, [])
            self.assertFalse(result['complete'])
            self.assertEqual(result['reason'], 'FIXTURE_LEDGER_MISMATCH')

    def test_duplicate_focus_identity_or_token_is_rejected(self):
        first = dict(USER, userId=SESSION)
        second = dict(USER, userId=JOURNEY, token='different')
        self.assertTrue(validate_focus_fixtures([first, second], 2))
        self.assertFalse(validate_focus_fixtures([first, dict(second, token=first['token'])], 2))
        self.assertFalse(validate_focus_fixtures([first, dict(second, userId=first['userId'])], 2))

    def test_missing_diagnostics_cannot_pass_even_if_raw_counters_are_successful(self):
        with tempfile.TemporaryDirectory() as temporary:
            ledger = read_focus_ledger(Path(temporary), RUN)
            metrics = {'focus_' + name: {'values': {'count': value}} for name, value in {
                'cycles_started': 1, 'cycles_finished': 1, 'http_successful_cycles': 1,
                'acknowledged_finishes': 1, 'unknown_settlements': 0, 'quarantined_cycles': 0}.items()}
            row = assess_focus_stage(dict(verdict='PASS', completedJourneys=1, requests=5,
                journeyP95ms=1200, latencyLimitMs=5000), {'metrics': metrics}, ledger)
            self.assertEqual(row['verdict'], 'INVALID')
            self.assertFalse(row['focusEvidenceComplete'])
            self.assertIn('FOCUS_LEDGER_INCOMPLETE', row['focusOutcomeReasons'])

    def test_five_second_exploration_pass_is_not_baseline_one_second_pass(self):
        fingerprint = fixture_fingerprint([USER])
        counts = {'startedCycles': 1, 'finishedCycles': 1, 'httpSuccessfulCycles': 1,
                  'acknowledgedFinishes': 1, 'unknownSettlements': 0}
        ledger = dict(counts, fixtureFingerprint=fingerprint, successfulCycles=1, httpRequests=5,
                      malformedLines=0, journeys=[], firstFailure=None, serverLedger={'status': 'NOT_COLLECTED'})
        values = {'cycles_started': 1, 'cycles_finished': 1, 'http_successful_cycles': 1,
                  'acknowledged_finishes': 1, 'unknown_settlements': 0, 'quarantined_cycles': 0}
        summary = {'metrics': {'focus_' + key: {'values': {'count': value}} for key, value in values.items()}}
        row = assess_focus_stage(dict(verdict='PASS', completedJourneys=1, requests=5,
            journeyP95ms=1200, latencyLimitMs=5000, fixtureFingerprint=fingerprint), summary, ledger)
        self.assertEqual(row['configuredVerdict'], 'PASS')
        self.assertEqual(row['baselineVerdict'], 'SLO_LIMIT')
        self.assertEqual(row['sloProfile'], 'exploratory')

    def test_supervisor_ack_updates_final_ledger_without_claiming_database_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary)
            self.ledger(out)
            extra = out / 'supervisor.json'
            extra.write_text(json.dumps({'runId': RUN, 'fixtureFingerprint': fixture_fingerprint([USER]), 'checks': [{
                'fixtureAlias': 'fixture-1', 'journeyId': JOURNEY, 'sessionId': SESSION,
                'idempotencyKey': JOURNEY, 'expectedVersion': 1, 'finishAcknowledged': True,
                'finishResponseStatus': 200, 'replay': False}]}))
            before = read_focus_ledger(out, RUN)
            after = read_focus_ledger(out, RUN, extra_cleanup_files=[extra])
            self.assertEqual(before['unknownSettlements'], 1)
            self.assertEqual(after['unknownSettlements'], 0)
            self.assertEqual(after['serverLedger']['status'], 'NOT_COLLECTED')


if __name__ == '__main__':
    unittest.main()
