"""집중 실행 원장과 소유 검증 후 정리. 자격·사용자 UUID·응답 원문은 결과에 넣지 않는다."""
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import urllib.error
import urllib.request
import uuid

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
ALIAS = re.compile(r'^fixture-[1-9][0-9]*$')
STEPS = {'start', 'pause', 'resume', 'finish', 'current'}
ERROR_CODES = set('INVALID_REQUEST INVALID_PARAMETER INVALID_IDEMPOTENCY_KEY UNAUTHORIZED FORBIDDEN NOT_FOUND USER_NOT_FOUND GROUP_NOT_FOUND VERSION_CONFLICT STATE_CONFLICT IDEMPOTENCY_KEY_REUSED REQUEST_IN_PROGRESS RATE_LIMITED INTERNAL_ERROR UPSTREAM_CONTRACT_ERROR UPSTREAM_AUTH_FAILED SERVICE_UNAVAILABLE UPSTREAM_TIMEOUT INVALID_SUBJECT INVALID_TARGET_MINUTES ISLAND_NOT_CURRENT ISLAND_MEMBERSHIP_REQUIRED SESSION_IN_PROGRESS SESSION_NOT_FOUND SESSION_ALREADY_ENDED SESSION_DISCARDED EXPECTED_VERSION_REQUIRED SESSION_STATE_CONFLICT CONCURRENT_UPDATE REWARD_POLICY_UNAVAILABLE SESSION_START_UNAVAILABLE'.split())


def valid_uuid(value):
    return isinstance(value, str) and bool(UUID.fullmatch(value))


def valid_current_state(value):
    if not (isinstance(value, dict) and valid_uuid(value.get('id')) and valid_uuid(value.get('islandId'))
            and isinstance(value.get('subject'), str) and type(value.get('version')) is int and value['version'] > 0
            and value.get('status') in ('active', 'paused') and isinstance(value.get('startedAt'), str)):
        return False
    try:
        return dt.datetime.fromisoformat(value['startedAt'].replace('Z', '+00:00')).tzinfo is not None
    except ValueError:
        return False


def fixture_fingerprint(users):
    canonical = [[user.get(key) or None for key in ('userId', 'token', 'islandId', 'role')] for user in users]
    return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def validate_focus_fixtures(users, limit):
    selected = users[:limit]
    return (len(selected) == limit and all(valid_uuid(user.get('userId')) and valid_uuid(user.get('islandId'))
            and isinstance(user.get('token'), str) and user['token'] for user in selected)
        and len({user['userId'] for user in selected}) == limit
        and len({user['token'] for user in selected}) == limit)


def read_focus_ledger(directory, run_id, *, diagnostics_file=None, include_cleanup=True, extra_cleanup_files=()):
    """k6가 전송 전에 기록한 intent만 소유 근거로 사용한다. 불완전한 마지막 줄은 따로 센다."""
    journeys, failures, malformed, fingerprints = {}, [], 0, set()
    paths = [Path(directory) / diagnostics_file] if diagnostics_file else sorted(Path(directory).glob('*-http-diagnostics.jsonl'))
    for path in paths:
        if not path.is_file():
            continue
        with path.open(errors='replace') as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except (ValueError, TypeError):
                    malformed += 1
                    continue
                if not isinstance(event, dict) or event.get('runId') != run_id:
                    continue
                jid, alias = event.get('journeyId'), event.get('fixtureAlias')
                if not valid_uuid(jid) or not isinstance(alias, str) or not ALIAS.fullmatch(alias):
                    continue
                fingerprint = event.get('fixtureFingerprint')
                fingerprints.add(fingerprint if isinstance(fingerprint, str) and re.fullmatch('[a-f0-9]{64}', fingerprint) else None)
                row = journeys.setdefault(jid, {'journeyId': jid, 'fixtureAlias': alias,
                    'startIntent': False, 'sessionId': None, 'finishIntent': None, 'result': None,
                    'finishResponseStatus': None, 'httpRequests': 0, 'httpSuccessfulRequests': 0, 'invalid': False})
                if row['fixtureAlias'] != alias:
                    row['invalid'] = True
                    continue
                if event.get('type') == 'focus_request':
                    step = event.get('step')
                    if step not in STEPS:
                        continue
                    if event.get('phase') == 'intent':
                        sid = event.get('sessionId')
                        if valid_uuid(sid):
                            if row['sessionId'] not in (None, sid):
                                row['invalid'] = True
                            row['sessionId'] = sid
                        if step == 'start':
                            row['startIntent'] = True
                        version = event.get('expectedVersion')
                        if step == 'finish' and valid_uuid(event.get('idempotencyKey')) and type(version) is int and version > 0:
                            row['finishIntent'] = {'idempotencyKey': event['idempotencyKey'],
                                'expectedVersion': version, 'sessionId': sid, 'replay': event.get('replay') is True}
                    elif event.get('phase') == 'response':
                        row['httpRequests'] += 1
                        row['httpSuccessfulRequests'] += event.get('ok') is True
                        if step == 'finish':
                            row['finishResponseStatus'] = event.get('status') if type(event.get('status')) is int else 0
                elif event.get('type') == 'focus_result':
                    row['result'] = {key: event.get(key) if type(event.get(key)) is bool else None for key in [
                        'cycleCompleted', 'journeySucceeded', 'httpSucceeded', 'finishAcknowledged',
                        'remainingActive', 'needsServerLedger', 'quarantine']}
                    if valid_uuid(event.get('sessionId')):
                        if row['sessionId'] not in (None, event['sessionId']):
                            row['invalid'] = True
                        row['sessionId'] = event['sessionId']
                elif event.get('type') == 'http_failure':
                    # 원장은 우리 하네스가 만들지만 공개 결과로 임의 문자열을 복사하지 않는다.
                    record = {'journeyId': jid, 'fixtureAlias': alias,
                        'step': event.get('step') if event.get('step') in STEPS else 'unknown',
                        'status': event.get('status') if type(event.get('status')) is int else 0,
                        'firstFailure': event.get('firstFailure') is True}
                    for key in ['requestId', 'responseRequestId']:
                        value = event.get(key)
                        record[key] = value if valid_uuid(value) or isinstance(value, str) and re.fullmatch(r'[0-9a-f]{16,64}', value, re.I) else None
                    code = event.get('apiErrorCode')
                    record['apiErrorCode'] = code if isinstance(code, str) and code in ERROR_CODES else None
                    ray = event.get('cfRay')
                    record['cfRay'] = ray if isinstance(ray, str) and re.fullmatch(r'[0-9a-f]{8,32}(?:-[a-z]{3})?', ray, re.I) else None
                    record['k6ErrorCode'] = event.get('k6ErrorCode') if type(event.get('k6ErrorCode')) is int else None
                    try:
                        record['at'] = dt.datetime.fromisoformat(event['at'].replace('Z', '+00:00')).isoformat()
                    except (KeyError, TypeError, ValueError, AttributeError):
                        record['at'] = None
                    failures.append(record)
    # 감독자가 자식의 정리를 이어받을 때도 이미 보낸 종료의 키/본문을 재사용한다.
    cleanup_paths = [*sorted(Path(directory).glob('focus-cleanup-*.json')), *map(Path, extra_cleanup_files)] if include_cleanup else []
    for path in cleanup_paths:
        try:
            cleanup = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(cleanup, dict) or cleanup.get('runId') != run_id:
            continue
        for check in cleanup.get('checks', []):
            row = journeys.get(check.get('journeyId')) if isinstance(check, dict) else None
            if not row or row['fixtureAlias'] != check.get('fixtureAlias') or not valid_uuid(check.get('idempotencyKey')):
                continue
            if len(fingerprints) != 1 or None in fingerprints or cleanup.get('fixtureFingerprint') not in fingerprints:
                row['invalid'] = True
                continue
            if row['sessionId'] not in (None, check.get('sessionId')) or not valid_uuid(check.get('sessionId')):
                row['invalid'] = True
                continue
            if type(check.get('expectedVersion')) is not int or check['expectedVersion'] <= 0:
                continue
            prior = row.get('finishIntent')
            if prior and any(prior.get(key) != check.get(key) for key in ('idempotencyKey', 'expectedVersion', 'sessionId')):
                row['invalid'] = True
                continue
            row['sessionId'] = check['sessionId']
            row['finishIntent'] = {key: check.get(key) for key in ['idempotencyKey', 'expectedVersion', 'sessionId']}
            row['finishIntent']['replay'] = check.get('replay') is True
            row['finishResponseStatus'] = check.get('finishResponseStatus') if type(check.get('finishResponseStatus')) is int else None
            row['cleanupFinishAcknowledged'] = check.get('finishAcknowledged') is True
    failures.sort(key=lambda row: row['at'] or '9999')
    first_by_fixture = {}
    for failure in failures:
        first_by_fixture.setdefault(failure['fixtureAlias'], failure)
        failure['firstForFixture'] = first_by_fixture[failure['fixtureAlias']] is failure
    values = list(journeys.values())
    return {'runId': run_id, 'journeys': values, 'failures': failures, 'malformedLines': malformed,
        'fixtureFingerprint': next(iter(fingerprints)) if len(fingerprints) == 1 and None not in fingerprints else None,
        'startedCycles': sum(row['startIntent'] for row in values),
        'finishedCycles': sum(bool(row['result'] and row['result']['cycleCompleted']) for row in values),
        'successfulCycles': sum(bool(row['result'] and row['result']['journeySucceeded']) for row in values),
        'httpSuccessfulCycles': sum(bool(row['result'] and row['result']['httpSucceeded']) for row in values),
        'acknowledgedFinishes': sum(bool(row['result'] and row['result']['finishAcknowledged']) for row in values),
        'httpRequests': sum(row['httpRequests'] for row in values),
        'httpSuccessfulRequests': sum(row['httpSuccessfulRequests'] for row in values),
        'firstFailures': sum(row['firstFailure'] for row in failures),
        'subsequent409': sum(not row['firstFailure'] and row['status'] == 409 for row in failures),
        'firstFailure': failures[0] if failures else None,
        'following409SameFixture': sum(not row['firstForFixture'] and row['status'] == 409 for row in failures),
        'unknownSettlements': sum(not row.get('cleanupFinishAcknowledged') and
            (not row['result'] or row['result']['needsServerLedger'] is not False) for row in values),
        'serverLedger': {'status': 'NOT_COLLECTED', 'starts': None, 'settlements': None,
                         'outboxDelivery': None, 'note': 'HTTP/current만으로 DB 정산·Outbox 전달 성공을 추정하지 않는다.'}}


def assess_focus_stage(row, summary, ledger):
    """HTTP 성공만으로 집중 성공을 만들지 않고, 원시 counter와 안전 원장을 교차 확인한다."""
    mapping = {'startedCycles': 'cycles_started', 'finishedCycles': 'cycles_finished',
        'httpSuccessfulCycles': 'http_successful_cycles', 'acknowledgedFinishes': 'acknowledged_finishes',
        'unknownSettlements': 'unknown_settlements', 'quarantinedCycles': 'quarantined_cycles'}
    counters = {key: summary.get('metrics', {}).get('focus_' + metric, {}).get('values', {}).get('count')
                for key, metric in mapping.items()}
    valid = all(type(value) in (int, float) and value >= 0 and value == int(value) for value in counters.values())
    matches = valid and all(counters[key] == ledger[key] for key in mapping if key != 'quarantinedCycles')
    matches = matches and ledger['successfulCycles'] == row.get('completedJourneys')
    matches = matches and ledger['httpRequests'] == row.get('requests') and ledger['malformedLines'] == 0
    matches = matches and bool(ledger.get('fixtureFingerprint')) and ledger['fixtureFingerprint'] == row.get('fixtureFingerprint')
    matches = matches and not any(item.get('invalid') for item in ledger['journeys'])
    reasons = []
    if not matches:
        reasons.append('FOCUS_LEDGER_INCOMPLETE')
    if counters['unknownSettlements'] or counters['quarantinedCycles']:
        reasons.append('FOCUS_OUTCOME_UNKNOWN')
    if valid and counters['startedCycles'] != counters['finishedCycles']:
        reasons.append('FOCUS_CYCLE_INCOMPLETE')
    if valid and counters['acknowledgedFinishes'] != counters['finishedCycles']:
        reasons.append('FOCUS_FINISH_UNCONFIRMED')
    row.update(focusCounters=counters, focusEvidenceComplete=bool(matches), focusOutcomeReasons=reasons,
               focusFirstFailure=ledger['firstFailure'], serverLedger=ledger['serverLedger'])
    if reasons and row['verdict'] not in ('PARTIAL', 'ABORT', 'INVALID'):
        row['verdict'] = 'INVALID'
    # 완화된 5초 탐색의 PASS를 기본 1초 SLO의 PASS로 읽지 않도록 둘 다 남긴다.
    baseline_latency_ok = row.get('journeyP95ms') is not None and row['journeyP95ms'] <= 1000
    row.update(baselineJourneyP95LimitMs=1000, baselineJourneySloPassed=baseline_latency_ok,
               configuredVerdict=row['verdict'], sloProfile='exploratory' if row['latencyLimitMs'] > 1000 else 'baseline_or_stricter')
    row['baselineVerdict'] = 'SLO_LIMIT' if row['verdict'] == 'PASS' and not baseline_latency_ok else row['verdict']
    return row


def http_request(base):
    cafile = os.environ.get('SSL_CERT_FILE')
    if not cafile and Path('/etc/ssl/cert.pem').is_file():
        cafile = '/etc/ssl/cert.pem'

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=cafile)))

    def send(user, method, path, body, extra):
        headers = {'Authorization': 'Bearer ' + user['token'], 'Content-Type': 'application/json',
                   'User-Agent': 'catus-loadtest/aws-capacity', **extra}
        req = urllib.request.Request(base + path, headers=headers, method=method,
            data=json.dumps(body).encode() if body is not None else None)
        try:
            try:
                response = opener.open(req, timeout=5)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read(1024 * 1024 + 1)  # 본문 수신 중 끊김(IncompleteRead)도 같은 범위에서 잡는다.
                status = response.status
        except (OSError, http.client.HTTPException):  # URLError·socket.timeout 은 OSError 하위
            return {'status': 0, 'data': None, 'validBody': False}
        try:
            parsed = json.loads(raw) if len(raw) <= 1024 * 1024 else {}
        except (ValueError, UnicodeError):
            parsed = {}
        return {'status': status, 'data': parsed.get('data') if isinstance(parsed, dict) else None,
                'validBody': isinstance(parsed, dict) and 'data' in parsed}
    return send


def cleanup_focus(base, users, limit, run_id, ledger, *, request=None, preflight=False, checkpoint=None):
    if not valid_uuid(run_id) or ledger.get('runId') != run_id:
        raise ValueError('정리 run ID와 원장이 일치해야 합니다')
    send = request or http_request(base)
    summary = {'runId': run_id, 'mode': 'preflight' if preflight else 'cleanup', 'checked': 0,
        'finished': 0, 'failed': 0, 'preservedForeign': 0, 'remainingOwnedActive': 0,
        'unknown': 0, 'uncheckedAccounts': 0, 'complete': True, 'checks': []}
    summary['fixtureFingerprint'] = fixture_fingerprint(users)
    if not preflight and ledger.get('fixtureFingerprint') != summary['fixtureFingerprint']:
        summary.update(complete=False, unknown=1, uncheckedAccounts=limit, reason='FIXTURE_LEDGER_MISMATCH')
        return summary
    by_marker = {(row['fixtureAlias'], f"lt:{run_id}:{row['journeyId']}"): row
                 for row in ledger.get('journeys', []) if row.get('startIntent') and not row.get('invalid')}
    consecutive_errors = 0
    for index, user in enumerate(users[:limit], 1):
        alias = f'fixture-{index}'
        row = {'fixtureAlias': alias, 'ownership': 'UNKNOWN', 'remainingOwnedActive': None,
               'finishAcknowledged': False, 'needsServerLedger': True}
        summary['checks'].append(row)

        def call(method, path, body=None, key=None):
            headers = {'X-Loadtest-Run-Id': run_id, 'X-Request-Id': str(uuid.uuid4())}
            if key:
                headers['Idempotency-Key'] = key
            if checkpoint:
                checkpoint(summary)  # 정리 쓰기 전에도 key/version을 남겨 응답 유실과 구분한다.
            response = send(user, method, path, body, headers)
            if method == 'POST':
                row['finishResponseStatus'] = response.get('status', 0)
            if not (200 <= response.get('status', 0) < 300) or response.get('validBody') is False:
                raise ValueError('HTTP_RESPONSE_UNCONFIRMED')
            return response.get('data')

        def unresolved(alias=alias):
            return [item for item in ledger.get('journeys', []) if item['fixtureAlias'] == alias
                and item.get('startIntent') and not item.get('cleanupFinishAcknowledged')
                and (not item.get('result') or item['result'].get('needsServerLedger') is not False)]

        try:
            current = call('GET', '/focus-sessions/current')
            summary['checked'] += 1
            if current is None:
                consecutive_errors = 0
                row.update(ownership='NONE', remainingOwnedActive=False)
                # 종료 응답 미확인 원장은 그대로 UNKNOWN이다. current=null로 정산 완료를 만들지 않는다.
                if unresolved():
                    row['reason'] = 'SETTLEMENT_UNCONFIRMED'
                continue
            if not valid_current_state(current):
                raise ValueError('CURRENT_BODY_UNCONFIRMED')
            owned = by_marker.get((alias, current.get('subject'))) if isinstance(current, dict) else None
            valid = (owned and valid_uuid(current.get('id')) and str(current.get('islandId')).lower() == str(user.get('islandId')).lower()
                and owned.get('sessionId') in (None, current['id'])
                and type(current.get('version')) is int and current['version'] > 0
                and current.get('status') in ('active', 'paused'))
            if preflight or not valid:
                consecutive_errors = 0
                if not preflight and isinstance(current.get('subject'), str) and current['subject'].startswith(f'lt:{run_id}:'):
                    row['reason'] = 'OWNERSHIP_LEDGER_UNCONFIRMED'
                    continue
                summary['preservedForeign'] += 1
                row.update(ownership='PREEXISTING' if preflight else 'FOREIGN', remainingOwnedActive=False)
                if not preflight and unresolved():  # 다른 실행 세션은 보존하되 기존 여정의 미확인 정산은 해소되지 않는다.
                    row['reason'] = 'SETTLEMENT_UNCONFIRMED'
                if preflight:
                    summary['complete'] = False
                continue
            row.update(ownership='OWNED', sessionId=current['id'], journeyId=owned['journeyId'], remainingOwnedActive=True)
            intent = owned.get('finishIntent')
            finish_status = owned.get('finishResponseStatus')
            if intent and (intent['sessionId'] != current['id'] or intent['expectedVersion'] != current['version']
                    or intent['replay'] or finish_status is not None and 0 < finish_status < 500):
                row['reason'] = 'FINISH_REPLAY_UNSAFE'
                continue
            key = intent['idempotencyKey'] if intent else str(uuid.uuid4())
            row.update(idempotencyKey=key, expectedVersion=current['version'], replay=bool(intent))
            try:
                finished = call('POST', f"/focus-sessions/{current['id']}/finish", {'expectedVersion': current['version']}, key)
                if not isinstance(finished, dict) or finished.get('recordId') != current['id']:
                    raise ValueError('FINISH_BODY_UNCONFIRMED')
                row.update(finishAcknowledged=True, needsServerLedger=False)
                summary['finished'] += 1
            except (ValueError, OSError):
                row['reason'] = 'FINISH_RESPONSE_UNCONFIRMED'
            row['remainingOwnedActive'] = None  # 종료 뒤 확인 GET 이 실패하면 «미확인» 이다. True/False 로 단정하지 않는다.
            after = call('GET', '/focus-sessions/current')
            if after is not None and not valid_current_state(after):
                raise ValueError('CURRENT_BODY_UNCONFIRMED')
            row['remainingOwnedActive'] = isinstance(after, dict) and after.get('id') == current['id']
            if row.get('reason'):  # 종료 실패도 오류 횟수에 넣고, 계정 정리가 성공했을 때만 초기화한다.
                summary['failed'] += 1
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    summary['complete'] = False
                    break
            else:
                consecutive_errors = 0
        except (ValueError, OSError, TypeError, KeyError):
            row['reason'] = 'CURRENT_RESPONSE_UNCONFIRMED'
            summary['failed'] += 1
            consecutive_errors += 1
            if consecutive_errors >= 3:
                summary['complete'] = False
                break
        finally:
            summary['remainingOwnedActive'] += row['remainingOwnedActive'] is True
            summary['unknown'] += row['remainingOwnedActive'] is None or row.get('reason') is not None
            if checkpoint:
                checkpoint(summary)
    summary['uncheckedAccounts'] = len(users[:limit]) - len(summary['checks'])  # 연속 오류로 끊겨 점검하지 못한 계정
    summary['complete'] = summary['complete'] and not (summary['failed'] or summary['unknown'] or summary['remainingOwnedActive'])
    return summary
