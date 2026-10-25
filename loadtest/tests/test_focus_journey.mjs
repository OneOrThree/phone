import test from 'node:test';
import assert from 'node:assert/strict';
import { runFocusJourney, focusMarker, safeHttpFields } from '../k6/lib/focus-journey.mjs';

const runId = '00000000-0000-4000-8000-000000000001';
const journeyId = '00000000-0000-4000-8000-000000000002';
const islandId = '00000000-0000-4000-8000-000000000003';
const sessionId = '00000000-0000-4000-8000-000000000004';

function fixture(fault) {
  let current = null, starts = 0, settlements = 0, sequence = 10, finishAttempts = 0;
  const calls = [], events = [], finishes = new Map();
  const ok = data => ({ status: 200, data, headers: {} });
  const request = req => {
    calls.push(req);
    if (req.method === 'GET') return ok(current);
    if (req.step === 'start') {
      starts++;
      current = { id: sessionId, islandId, subject: req.body.subject, version: 1, status: 'active',
        startedAt: '2026-10-22T00:00:00Z' };
      if (fault === 'start_response_lost') return { status: 0, data: null, k6ErrorCode: 1050 };
      return ok({ ...current });
    }
    if (req.step === 'pause' || req.step === 'resume') {
      current = { ...current, version: current.version + 1, status: req.step === 'pause' ? 'paused' : 'active' };
      return ok({ ...current });
    }
    if (req.step === 'finish') {
      finishAttempts++;
      if (fault === 'finish_send_failed' && finishAttempts === 1) return { status: 0, data: null, k6ErrorCode: 1050 };
      if (finishes.has(req.idempotencyKey)) return ok(finishes.get(req.idempotencyKey));
      settlements++;
      const result = { recordId: sessionId };
      finishes.set(req.idempotencyKey, result);
      current = null;
      if (fault === 'finish_response_lost') return { status: 0, data: null, k6ErrorCode: 1050 };
      return ok(result);
    }
    throw new Error('unexpected request');
  };
  return { calls, events, request, options: { runId, journeyId, fixtureAlias: 'fixture-1', fixtureFingerprint: 'a'.repeat(64), islandId,
    uuid: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    sleep: () => {}, emit: event => events.push(event), request },
    state: () => ({ current, starts, settlements }) };
}

test('시작 저장 후 응답 유실은 현재 상태의 이번 실행 소유를 확인하고 한 번만 종료한다', () => {
  const f = fixture('start_response_lost');
  const result = runFocusJourney(f.options);
  assert.equal(f.state().starts, 1);
  assert.equal(f.state().settlements, 1);
  assert.equal(f.state().current, null);
  assert.deepEqual(f.calls.map(c => c.step), ['start', 'current', 'finish']);
  assert.equal(f.calls[0].body.subject, focusMarker(runId, journeyId));
  assert.equal(result.journeySucceeded, false);
  assert.equal(result.finishAcknowledged, true);
  assert.equal(result.remainingActive, false);
  assert.equal(f.events.find(e => e.type === 'http_failure').firstFailure, true);
});

test('정상 사이클은 원래 5 HTTP 요청과 별개로 여정 완료를 기록한다', () => {
  const f = fixture();
  const result = runFocusJourney(f.options);
  assert.deepEqual(f.calls.map(c => c.step), ['start', 'pause', 'resume', 'current', 'finish']);
  assert.equal(result.journeySucceeded, true);
  assert.equal(result.httpSucceeded, true);
  assert.equal(result.cycleCompleted, true);
  assert.equal(f.state().settlements, 1);
});

test('필수 상태 필드가 없는 current는 HTTP 성공이나 다른 실행 상태로 인정하지 않는다', () => {
  const f = fixture();
  const result = runFocusJourney({ ...f.options, request: command => command.step === 'current'
    ? { status: 200, data: { id: sessionId } } : f.request(command) });
  assert.equal(result.httpSucceeded, false);
  assert.equal(result.quarantine, true);
  assert.equal(result.needsServerLedger, true);
  assert.equal(f.calls.filter(command => command.step === 'finish').length, 0);
  assert.equal(f.events.find(event => event.type === 'http_failure').step, 'current');
});

test('종료 전송 실패는 같은 현재 세션/버전 확인 뒤 같은 멱등키·본문으로 한 번만 재전송한다', () => {
  const f = fixture('finish_send_failed');
  const result = runFocusJourney(f.options);
  const finishes = f.calls.filter(c => c.step === 'finish');
  assert.equal(finishes.length, 2);
  assert.equal(finishes[1].idempotencyKey, finishes[0].idempotencyKey);
  assert.deepEqual(finishes[1].body, finishes[0].body);
  assert.equal(finishes[1].replay, true);
  assert.deepEqual(f.calls.slice(-3).map(c => c.step), ['finish', 'current', 'finish']);
  assert.equal(f.state().settlements, 1);
  assert.equal(result.finishAcknowledged, true);
  assert.equal(result.journeySucceeded, false);
});

test('종료 저장 후 응답 유실/current null은 UNKNOWN이며 보상 성공으로 승격하거나 재전송하지 않는다', () => {
  const f = fixture('finish_response_lost');
  const result = runFocusJourney(f.options);
  assert.equal(f.calls.filter(c => c.step === 'finish').length, 1);
  assert.equal(f.state().settlements, 1);
  assert.equal(result.remainingActive, false);
  assert.equal(result.finishAcknowledged, false);
  assert.equal(result.settlementStatus, 'UNKNOWN');
  assert.equal(result.needsServerLedger, true);
  assert.equal(result.journeySucceeded, false);
});

test('다른 실행 marker 또는 이미 확인한 id와 다른 current는 종료하지 않는다', () => {
  for (const change of [{ subject: '다른 실행의 주제' }, { id: '00000000-0000-4000-8000-000000000099' }]) {
    const f = fixture();
    f.options.request = req => {
      const response = f.request(req);
      if (req.step === 'current') response.data = { ...response.data, ...change };
      return response;
    };
    const result = runFocusJourney(f.options);
    assert.equal(f.calls.filter(c => c.step === 'finish').length, 0);
    assert.equal(f.state().settlements, 0);
    assert.equal(result.ownership, 'FOREIGN');
    assert.equal(result.quarantine, true);
  }
});

test('종료 불명 뒤 version이 달라지면 새 키/본문으로 쓰기 재시도하지 않는다', () => {
  const f = fixture('finish_send_failed');
  let finishSeen = false;
  f.options.request = req => {
    if (req.step === 'finish') finishSeen = true;
    const response = f.request(req);
    if (finishSeen && req.step === 'current') response.data = { ...response.data, version: 99 };
    return response;
  };
  const result = runFocusJourney(f.options);
  assert.equal(f.calls.filter(c => c.step === 'finish').length, 1);
  assert.equal(result.finishAcknowledged, false);
  assert.equal(result.remainingActive, true);
  assert.equal(result.quarantine, true);
});

test('최초 전송 오류와 뒤의 409는 별도로 기록하며 409를 재시도하지 않는다', () => {
  const f = fixture('start_response_lost');
  f.options.request = req => req.step === 'finish'
    ? { status: 409, data: null, apiErrorCode: 'VERSION_CONFLICT' } : f.request(req);
  runFocusJourney(f.options);
  const errors = f.events.filter(e => e.type === 'http_failure');
  assert.deepEqual(errors.map(e => [e.step, e.status, e.firstFailure]), [['start', 0, true], ['finish', 409, false]]);
  assert.equal(f.events.filter(e => e.type === 'focus_request' && e.phase === 'intent' && e.step === 'finish').length, 1);
});

test('실패 진단은 승인한 코드·상관 ID만 남기며 원문/토큰/사용자 정보를 복사하지 않는다', () => {
  const unsafe = safeHttpFields({ status: 500, apiErrorCode: 'private@example.com',
    body: 'Bearer private-token', headers: { 'Cf-Ray': 'user@example.com', 'X-Request-Id': 'private-token' } });
  assert.equal(unsafe.apiErrorCode, null);
  assert.equal(unsafe.cfRay, null);
  assert.equal(unsafe.responseRequestId, null);
  assert.doesNotMatch(JSON.stringify(unsafe), /private|Bearer|example/);
  const safe = safeHttpFields({ status: 409, apiErrorCode: 'SESSION_IN_PROGRESS',
    headers: { 'CF-Ray': '0123456789abcdef-ICN', 'X-Request-Id': runId } });
  assert.equal(safe.cfRay, '0123456789abcdef-ICN');
  assert.equal(safe.responseRequestId, runId);
});
