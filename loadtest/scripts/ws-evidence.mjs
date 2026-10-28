// 상대가 보낸 선언과 실제 종료 원인을 구분한다. 임의 reason에는 계정 정보가 있을 수 있다.
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function correlationId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('상관관계 ID는 UUID여야 합니다');
  return value.toLowerCase();
}
export function closeEvidence(event, clientInitiated) {
  const code = Number.isInteger(event.code) ? event.code : null;
  const supplied = String(event.reason ?? '');
  const reason = new Set(['', 'LOADTEST_COMPLETE', 'LOADTEST_ABORT', 'HEARTBEAT_TIMEOUT', 'POLICY_VIOLATION']).has(supplied) ? supplied : 'REDACTED';
  const initiator = clientInitiated ? 'CLIENT' : code !== null && code !== 1006 && code !== 1005 ? 'PEER' : 'UNKNOWN';
  const declaredCause = clientInitiated ? 'CLIENT_SHUTDOWN' : reason === 'HEARTBEAT_TIMEOUT' ? 'HEARTBEAT_TIMEOUT' : code === 1008 ? 'POLICY_CLOSE' : 'UNKNOWN';
  return { code, reason, reasonRedacted: reason === 'REDACTED', initiator, declaredCause,
    rootCause: 'UNKNOWN', wasClean: typeof event.wasClean === 'boolean' ? event.wasClean : null };
}
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined; renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}


const errorCodes = new Set(['UNAUTHORIZED', 'INVALID_REQUEST', 'UPSTREAM_UNAVAILABLE', 'NOT_FOUND', 'INTERNAL_ERROR',
  'NOT_A_MEMBER', 'FOCUS_IN_PROGRESS', 'BLANK_CONTENT', 'CONTENT_TOO_LONG', 'INVALID_CONTENT', 'INVALID_CURSOR',
  'IDEMPOTENCY_KEY_REUSED', 'INVALID_EMOTE_TYPE', 'NOT_FOCUSING', 'EMOTE_TOO_FREQUENT', 'NO_ONE_FOCUSING',
  'MOVEMENT_TOO_FREQUENT', 'NOT_IN_SEA_ROOM', 'SEA_ENTER_TOO_FREQUENT']);
const rejectReasons = new Set(['OUT_OF_RANGE', 'NO_REACHABLE_GOAL', 'STALE_COMMAND', 'NAV_REVISION_MISMATCH']);
const messageTypes = new Set(['FullState', 'Snapshot', 'PathAccepted', 'MoveRejected', 'Arrived',
  'focus.member.updated', 'rest.member.updated']);
export const safeErrorCode = value => errorCodes.has(value) ? value : 'UNKNOWN';
export const safeRejectReason = value => rejectReasons.has(value) ? value : 'UNKNOWN';
export const safeMessageType = value => value === undefined ? 'chat-or-error' : messageTypes.has(value) ? value : 'UNKNOWN';
