// 운영 탐색용: 기존 public.json 및 집중 수명주기를 사용하고 요청/실행 시간을 제한한다.
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { vu, scenario } from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Rate, Counter, Trend } from 'k6/metrics';
import { authParams } from '../lib/auth.js';
import { summarize } from '../lib/summary.js';

const selected = JSON.parse(open('../cases/public.json')).find(c => c.id === __ENV.CASE);
if (!selected) throw new Error('알 수 없는 CASE');
const users = new SharedArray('aws-capacity-users', () =>
  JSON.parse(open(__ENV.USERS_FILE)).filter(u => !selected.role || u.role === selected.role));
if (!users.length) throw new Error('해당 CASE 전용 fixture 없음');
const base = __ENV.BASE_URL;
const rate = Number(__ENV.RATE);
const seconds = Number(__ENV.SECONDS);
const errors = new Rate('api_errors');
const completed = new Counter('completed_journeys');
const started = new Counter('started_journeys');
const finished = new Counter('finished_journeys');
const measurementStart = new Trend('measurement_start_epoch_ms');
const abort = threshold => ({ threshold, abortOnFail: true, delayAbortEval: '10s' });
const endpointThresholds = {};
const endpoints = selected.id === 'focus_lifecycle'
  ? ['focus_start', 'focus_pause', 'focus_resume', 'focus_finish', 'focus_cleanup_read']
  : selected.paths.map((_, i) => `${selected.id}_${i}`);
for (const endpoint of endpoints) endpointThresholds[`http_req_duration{endpoint:${endpoint}}`] = ['p(95)>=0'];
export const options = {
  scenarios: { main: {
    executor: 'constant-arrival-rate', exec: 'run', rate, timeUnit: '1s',
    duration: `${seconds}s`, gracefulStop: '5s',
    preAllocatedVUs: Number(__ENV.PRE_VUS), maxVUs: Number(__ENV.MAX_VUS),
  } },
  maxRedirects: 0,
  userAgent: 'catus-loadtest/aws-capacity',
  thresholds: {
    api_errors: [abort('rate<0.05')],
    http_req_failed: [abort('rate<0.05')],
    http_req_duration: [abort('p(95)<2000')],
    dropped_iterations: [abort(`count<${Math.max(2, Math.ceil(rate * seconds * 0.05))}`)],
    ...endpointThresholds,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

function params(user, endpoint) {
  const result = authParams(user, endpoint, { timeout: '5s', redirects: 0 });
  result.headers['X-Loadtest-Run-Id'] = __ENV.RUN_ID;
  return result;
}
// VU별 런타임에 저장되는 제한이다. 응답 본문/URL/전체 헤더는 진단에 출력하지 않는다.
let failureDiagnostics = 0;
const knownErrorCodes = new Set([
  'INVALID_REQUEST', 'INVALID_PARAMETER', 'INVALID_IDEMPOTENCY_KEY', 'UNAUTHORIZED', 'FORBIDDEN',
  'FACILITY_LOCKED', 'NOT_FOUND', 'RESOURCE_NOT_FOUND', 'USER_NOT_FOUND', 'GROUP_NOT_FOUND',
  'VERSION_CONFLICT', 'STATE_CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 'REQUEST_IN_PROGRESS',
  'RATE_LIMITED', 'INTERNAL_ERROR', 'UPSTREAM_CONTRACT_ERROR', 'UPSTREAM_AUTH_FAILED',
  'SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'INVALID_SUBJECT', 'INVALID_TARGET_MINUTES',
  'ISLAND_NOT_CURRENT', 'ISLAND_MEMBERSHIP_REQUIRED', 'SESSION_IN_PROGRESS', 'SESSION_NOT_FOUND',
  'SESSION_ALREADY_ENDED', 'SESSION_DISCARDED', 'EXPECTED_VERSION_REQUIRED', 'SESSION_STATE_CONFLICT',
  'REWARD_POLICY_UNAVAILABLE', 'SESSION_START_UNAVAILABLE',
]);
function succeeded(response, validBody = true, endpoint = 'unknown') {
  const ok = check(response, { '정상 2xx 응답': r => r.status >= 200 && r.status < 300 && validBody });
  errors.add(!ok);
  if (!ok && failureDiagnostics < 5) {
    failureDiagnostics++;
    let apiErrorCode = null;
    try {
      const code = response.json('error.code') ?? response.json('code');
      if (knownErrorCodes.has(code)) apiErrorCode = code;
    } catch (_) {}
    const ray = Object.entries(response.headers || {}).find(([name]) => name.toLowerCase() === 'cf-ray')?.[1];
    console.log(JSON.stringify({ type: 'http_failure', at: new Date().toISOString(), vu: vu.idInTest,
      step: endpoints.includes(endpoint) ? endpoint : 'unknown', status: response.status, validBody: !!validBody,
      k6ErrorCode: Number.isInteger(response.error_code) ? response.error_code : null, apiErrorCode,
      cfRay: typeof ray === 'string' && ray.length <= 64 && /^[0-9a-f]{8,32}(?:-[a-z]{3})?$/i.test(ray) ? ray : null }));
  }
  return ok;
}
const seededId = key => {
  const h = crypto.md5(key, 'hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
function readJourney() {
  const user = users[Math.floor(Math.random() * users.length)];
  const today = new Date();
  const week = new Date(); week.setUTCDate(week.getUTCDate() - week.getUTCDay());
  const replacements = {
    islandId: user.islandId || '', date: today.toISOString().slice(0, 10),
    month: today.toISOString().slice(0, 7), week: week.toISOString().slice(0, 10),
    yesterday: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    noticeId: seededId(`survey-notice-${user.islandId}-1`),
    letterId: seededId(`survey-letter-${user.userId}-1`),
  };
  const requests = selected.paths.map((template, i) => ({
    method: 'GET', url: base + template.replace(/\{(\w+)\}/g, (_, key) => replacements[key]),
    params: params(user, `${selected.id}_${i}`),
  }));
  const first = requests[0];
  const responses = [http.get(first.url, first.params)];
  if (selected.parallelAfterFirst) responses.push(...http.batch(requests.slice(1)));
  else for (const request of requests.slice(1)) responses.push(http.get(request.url, request.params));
  const success = responses.map((response, index) => succeeded(response, true, `${selected.id}_${index}`)).every(Boolean);
  if (success) completed.add(1);
}
function uuid() {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function command(user, path, body, step) {
  const requestParams = params(user, `focus_${step}`);
  requestParams.headers['Idempotency-Key'] = uuid();
  const response = http.post(base + path, JSON.stringify(body), requestParams);
  let data;
  try { data = response.json('data'); } catch (_) {}
  const validBody = step === 'finish' ? !!data?.recordId : !!data?.id && Number.isFinite(data.version);
  return succeeded(response, validBody, `focus_${step}`) ? data : null;
}
function focusJourney() {
  const user = users[vu.idInTest - 1];
  if (!user?.islandId) throw new Error('maxVUs 이상 전용 유저/islandId fixture 필요');
  const started = command(user, '/focus-sessions', { islandId: user.islandId, subject: 'AWS 부하 조사' }, 'start');
  if (!started?.id) return;
  let version = started.version;
  let allStepsSucceeded = false;
  try {
    sleep(0.2);
    const paused = command(user, `/focus-sessions/${started.id}/pause`, { expectedVersion: version }, 'pause');
    if (!paused) return;
    version = paused.version;
    const resumed = command(user, `/focus-sessions/${started.id}/resume`, { expectedVersion: version }, 'resume');
    if (!resumed) return;
    version = resumed.version;
    allStepsSucceeded = true;
  } finally {
    const response = http.get(`${base}/focus-sessions/current`, params(user, 'focus_cleanup_read'));
    if (succeeded(response, true, 'focus_cleanup_read')) {
      let current;
      try { current = response.json('data'); } catch (_) { errors.add(true); }
      if (current?.id === started.id) version = current.version;
    }
    const finished = command(user, `/focus-sessions/${started.id}/finish`, { expectedVersion: version }, 'finish');
    if (allStepsSucceeded && finished) completed.add(1);
  }
}
export function run() {
  completed.add(0); finished.add(0); started.add(1);
  measurementStart.add(scenario.startTime);
  try {
    if (selected.id === 'focus_lifecycle') focusJourney();
    else readJourney();
  } finally { finished.add(1); }
}
export function handleSummary(data) {
  const start = data.metrics.measurement_start_epoch_ms?.values.min;
  const duration = data.state.testRunDurationMs;
  data.loadtest = { runId: __ENV.RUN_ID,
    measurementStartEpochMs: Number.isFinite(start) ? start : null,
    measurementEndEpochMs: Number.isFinite(start) && Number.isFinite(duration) ? start + Math.min(duration, seconds * 1000) : null,
    summaryEndEpochMs: Number.isFinite(start) && Number.isFinite(duration) ? start + duration : null };
  return summarize(data);
}
