// k6와 로컬 장애 주입 시험이 같은 복구 결정을 사용한다. 전송·시계·원장은 호출자가 제공한다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERROR_CODES = new Set([
  'INVALID_REQUEST', 'INVALID_PARAMETER', 'INVALID_IDEMPOTENCY_KEY', 'UNAUTHORIZED', 'FORBIDDEN',
  'NOT_FOUND', 'USER_NOT_FOUND', 'GROUP_NOT_FOUND', 'VERSION_CONFLICT', 'STATE_CONFLICT',
  'IDEMPOTENCY_KEY_REUSED', 'REQUEST_IN_PROGRESS', 'RATE_LIMITED', 'INTERNAL_ERROR',
  'UPSTREAM_CONTRACT_ERROR', 'UPSTREAM_AUTH_FAILED', 'SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT',
  'INVALID_SUBJECT', 'INVALID_TARGET_MINUTES', 'ISLAND_NOT_CURRENT', 'ISLAND_MEMBERSHIP_REQUIRED',
  'SESSION_IN_PROGRESS', 'SESSION_NOT_FOUND', 'SESSION_ALREADY_ENDED', 'SESSION_DISCARDED',
  'EXPECTED_VERSION_REQUIRED', 'SESSION_STATE_CONFLICT', 'CONCURRENT_UPDATE',
  'REWARD_POLICY_UNAVAILABLE', 'SESSION_START_UNAVAILABLE',
]);

export const focusMarker = (runId, journeyId) => `lt:${runId}:${journeyId}`;

function validCurrentState(current) {
  return !!current && UUID.test(current.id || '') && UUID.test(current.islandId || '')
    && typeof current.subject === 'string' && Number.isSafeInteger(current.version) && current.version > 0
    && ['active', 'paused'].includes(current.status) && typeof current.startedAt === 'string'
    && Number.isFinite(Date.parse(current.startedAt));
}

export function ownedCurrent(current, { runId, journeyId, islandId, sessionId = null }) {
  return validCurrentState(current) && (!sessionId || current.id === sessionId)
    && current.subject === focusMarker(runId, journeyId) && current.islandId === islandId;
}

function header(headers, name) {
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

export function safeHttpFields(response) {
  const ray = header(response.headers, 'cf-ray');
  const requestId = header(response.headers, 'x-request-id');
  return {
    status: Number.isInteger(response.status) ? response.status : 0,
    apiErrorCode: ERROR_CODES.has(response.apiErrorCode) ? response.apiErrorCode : null,
    k6ErrorCode: Number.isInteger(response.k6ErrorCode) ? response.k6ErrorCode : null,
    cfRay: typeof ray === 'string' && /^[0-9a-f]{8,32}(?:-[a-z]{3})?$/i.test(ray) ? ray : null,
    responseRequestId: typeof requestId === 'string' && (UUID.test(requestId) || /^[0-9a-f]{16,64}$/i.test(requestId))
      ? requestId : null,
  };
}

export function runFocusJourney(options) {
  const { runId, journeyId, fixtureAlias, fixtureFingerprint, islandId, request, uuid, emit, observe = () => {} } = options;
  if (!UUID.test(runId) || !UUID.test(journeyId) || !UUID.test(islandId) || !/^fixture-[1-9][0-9]*$/.test(fixtureAlias)
      || !/^[a-f0-9]{64}$/.test(fixtureFingerprint || '')) {
    throw new Error('집중 실행/여정/섬 UUID와 fixture 별칭이 필요합니다');
  }
  const result = { cycleCompleted: false, journeySucceeded: false, httpSucceeded: true,
    sessionId: null, finishAcknowledged: false, remainingActive: null, ownership: 'UNKNOWN',
    settlementStatus: 'UNKNOWN', needsServerLedger: true, quarantine: false, failures: 0 };
  const write = event => emit({ schemaVersion: 1, runId, journeyId, fixtureAlias, fixtureFingerprint,
    at: new Date().toISOString(), ...event });
  const owns = current => ownedCurrent(current, { runId, journeyId, islandId, sessionId: result.sessionId });

  function call(step, method, path, body = null, idempotencyKey = null, replay = false) {
    const requestId = uuid();
    write({ type: 'focus_request', phase: 'intent', step, requestId, idempotencyKey,
      sessionId: result.sessionId, expectedVersion: body?.expectedVersion ?? null, replay });
    let response;
    try { response = request({ step, method, path, body, requestId, idempotencyKey, replay }); }
    catch (_) { response = { status: 0, data: undefined }; }
    const valid = step === 'current'
      ? response.data === null || validCurrentState(response.data)
      : step === 'finish' ? response.data?.recordId === result.sessionId && UUID.test(result.sessionId || '')
        : owns(response.data);
    const ok = response.status >= 200 && response.status < 300 && valid;
    observe(response, !!valid);
    const fields = { ...safeHttpFields(response), validBody: !!valid, requestId, step };
    write({ type: 'focus_request', phase: 'response', ...fields, ok, replay });
    if (!ok) {
      result.httpSucceeded = false;
      result.failures++;
      write({ type: 'http_failure', ...fields, firstFailure: result.failures === 1,
        failureOrdinal: result.failures });
    }
    return { ok, data: response.data, status: fields.status };
  }

  function current() {
    const response = call('current', 'GET', '/focus-sessions/current');
    if (!response.ok) { result.quarantine = true; return null; }
    if (response.data === null) {
      result.ownership = 'NONE';
      result.remainingActive = false;
      return null;
    }
    if (!owns(response.data)) {
      result.ownership = 'FOREIGN';
      result.quarantine = true;
      return null;
    }
    result.sessionId = response.data.id;
    result.ownership = 'OWNED';
    result.remainingActive = true;
    return response.data;
  }

  function finish(state) {
    const key = uuid(), body = { expectedVersion: state.version }, path = `/focus-sessions/${state.id}/finish`;
    let response = call('finish', 'POST', path, body, key);
    if (!response.ok) {
      const observed = current();
      // 전송 불명/서버 오류 뒤에도 같은 세션·버전이 남은 경우만 원 요청을 정확히 재생한다.
      // PublicCommandService의 동일 키·본문 멱등 계약을 사용하며 새 키로 중복 종료하지 않는다.
      if ((response.status === 0 || response.status >= 500) && observed?.version === state.version) {
        response = call('finish', 'POST', path, body, key, true);
        if (!response.ok) current();
      }
    }
    if (response.ok) {
      result.finishAcknowledged = true;
      result.remainingActive = false;
      result.settlementStatus = 'ACKNOWLEDGED';
      result.needsServerLedger = false;
    } else {
      // current=null은 진행 세션이 없다는 증거일 뿐, 이 종료·보상 저장 성공의 증거가 아니다.
      result.quarantine = true;
    }
  }

  try {
    const started = call('start', 'POST', '/focus-sessions',
      { islandId, subject: focusMarker(runId, journeyId) }, uuid());
    let transitionsSucceeded = false;
    if (started.ok) {
      result.sessionId = started.data.id;
      options.sleep(0.2);
      const paused = call('pause', 'POST', `/focus-sessions/${result.sessionId}/pause`,
        { expectedVersion: started.data.version }, uuid());
      if (paused.ok) {
        const resumed = call('resume', 'POST', `/focus-sessions/${result.sessionId}/resume`,
          { expectedVersion: paused.data.version }, uuid());
        transitionsSucceeded = resumed.ok;
      }
    }
    const state = current();
    if (state) finish(state);
    else result.quarantine = true;
    result.journeySucceeded = transitionsSucceeded && result.httpSucceeded && result.finishAcknowledged;
  } finally {
    result.cycleCompleted = true;
    write({ type: 'focus_result', ...result });
  }
  return result;
}
