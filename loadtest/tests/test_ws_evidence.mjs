import test from 'node:test';
import assert from 'node:assert/strict';
import { closeEvidence, correlationId } from '../scripts/ws-evidence.mjs';

test('종료 관측은 클라이언트 의도·상대 선언·실제 원인을 분리한다', () => {
  const cases = [
    [{ code: 1000, reason: 'LOADTEST_COMPLETE', wasClean: true }, true, 'CLIENT', 'CLIENT_SHUTDOWN'],
    [{ code: 1001, reason: '' }, false, 'PEER', 'UNKNOWN'],
    [{ code: 1001, reason: 'HEARTBEAT_TIMEOUT' }, false, 'PEER', 'HEARTBEAT_TIMEOUT'],
    [{ code: 1008, reason: 'POLICY_VIOLATION' }, false, 'PEER', 'POLICY_CLOSE'],
    [{ code: 1006, reason: '' }, false, 'UNKNOWN', 'UNKNOWN'],
  ];
  for (const [event, own, initiator, cause] of cases) {
    const result = closeEvidence(event, own);
    assert.equal(result.initiator, initiator);
    assert.equal(result.declaredCause, cause);
    assert.equal(result.rootCause, 'UNKNOWN');
  }
  assert.equal(closeEvidence({ code: 1008, reason: 'user@example.com Bearer secret' }, false).reason, 'REDACTED');
  assert.throws(() => correlationId('Bearer secret'));
});
