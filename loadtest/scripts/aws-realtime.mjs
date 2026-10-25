#!/usr/bin/env node
// 운영 전용 계정으로 단일 WS 단계를 측정한다. 오류·시간·발생기 한도에서 전송을 멈추고 JSON을 보존한다.
import { readFileSync } from 'node:fs';
import { atomicJson, correlationId, closeEvidence, safeErrorCode, safeRejectReason, safeMessageType } from './ws-evidence.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

const harnessSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || process.argv[i + 1] === undefined) throw new Error('--이름 값 형식 필요');
  args[process.argv[i].slice(2)] = process.argv[i + 1];
}
const number = (key, fallback, low, high, integer = true) => {
  const value = Number(args[key] ?? fallback);
  if (!Number.isFinite(value) || value < low || value > high || (integer && !Number.isInteger(value))) throw new Error(`잘못된 ${key}`);
  return value;
};
const mode = args.mode || 'chat';
if (!['chat', 'movement', 'idle', 'events'].includes(mode)) throw new Error('mode: chat|movement|idle|events');
if (!args.url || !args.users || !args.out) throw new Error('--url --users --out 필요');
const targets = args.url.split(',').map(value => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'wss:' || (url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('자격 없는 wss URL 필요. 로컬 검증만 ws 허용');
  return url.toString();
});
const count = number('connections', 100, 1, 5000);
const seconds = number('seconds', 30, 1, 300);
const frequency = number('frequency', 1, 0.01, 10, false);
const offset = number('user-offset', 0, 0, 1000000);
const connectGapMs = number('connect-gap-ms', 25, 1, 1000);
const readyTimeoutMs = number('ready-timeout-ms', 12000, 100, 30000);
const drainMs = number('drain-ms', 3000, 0, 10000);
const runtimeSeconds = number('runtime-seconds', 180, 5, 600);
const maxErrors = number('max-errors', 1, 1, 1000);
const maxInflight = number('max-inflight', 50000, 1, 200000);
const maxRssMb = number('max-rss-mb', 1536, 64, 8192);
const maxPendingMs = number('max-pending-ms', 10000, 100, 60000);
const p95LimitMs = number('p95-limit-ms', 500, 1, 60000, false);
const minBudget = count * connectGapMs + readyTimeoutMs + seconds * 1000 + drainMs + 2000;
if (minBudget > runtimeSeconds * 1000) throw new Error('runtime-seconds가 연결·준비·측정·정리 예산보다 작음');
const fixture = readFileSync(args.users);
const users = JSON.parse(fixture).slice(offset, offset + count);
if (users.length !== count || new Set(users.map(u => u.userId)).size !== count || users.some(u => !u.islandId || !u.token)) throw new Error('고유 계정·islandId·token fixture 부족');
const expiry = users.map(user => {
  try {
    const claims = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url'));
    if (claims.sub !== user.userId || claims.type !== 'access' || !claims.sid || !Number.isInteger(claims.gen) || !Number.isFinite(claims.exp)) throw new Error();
    return claims.exp;
  } catch { throw new Error('fixture AT 세션 클레임 불일치'); }
});
const tokenRemainingSeconds = Math.floor(Math.min(...expiry) - Date.now() / 1000);
if (tokenRemainingSeconds < runtimeSeconds + 30) throw new Error('측정 전 AT 갱신 필요: 실행 전체를 덮는 유효기간 부족');

const runId = correlationId(args['run-id'] || randomUUID()), startedAt = new Date().toISOString();
const wallStart = performance.now(), cpuStart = process.cpuUsage();
const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
const clients = [], pending = new Map(), recentCompleted = new Map(), events = new Map();
const rooms = new Map();
for (const user of users) {
  if (!rooms.has(user.islandId)) rooms.set(user.islandId, new Set());
  rooms.get(user.islandId).add(user.userId);
}
if ([...rooms.values()].some(room => room.size > 15)) throw new Error('섬당 최대 15명: 섬 개수를 늘려야 합니다');
const latency = [], connectLatency = [], readyLatency = [];
let plannedSends = 0, sent = 0, expected = 0, delivered = 0, duplicate = 0, errors = 0, rejected = 0;
let frames = 0, snapshots = 0, receivedBytes = 0, sentBytes = 0, fullyDelivered = 0;
let stopping = false, finished = false, aborted = null, peakRss = 0;
let measurementStart = null, measurementEnd = null, eventStart = Infinity, eventEnd = Infinity;
const errorCodes = {}, messageTypes = {};
const closeEvents = [], errorEvents = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = (command, headers = {}, body = '') => `${command}\n${Object.entries(headers).map(([k, v]) => `${k}:${v}`).join('\n')}\n\n${body}\0`;
const stopSends = () => { for (const client of clients) { clearTimeout(client.startTimer); clearInterval(client.sendTimer); } };
const abort = reason => {
  if (aborted || finished) return;
  aborted = reason; stopSends();
  console.error(`[STOP] ${reason}`);
};
const error = code => { errors++; errorCodes[code] = (errorCodes[code] || 0) + 1; if (errors >= maxErrors) abort(code); };
function send(client, data) {
  if (aborted || client.ws.readyState !== WebSocket.OPEN) return;
  if (client.ws.bufferedAmount > 524288) { abort('LOADGEN_SOCKET_BACKPRESSURE'); return; }
  try { client.ws.send(data); sentBytes += Buffer.byteLength(data); } catch { error('SOCKET_SEND_FAILED'); }
}
function receive(client, raw) {
  const split = raw.indexOf('\n\n');
  if (split < 0) { error('INVALID_STOMP_FRAME'); return; }
  const headers = raw.slice(0, split).split('\n'), command = headers[0];
  if (command === 'CONNECTED') {
    client.connected = true; connectLatency.push(performance.now() - client.start);
    send(client, frame('SUBSCRIBE', { id: 'errors', destination: '/user/queue/errors', ack: 'auto' }));
    const root = mode === 'events' ? `/topic/islands/${client.user.islandId}/focus` : mode === 'movement' ? `/topic/islands/${client.user.islandId}/movement` : `/topic/groups/${client.user.islandId}`;
    if (mode === 'movement') send(client, frame('SUBSCRIBE', { id: 'snapshot', destination: root + '/snapshot', ack: 'auto' }));
    send(client, frame('SUBSCRIBE', { id: 'main', destination: root, ack: 'auto' }));
    if (mode === 'events') send(client, frame('SUBSCRIBE', { id: 'rest', destination: `/topic/islands/${client.user.islandId}/rest`, ack: 'auto' }));
    if (mode !== 'movement') { client.ready = true; readyLatency.push(performance.now() - client.start); }
    return;
  }
  if (command === 'ERROR') { error('STOMP_ERROR'); return; }
  if (command !== 'MESSAGE') return;
  frames++;
  let body; try { body = JSON.parse(raw.slice(split + 2)); } catch { error('INVALID_JSON'); return; }
  if (!body || typeof body !== 'object') { error('INVALID_BODY'); return; }
  const messageType = safeMessageType(body.type);
  messageTypes[messageType] = (messageTypes[messageType] || 0) + 1;
  if (headers.some(header => header.startsWith('destination:') && header.includes('/queue/errors'))) { error(safeErrorCode(body.code ?? body.error?.code)); return; }
  if (mode === 'events' && ['focus.member.updated', 'rest.member.updated'].includes(body.type)) {
    const occurred = Date.parse(body.occurredAt);
    if (occurred >= eventStart && occurred <= eventEnd) {
      try { correlationId(body.eventId); } catch { error('INVALID_EVENT_ID'); return; }
      if (!rooms.has(body.islandId)) { error('INVALID_EVENT_ISLAND'); return; }
      let record = events.get(body.eventId);
      if (!record) {
        if (events.size >= maxInflight) { abort('LOADGEN_EVENT_LIMIT'); return; }
        record = { islandId: body.islandId, type: body.type, receivers: new Set() }; events.set(body.eventId, record);
      }
      if (record.receivers.has(client.user.userId)) { duplicate++; return; }
      record.receivers.add(client.user.userId); delivered++; latency.push(Date.now() - occurred);
    }
    return;
  }
  if (body.type === 'FullState') {
    const actor = body.actors?.find(actor => actor.userId === client.user.userId);
    if (actor) {
      client.nav = body.navRevision; client.seq = Math.max(client.seq, actor.lastCommandSeq || 0);
      if (!client.ready) { client.ready = true; readyLatency.push(performance.now() - client.start); }
    }
  }
  if (body.type === 'Snapshot') snapshots++;
  if (body.type === 'MoveRejected') { rejected++; error(`MOVE_${safeRejectReason(body.reason)}`); return; }
  if (body.type === 'PathAccepted' && body.userId === client.user.userId) client.lastAcceptedSeq = Math.max(client.lastAcceptedSeq || 0, body.commandSeq);
  const key = mode === 'movement' ? `${body.userId}:${body.commandSeq}` : body.clientMessageId;
  if (mode === 'movement' && body.type !== 'PathAccepted') return;
  const entry = pending.get(key);
  if (!entry) { if (recentCompleted.has(key)) duplicate++; return; }
  if (!entry.receivers.has(client.user.userId)) return;
  if (entry.seen.has(client.user.userId)) { duplicate++; return; }
  entry.seen.add(client.user.userId); delivered++; latency.push(performance.now() - entry.at);
  if (entry.seen.size === entry.receivers.size) {
    fullyDelivered++; pending.delete(key); recentCompleted.set(key, performance.now());
    if (recentCompleted.size > 20000) recentCompleted.delete(recentCompleted.keys().next().value);
  }
}
function connect(user, index) {
  const client = { user, connectionId: randomUUID(), closeInitiated: false, seq: 0, start: performance.now(), ready: false, closed: false, buffer: '' };
  clients.push(client);
  const connectionUrl = new URL(targets[index % targets.length]);
  connectionUrl.searchParams.set('loadtestRunId', runId);
  connectionUrl.searchParams.set('loadtestConnectionId', client.connectionId);
  client.url = connectionUrl.toString();
  client.ws = new WebSocket(client.url, ['v12.stomp']);
  client.ws.addEventListener('open', () => send(client, frame('CONNECT', { 'accept-version': '1.2', 'heart-beat': '0,0', Authorization: `Bearer ${user.token}`, host: new URL(client.url).hostname })));
  client.ws.addEventListener('message', async ({ data }) => {
    const text = typeof data === 'string' ? data : await data.text();
    receivedBytes += Buffer.byteLength(text); client.buffer += text;
    if (client.buffer.length > 1048576) { abort('LOADGEN_RECEIVE_BUFFER_LIMIT'); return; }
    while (client.buffer.includes('\0')) {
      const end = client.buffer.indexOf('\0');
      const raw = client.buffer.slice(0, end).replace(/^(\r?\n)+/, '').replaceAll('\r\n', '\n');
      client.buffer = client.buffer.slice(end + 1); if (raw) receive(client, raw);
    }
  });
  client.ws.addEventListener('error', event => {
    if (errorEvents.length < 10) errorEvents.push({ runId, connectionId: client.connectionId, at: new Date().toISOString(), connectionIndex: index,
      elapsedMs: Math.round((performance.now() - wallStart) * 1000) / 1000,
      type: event.type === 'error' ? 'error' : 'UNKNOWN', rootCause: 'UNKNOWN' });
    error('WEBSOCKET_ERROR');
  });
  client.ws.addEventListener('close', event => {
    if (closeEvents.length < 10) closeEvents.push({ runId, connectionId: client.connectionId, at: new Date().toISOString(), connectionIndex: index,
      elapsedMs: Math.round((performance.now() - wallStart) * 1000) / 1000,
      ...closeEvidence(event, client.closeInitiated), duringShutdown: stopping });
    client.closed = true;
    if (!stopping) error('EARLY_CLOSE');
  });
}
const hardTimer = setTimeout(() => { abort('RUNTIME_LIMIT'); finish(true); }, runtimeSeconds * 1000);
const guard = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  if (peakRss > maxRssMb * 1024 * 1024) abort('LOADGEN_MEMORY_LIMIT');
  if (pending.size >= maxInflight) abort('LOADGEN_INFLIGHT_LIMIT');
  const first = pending.values().next().value;
  if (first && performance.now() - first.at > maxPendingMs) abort('DELIVERY_TIMEOUT');
  for (const client of clients) if (!client.ready && !client.closed && performance.now() - client.start > readyTimeoutMs) abort('CLIENT_READY_TIMEOUT');
}, 100);
process.once('SIGINT', () => abort('SIGINT'));
process.once('SIGTERM', () => abort('SIGTERM'));
const stats = values => {
  values.sort((a, b) => a - b);
  const quantile = p => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  return { count: values.length, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99), max: values.at(-1) ?? null };
};
async function finish(force = false) {
  if (finished) return;
  finished = true; stopping = true; stopSends(); clearInterval(guard); clearTimeout(hardTimer); loop.disable();
  measurementEnd ??= performance.now(); if (!Number.isFinite(eventEnd)) eventEnd = Date.now();
  const ready = clients.filter(client => client.ready && !client.closed).length;
  for (const client of clients) {
    if (client.closed) continue;
    client.closeInitiated = client.ws.readyState === WebSocket.OPEN;
    try { client.ws.close(1000, aborted ? 'LOADTEST_ABORT' : 'LOADTEST_COMPLETE'); } catch {}
  }
  const closeDeadline = performance.now() + 1000;
  while (clients.some(client => !client.closed) && performance.now() < closeDeadline) await sleep(10);
  if (mode === 'events') expected = [...events.values()].reduce((sum, entry) => sum + (rooms.get(entry.islandId)?.size || 0), 0);
  const measurementMs = measurementStart === null ? 0 : measurementEnd - measurementStart;
  const elapsedSeconds = (performance.now() - wallStart) / 1000;
  const cpu = process.cpuUsage(cpuStart), deliveryMs = stats(latency);
  const shutdownCloseUnconfirmed = clients.filter(client => !client.closed).length;
  const valid = shutdownCloseUnconfirmed === 0 && !aborted && ready === count && errors === 0 && rejected === 0 && duplicate === 0 && (mode === 'idle' || (mode === 'events' ? false : sent > 0 && expected === delivered));
  const sloPassed = valid && (mode === 'idle' || (deliveryMs.p95 !== null && deliveryMs.p95 <= p95LimitMs));
  const result = {
    runId, mode, startedAt, endedAt: new Date().toISOString(), targets, connections: count, attemptedConnections: clients.length, ready,
    distinctUsers: count, islandCount: rooms.size, roomSizes: [...new Set([...rooms.values()].map(room => room.size))],
    seconds, frequency, connectGapMs, runtimeSeconds, elapsedSeconds, measurementMs, trafficPattern: 'spread-periodic',
    fixtureHash: createHash('sha256').update(fixture).digest('hex'), harnessSha256,
    harnessDependenciesSha256: { 'ws-evidence.mjs': createHash('sha256').update(readFileSync(new URL('./ws-evidence.mjs', import.meta.url))).digest('hex') }, tokenRemainingSeconds, userOffset: offset,
    aborted, valid, sloPassed, p95LimitMs, eventsRequireSourceLedger: mode === 'events', limits: { maxErrors, maxInflight, maxRssMb, maxPendingMs, readyTimeoutMs },
    sent, plannedSends, sentShortfall: plannedSends - sent, expectedDeliveries: expected, delivered, missing: expected - delivered, duplicate, fullyDeliveredMessages: fullyDelivered,
    sendPerSecond: measurementMs ? sent / (measurementMs / 1000) : null, deliveryPerSecond: measurementMs ? delivered / (measurementMs / 1000) : null,
    goodputPerSecond: measurementMs ? fullyDelivered / (measurementMs / 1000) : null,
    shutdownCloseUnconfirmed,
    correlationNote: 'runId/connectionId는 클라이언트 UUID 상관관계 힌트다. PEER는 nginx/서버 중 어느 쪽인지 확정하지 않으며 선언된 사유도 실제 원인 검증을 대체하지 않는다.',
    errors, rejected, errorCodes, closeEvents, errorEvents, messageTypes, frames, snapshots, receivedBytes, sentBytes,
    connectMs: stats(connectLatency), readyMs: stats(readyLatency), deliveryMs,
    latestCommandConfirmed: clients.filter(client => client.lastAcceptedSeq === client.seq).length,
    eventWindowStart: Number.isFinite(eventStart) ? eventStart : null, eventWindowEnd: eventEnd,
    eventReceipts: [...events].map(([eventId, event]) => ({ eventId, islandId: event.islandId, type: event.type, receivers: event.receivers.size })),
    loadgen: { peakRssBytes: peakRss, cpuCores: (cpu.user + cpu.system) / 1e6 / elapsedSeconds },
    eventLoopDelayMs: { mean: loop.mean / 1e6, max: loop.max / 1e6, p99: loop.percentile(99) / 1e6 },
    note: '동시 사용자는 이 단계의 고유 연결 계정 수다. 사건 모드는 원장 대조 전 valid=false이며 발신 없는 idle은 처리량 측정이 아니다.',
  };
  atomicJson(args.out, result);
  console.log(JSON.stringify({ out: args.out, mode, connections: count, ready, sent, delivered, missing: result.missing, errors, p95: deliveryMs.p95, aborted, valid, sloPassed }));
  process.exitCode = sloPassed ? 0 : 1;
  if (force) process.exit(process.exitCode);
  setTimeout(() => process.exit(process.exitCode), 1000).unref();
}
try {
  for (const [index, user] of users.entries()) { if (aborted) break; connect(user, index); await sleep(connectGapMs); }
  const deadline = performance.now() + readyTimeoutMs;
  while (!aborted && clients.some(client => !client.ready) && performance.now() < deadline) await sleep(25);
  if (!aborted && clients.some(client => !client.ready)) abort('READY_TIMEOUT');
  if (!aborted) await sleep(1000);
  if (!aborted) {
    measurementStart = performance.now(); eventStart = Date.now();
    if (mode === 'chat' || mode === 'movement') for (const [index, client] of clients.entries()) {
      const tick = () => {
        if (aborted || stopping || client.closed) return;
        if (pending.size >= maxInflight) { abort('LOADGEN_INFLIGHT_LIMIT'); return; }
        const key = mode === 'movement' ? `${client.user.userId}:${++client.seq}` : randomUUID();
        const body = mode === 'movement' ? { commandSeq: client.seq, navRevision: client.nav, goalX: client.seq % 2 ? 38.5 : 67.5, goalY: client.seq % 2 ? 45.5 : 27.5 } : { content: `loadtest-${runId}-${key}`, clientMessageId: key };
        const receivers = rooms.get(client.user.islandId);
        pending.set(key, { at: performance.now(), receivers, seen: new Set() }); expected += receivers.size; sent++;
        send(client, frame('SEND', { destination: mode === 'movement' ? `/app/islands/${client.user.islandId}/movement/intent` : `/app/groups/${client.user.islandId}/send`, 'content-type': 'application/json' }, JSON.stringify(body)));
      };
      client.startTimer = setTimeout(() => { tick(); client.sendTimer = setInterval(tick, 1000 / frequency); }, index / clients.length * 1000 / frequency);
      plannedSends += Math.ceil(seconds * frequency - index / clients.length);
    }
    const end = measurementStart + seconds * 1000;
    while (!aborted && performance.now() < end) await sleep(Math.min(100, end - performance.now()));
    measurementEnd = performance.now(); eventEnd = Date.now(); stopSends();
    if (!aborted) await sleep(drainMs);
  }
} catch { abort('HARNESS_RUNTIME_ERROR'); }
finally { await finish(); }
