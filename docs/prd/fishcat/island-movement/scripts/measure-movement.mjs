#!/usr/bin/env node
// 섬 이동 1단계(Realtime STOMP) 서버 측 측정 — GROMO-2250.
//
// 로컬 스택(nginx → business-api·realtime)에 게스트 N명을 만들어 한 섬에 넣고, 사용자당 STOMP 세션 1개로
// 앱(`islandRealtime.ts`)과 같은 연결·구독·intent 를 보내 60초 동안 걷게 한 뒤 왕복·스냅샷 간격·수신량·거절·끊김과
// realtime `/actuator/prometheus` 의 이동 지표를 마크다운 표 하나로 낸다. 앱 화면은 띄우지 않는다(서버 측만).
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const USAGE = `사용법(레포 루트에서):
  NODE_PATH=<앱 node_modules> node docs/prd/fishcat/island-movement/scripts/measure-movement.mjs [옵션]

  --users 1,5,15     측정할 동시 사용자 수(쉼표 목록, 반복 가능). 기본 1,5,15 를 차례로
  --duration 60      N 마다 부하 시간(초)
  --interval 2000    사용자마다 intent 간격(ms). 사용자끼리는 간격을 N 등분해 엇갈리고, 각 송신에 0~1틱 지터
  --gap 130          N 사이 쉬는 시간(초) — Micrometer _max 창(최근 약 2분)이 앞 측정과 겹치지 않게
  --island <uuid>    기존 섬 재사용(가입 승인 없는 섬). 생략하면 첫 계정이 새 섬을 만든다
  --state <file>     게스트 계정·섬을 저장/재사용 — 로컬 토큰이 들어가므로 레포 밖 경로로
  --json <file>      원자료(JSON)를 이 파일에 쓴다
  --base <url>       기본 http://127.0.0.1:8088 (로컬 nginx)
  --metrics-cmd <s>  Prometheus 본문을 stdout 으로 내는 명령. 기본은 아래(nginx 는 /actuator 를 막는다)
                     docker exec phone-realtime-local wget -qO- http://localhost:9091/actuator/prometheus
  --nav <file>       통행 격자. 기본 server/realtime/src/main/resources/movement/nav.json
  --seed 2250        목적지 난수 시드(사용자별 seed+i)
  --self-check       네트워크 없이 계산 함수만 점검하고 끝낸다`;

const REPO_NAV = fileURLToPath(
  new URL('../../../../../server/realtime/src/main/resources/movement/nav.json', import.meta.url),
);

function parseArgs(argv) {
  const o = {
    base: 'http://127.0.0.1:8088',
    users: [],
    duration: 60,
    interval: 2000,
    gap: 130,
    grace: 3,
    island: null,
    state: null,
    json: null,
    nav: REPO_NAV,
    seed: 2250,
    metricsCmd: 'docker exec phone-realtime-local wget -qO- http://localhost:9091/actuator/prometheus',
    selfCheck: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} 에 값이 없다`);
      return v;
    };
    if (flag === '--users') o.users.push(...val().split(',').map(Number));
    else if (flag === '--duration') o.duration = Number(val());
    else if (flag === '--interval') o.interval = Number(val());
    else if (flag === '--gap') o.gap = Number(val());
    else if (flag === '--island') o.island = val().toLowerCase();
    else if (flag === '--state') o.state = val();
    else if (flag === '--json') o.json = val();
    else if (flag === '--base') o.base = val().replace(/\/$/, '');
    else if (flag === '--metrics-cmd') o.metricsCmd = val();
    else if (flag === '--nav') o.nav = val();
    else if (flag === '--seed') o.seed = Number(val());
    else if (flag === '--self-check') o.selfCheck = true;
    else if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`모르는 인자 ${flag}\n${USAGE}`);
  }
  if (!o.users.length) o.users = [1, 5, 15];
  for (const n of o.users) if (!Number.isInteger(n) || n < 1 || n > 15) throw new Error(`--users 는 1~15 정수: ${n}`);
  return o;
}

// ── 통행 격자: 스폰 셀과 같은 연결 영역의 통행 셀 중심 (앱 nav-path.ts neighbor 와 같은 규칙) ──
function spawnRegion(nav) {
  const { columns: cols, rows } = nav;
  const n = cols * rows;
  const walk = (i) => nav.walkable[i] === '1';
  const blocked = new Set((nav.blockedEdges ?? []).map(([a, b]) => Math.min(a, b) * n + Math.max(a, b)));
  const neighbor = (p, dx, dy) => {
    const x = (p % cols) + dx;
    const y = Math.floor(p / cols) + dy;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
    const q = y * cols + x;
    if (!walk(q)) return -1;
    if ((!dx || !dy) && blocked.has(Math.min(p, q) * n + Math.max(p, q))) return -1;
    if (dx && dy && (!walk((y - dy) * cols + x) || !walk(y * cols + x - dx))) return -1; // 대각은 양옆 직교 셀 둘 다 통행
    return q;
  };
  const { cx, cy } = nav.spawns.character;
  const start = cy * cols + cx;
  assert(walk(start), '스폰 셀이 통행이 아니다');
  const seen = new Uint8Array(n);
  seen[start] = 1;
  const queue = [start];
  for (let h = 0; h < queue.length; h++) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const q = neighbor(queue[h], dx, dy);
        if (q >= 0 && !seen[q]) {
          seen[q] = 1;
          queue.push(q);
        }
      }
  }
  return queue.map((i) => ({ x: (i % cols) + 0.5, y: Math.floor(i / cols) + 0.5 }));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 최근접 순위(nearest-rank) 백분위 — 정렬된 배열.
const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null;
const ms = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(1)} ms`);
const sleep = (t) => new Promise((r) => setTimeout(r, Math.max(0, t)));

// Prometheus 텍스트에서 이동·GC 줄만. 라벨 값에 공백이 있어(cause="G1 Evacuation Pause") 마지막 `}` 로 자른다.
function parseProm(text) {
  const m = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    if (!line.startsWith('movement_') && !line.startsWith('jvm_gc_pause_seconds')) continue;
    const close = line.lastIndexOf('}');
    const key = close >= 0 ? line.slice(0, close + 1) : line.split(' ')[0];
    const value = Number(line.slice(key.length).trim().split(/\s+/)[0]);
    m.set(key, value);
  }
  return m;
}

function scrape(cmd) {
  try {
    const text = execSync(cmd, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const metrics = parseProm(text);
    return metrics.size ? { ok: true, metrics } : { ok: false, error: '이동 지표 줄이 없다' };
  } catch (e) {
    return { ok: false, error: String(e.message).split('\n')[0] };
  }
}

// 카운터·count·sum 은 전후 델타, max 는 «뒤» 스크레이프 값(Micrometer 의 최근 창 최댓값).
// 지표 키 자체가 «뒤» 스크레이프에 없으면(이름 오타·미등록) missingMetrics 에 남긴다 — 「이름이 틀려 조용히 Δ 0」 방지.
// Micrometer 는 등록한 Counter 를 한 번도 증가시키지 않아도 `…_total 0.0` 으로 내보낸다(2026-10-10 로컬 realtime 스크레이프
// 실측: overflow·send_failed·recheck_suspended 가 0.0 으로 찍힘) — 그래서 「키 없음」은 곧 이름 오타·미등록이다.
function metricSummary(before, after) {
  const delta = (k) => (after.get(k) ?? 0) - (before.get(k) ?? 0);
  const missingMetrics = [];
  const timer = (name) => {
    const missing = !after.has(`${name}_count`) && !after.has(`${name}_sum`) && !after.has(`${name}_max`);
    if (missing) missingMetrics.push(name);
    const c = delta(`${name}_count`);
    return { count: c, meanMs: c ? (delta(`${name}_sum`) / c) * 1000 : null, maxMs: (after.get(`${name}_max`) ?? NaN) * 1000, missing };
  };
  const counter = (key) => {
    const missing = !after.has(key);
    if (missing) missingMetrics.push(key);
    return { value: delta(key), missing };
  };
  const depthMissing =
    !after.has('movement_outbox_reliable_depth_count') &&
    !after.has('movement_outbox_reliable_depth_sum') &&
    !after.has('movement_outbox_reliable_depth_max');
  if (depthMissing) missingMetrics.push('movement_outbox_reliable_depth');
  const depthCount = delta('movement_outbox_reliable_depth_count');
  let gcMax = 0;
  let gcCount = 0;
  let gcSum = 0;
  for (const [k, v] of after) {
    if (k.startsWith('jvm_gc_pause_seconds_max')) gcMax = Math.max(gcMax, v);
    else if (k.startsWith('jvm_gc_pause_seconds_count')) gcCount += v - (before.get(k) ?? 0);
    else if (k.startsWith('jvm_gc_pause_seconds_sum')) gcSum += v - (before.get(k) ?? 0);
  }
  return {
    tick: timer('movement_tick_seconds'),
    pathfind: timer('movement_pathfind_seconds'),
    depth: {
      count: depthCount,
      mean: depthCount ? delta('movement_outbox_reliable_depth_sum') / depthCount : null,
      max: after.get('movement_outbox_reliable_depth_max') ?? null,
      missing: depthMissing,
    },
    superseded: counter('movement_outbox_snapshot_superseded_total'),
    overflow: counter('movement_outbox_overflow_total'),
    sendFailed: counter('movement_outbox_send_failed_total'),
    recheckSuspended: counter('movement_recheck_suspended_total'),
    gc: { maxMs: gcMax * 1000, count: gcCount, sumMs: gcSum * 1000 },
    missingMetrics,
  };
}

// ── 공개 API(앱 services/api 와 같은 경로·헤더) ──
async function api(base, path, { method = 'GET', token, headers = {}, body } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // 본문이 JSON 이 아니면 상태만 본다.
  }
  if (!res.ok) {
    const err = json?.error ?? json ?? {};
    throw new Error(`${method} ${path} → ${res.status} ${err.code ?? ''} ${err.message ?? text.slice(0, 120)}`.trim());
  }
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

const tokenTtlSec = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp - Date.now() / 1000;
  } catch {
    return -1;
  }
};

async function freshToken(base, acc) {
  if (tokenTtlSec(acc.accessToken) > 600) return;
  const r = await api(base, '/auth/sessions/current/refresh', {
    method: 'POST',
    headers: { 'X-Refresh-Token': acc.refreshToken },
  });
  acc.accessToken = r.accessToken;
  if (r.refreshToken) acc.refreshToken = r.refreshToken;
}

async function prepare(o, state, need, log) {
  let accountError = null;
  while (state.accounts.length < need) {
    const deviceId = randomUUID();
    try {
      const r = await api(o.base, '/auth/sessions/guest', { method: 'POST', headers: { 'X-Device-Id': deviceId } });
      state.accounts.push({ deviceId, userId: r.userId, accessToken: r.accessToken, refreshToken: r.refreshToken, islands: [] });
      log(`게스트 ${state.accounts.length}/${need} 발급`);
    } catch (e) {
      accountError = `게스트 발급 실패: ${e.message}`;
      break;
    }
  }
  for (const acc of state.accounts) await freshToken(o.base, acc);
  if (o.island) state.islandId = o.island;
  if (!state.islandId && state.accounts.length) {
    const host = state.accounts[0];
    const r = await api(o.base, '/islands', {
      method: 'POST',
      token: host.accessToken,
      headers: { 'Idempotency-Key': randomUUID() },
      body: { name: `이동측정 ${new Date().toISOString().slice(0, 16)}`, approvalRequired: false, maxMembers: 15 },
    });
    state.islandId = r.id;
    host.islands.push(r.id);
    log(`섬 생성 ${r.id}`);
  }
  for (const acc of state.accounts) {
    if (acc.islands.includes(state.islandId)) continue;
    const r = await api(o.base, `/islands/${state.islandId}/memberships`, {
      method: 'POST',
      token: acc.accessToken,
      headers: { 'Idempotency-Key': randomUUID() },
      body: {},
    });
    if (r.status !== 'active') throw new Error(`가입이 즉시 되지 않았다(status=${r.status}) — 가입 승인 없는 섬이어야 한다`);
    acc.islands.push(state.islandId);
  }
  return accountError;
}

// ── 세션 1개 = 사용자 1명 (앱 stompIslandChannel 의 movement 채널과 같은 설정) ──
class Session {
  constructor({ index, account, islandId, wsUrl, Client, seed }) {
    Object.assign(this, { index, userId: account.userId, token: account.accessToken, islandId, wsUrl, Client });
    this.rand = mulberry32(seed + index);
    this.seq = 0;
    this.navRevision = 1;
    this.tickMs = 50;
    this.pending = new Map(); // commandSeq → 보낸 시각
    this.rtts = [];
    this.rejects = {};
    this.queueErrors = {};
    this.stompErrors = [];
    this.closes = [];
    this.counts = {};
    this.snapIntervals = [];
    this.snapBodyBytes = [];
    this.windowBytes = 0;
    this.window = [Infinity, Infinity];
    this.sent = 0;
    this.sendSkipped = 0;
    this.snapshotBeforeFullState = 0;
    this.firstMovementType = null;
    this.firstFullStateHasSelf = null;
    this.subscribeToFullStateMs = null;
    this.closing = false;
  }

  inWindow(t) {
    return t >= this.window[0] && t <= this.window[1];
  }

  start() {
    return new Promise((resolve) => {
      const done = (ok) => {
        clearTimeout(timer);
        this.onReady = null;
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), 15_000);
      this.onReady = done;
      const topic = `/topic/islands/${this.islandId}/movement`;
      this.client = new this.Client({
        webSocketFactory: () => {
          const ws = new WebSocket(this.wsUrl, ['v12.stomp', 'v11.stomp', 'v10.stomp']);
          ws.addEventListener('message', (ev) => {
            if (!this.inWindow(performance.now())) return;
            this.windowBytes += typeof ev.data === 'string' ? Buffer.byteLength(ev.data) : (ev.data.byteLength ?? 0);
          });
          ws.addEventListener('close', (ev) => {
            if (!this.closing) this.closes.push(`${ev.code} ${ev.reason || '(사유 없음)'}`);
            this.onReady?.(false);
          });
          return ws;
        },
        connectHeaders: { Authorization: `Bearer ${this.token}` },
        reconnectDelay: 0, // 앱은 5초 재연결 — 측정은 끊김을 숨기지 않으려고 끈다
        heartbeatIncoming: 10_000,
        heartbeatOutgoing: 10_000,
        forceBinaryWSFrames: true,
        appendMissingNULLonIncoming: true,
        debug: () => {},
        onConnect: () => {
          this.subscribedAt = performance.now();
          this.client.subscribe(topic, (m) => this.onMovement(m));
          this.client.subscribe(`${topic}/snapshot`, (m) => this.onSnapshot(m));
          this.client.subscribe('/user/queue/errors', (m) => {
            let code = 'UNKNOWN';
            try {
              code = JSON.parse(m.body).code ?? code;
            } catch {
              // 그대로 UNKNOWN
            }
            this.queueErrors[code] = (this.queueErrors[code] ?? 0) + 1;
          });
        },
        onStompError: (frame) => {
          this.stompErrors.push(frame.headers.message ?? '(message 없음)');
          this.onReady?.(false);
        },
      });
      this.client.activate();
    });
  }

  onMovement(m) {
    const t = performance.now();
    let b;
    try {
      b = JSON.parse(m.body);
    } catch {
      return;
    }
    this.counts[b.type] = (this.counts[b.type] ?? 0) + 1;
    this.firstMovementType ??= b.type;
    if (b.type === 'FullState' && this.subscribeToFullStateMs === null) {
      const me = (b.actors ?? []).find((a) => a.userId === this.userId);
      this.firstFullStateHasSelf = !!me;
      this.navRevision = b.navRevision ?? 1;
      this.tickMs = b.tickMs ?? 50;
      this.seq = Math.max(this.seq, me?.lastCommandSeq ?? 0); // N20 — 서버의 lastCommandSeq 위에서 잇는다
      this.subscribeToFullStateMs = t - this.subscribedAt;
      this.onReady?.(true);
    } else if ((b.type === 'PathAccepted' || b.type === 'MoveRejected') && b.userId === this.userId) {
      const sentAt = this.pending.get(b.commandSeq);
      if (sentAt === undefined) return;
      this.pending.delete(b.commandSeq);
      if (b.type === 'PathAccepted') this.rtts.push(t - sentAt);
      else this.rejects[b.reason] = (this.rejects[b.reason] ?? 0) + 1;
    }
  }

  onSnapshot(m) {
    const t = performance.now();
    if (this.subscribeToFullStateMs === null) this.snapshotBeforeFullState++;
    let b;
    try {
      b = JSON.parse(m.body);
    } catch {
      return;
    }
    this.counts.Snapshot = (this.counts.Snapshot ?? 0) + 1;
    const moving = (b.entities ?? []).some((e) => e.state === 'MOVING');
    if (this.inWindow(t)) {
      this.snapBodyBytes.push(Buffer.byteLength(m.body));
      // 직전 Snapshot 에 걷는 주민이 있었을 때만 — 정지 뒤 공백(N15, 정지 방은 안 보낸다)은 간격이 아니다.
      if (this.lastSnap?.moving && this.inWindow(this.lastSnap.t)) this.snapIntervals.push(t - this.lastSnap.t);
    }
    this.lastSnap = { t, moving };
  }

  sendIntent() {
    if (!this.client?.connected) {
      this.sendSkipped++;
      return;
    }
    const goal = this.goals[Math.floor(this.rand() * this.goals.length)];
    const seq = ++this.seq;
    this.pending.set(seq, performance.now());
    this.sent++;
    this.client.publish({
      destination: `/app/islands/${this.islandId}/movement/intent`,
      body: JSON.stringify({ commandSeq: seq, navRevision: this.navRevision, goalX: goal.x, goalY: goal.y }),
    });
  }
}

async function runOnce(n, ctx) {
  const { o, state, Client, goals, log } = ctx;
  const startedAt = new Date().toISOString();
  if (state.accounts.length < n) {
    return { n, startedAt, skipped: `측정 불가 — 계정 ${state.accounts.length}/${n}명(${ctx.accountError ?? '계정 부족'})` };
  }
  for (const acc of state.accounts.slice(0, n)) await freshToken(o.base, acc);
  const beforeAt = Date.now();
  const before = scrape(o.metricsCmd);
  const wsUrl = `${o.base.replace(/^http/, 'ws')}/ws/realtime`;
  const sessions = state.accounts
    .slice(0, n)
    .map((account, index) => new Session({ index, account, islandId: state.islandId, wsUrl, Client, seed: o.seed }));
  for (const s of sessions) s.goals = goals;
  const ready = await Promise.all(sessions.map((s) => s.start()));
  sessions.forEach((s, i) => (s.ready = ready[i]));
  const live = sessions.filter((s) => s.ready);
  log(`N=${n}: 준비 ${live.length}/${n} — ${o.duration}초 부하`);

  const loadStart = performance.now() + 200;
  const loadEnd = loadStart + o.duration * 1000;
  for (const s of sessions) s.window = [loadStart, loadEnd];
  const timers = [];
  live.forEach((s, i) => {
    const offset = (i * o.interval) / live.length;
    for (let at = loadStart + offset; at < loadEnd; at += o.interval) {
      // 0~1틱 지터 — 2000ms 는 틱(50ms)의 배수라 지터가 없으면 한 세션의 intent 가 전부 같은 틱 위상에 떨어져
      // 왕복이 틱 대기 한 값으로 굳는다(첫 실행에서 실측). 사람의 탭은 틱 위상과 무관하다.
      const jitter = s.rand() * s.tickMs;
      timers.push(setTimeout(() => s.sendIntent(), at + jitter - performance.now()));
    }
  });
  await sleep(loadEnd + o.grace * 1000 - performance.now());
  timers.forEach(clearTimeout);
  for (const s of sessions) s.closing = true;
  await Promise.all(sessions.map((s) => s.client?.deactivate().catch(() => {})));
  await sleep(1000);
  const after = scrape(o.metricsCmd);
  const elapsedMs = Date.now() - beforeAt; // 벽시계 — 호스트가 잠들면 늘고 서버 틱은 그만큼 안 는다
  return { n, startedAt, sessions, ready: live.length, before, after, elapsedMs };
}

function summarize(r, o) {
  if (r.skipped) return { n: r.n, startedAt: r.startedAt, skipped: r.skipped };
  const all = (f) => r.sessions.flatMap(f);
  const rtts = all((s) => s.rtts).sort((a, b) => a - b);
  const intervals = all((s) => s.snapIntervals).sort((a, b) => a - b);
  const subToFull = all((s) => (s.subscribeToFullStateMs === null ? [] : [s.subscribeToFullStateMs])).sort((a, b) => a - b);
  const bodies = all((s) => s.snapBodyBytes);
  const bps = r.sessions.filter((s) => s.ready).map((s) => s.windowBytes / o.duration);
  const merge = (f) =>
    r.sessions.reduce((acc, s) => {
      for (const [k, v] of Object.entries(f(s))) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {});
  const out = {
    n: r.n,
    startedAt: r.startedAt,
    ready: r.ready,
    firstIsFullState: r.sessions.filter((s) => s.firstMovementType === 'FullState').length,
    firstHasSelf: r.sessions.filter((s) => s.firstFullStateHasSelf).length,
    snapshotBeforeFullState: r.sessions.reduce((a, s) => a + s.snapshotBeforeFullState, 0),
    subToFull: { p50: pct(subToFull, 0.5), max: subToFull.at(-1) ?? null },
    sent: r.sessions.reduce((a, s) => a + s.sent, 0),
    sendSkipped: r.sessions.reduce((a, s) => a + s.sendSkipped, 0),
    rtt: { count: rtts.length, p50: pct(rtts, 0.5), p99: pct(rtts, 0.99), max: rtts.at(-1) ?? null },
    rejects: merge((s) => s.rejects),
    noAnswer: r.sessions.reduce((a, s) => a + s.pending.size, 0),
    snap: {
      count: intervals.length,
      p50: pct(intervals, 0.5),
      p99: pct(intervals, 0.99),
      max: intervals.at(-1) ?? null,
      over100: intervals.length ? intervals.filter((v) => v >= 100).length / intervals.length : null,
    },
    bytesPerSec: bps.length ? { mean: bps.reduce((a, v) => a + v, 0) / bps.length, min: Math.min(...bps), max: Math.max(...bps) } : null,
    snapBodyMean: bodies.length ? bodies.reduce((a, v) => a + v, 0) / bodies.length : null,
    closes: all((s) => s.closes),
    stompErrors: all((s) => s.stompErrors),
    queueErrors: merge((s) => s.queueErrors),
    counts: merge((s) => s.counts),
    metrics: r.before.ok && r.after.ok ? metricSummary(r.before.metrics, r.after.metrics) : null,
    metricsError: r.before.ok && r.after.ok ? null : (r.before.error ?? r.after.error),
    elapsedMs: r.elapsedMs,
  };
  // 유효성 — 기록된 틱 수 ÷ (전후 스크레이프 사이 벽시계 ÷ 틱 50ms). catch-up 상한(20)을 넘겨 건너뛴 틱은 Timer 에
  // 안 남으므로, 호스트 절전·VM 정지가 끼면 이 비율이 크게 떨어진다(2026-10-09 맥이 잠든 실행의 N=1 은 Δcount 142,
  // 같은 길이의 정상 실행은 1,288).
  out.tickProgress = out.metrics ? out.metrics.tick.count / (r.elapsedMs / 50) : null;
  out.missingMetrics = out.metrics?.missingMetrics ?? [];
  out.raw = {
    rtts,
    snapIntervals: intervals,
    bytesPerSecBySession: bps,
    promBefore: r.before.ok ? Object.fromEntries(r.before.metrics) : r.before.error,
    promAfter: r.after.ok ? Object.fromEntries(r.after.metrics) : r.after.error,
  };
  return out;
}

const countText = (obj) =>
  Object.keys(obj).length ? Object.entries(obj).map(([k, v]) => `${k} ×${v}`).join(' · ') : '0건';
// 지표 키 자체가 없을 때 표시 — Timer·DistributionSummary·Counter 모두 등록 즉시 찍히므로(Counter 는 0.0) 「없음」= 이름 오타·미등록.
const MISSING_METRIC_TEXT = '지표 없음 — 스크레이프에 키가 없다(이름·등록 확인)';
const counterText = (c) => (c.missing ? MISSING_METRIC_TEXT : `Δ ${c.value}`);

function table(results, o) {
  const rows = [['항목', '값', 'N', '측정 방법']];
  const push = (item, value, n, how) => rows.push([item, value, String(n), how]);
  for (const s of results) {
    if (s.skipped) {
      push('전체', s.skipped, s.n, '—');
      continue;
    }
    const m = s.metrics;
    const noMetric = `측정 불가 — ${s.metricsError}`;
    push(
      '실행 유효성(서버 틱 진행)',
      s.tickProgress === null
        ? '판단 불가 — Prometheus 를 못 읽었다'
        : `${(s.tickProgress * 100).toFixed(1)}%${s.tickProgress < 0.9 ? ' ⚠ 측정 중 서버가 멈췄다(호스트 절전·VM 정지 의심) — 이 N 의 값은 버린다' : ' — 정상'}`,
      s.n,
      'movement_tick_seconds Δcount ÷ (전후 스크레이프 사이 벽시계 ÷ 50ms)',
    );
    push(
      '접속·첫 FullState',
      `준비 ${s.ready}/${s.n} · 첫 movement 메시지 FullState ${s.firstIsFullState}/${s.n} · 자기 actor 포함 ${s.firstHasSelf}/${s.n} · FullState 전 Snapshot ${s.snapshotBeforeFullState}건 · 구독→FullState p50 ${ms(s.subToFull.p50)}, 최대 ${ms(s.subToFull.max)}`,
      s.n,
      'CONNECT(Bearer) 뒤 movement → movement/snapshot → /user/queue/errors 순 SUBSCRIBE, 첫 FullState 수신 − movement SUBSCRIBE 송신',
    );
    push(
      'intent → 내 PathAccepted 왕복',
      `p50 ${ms(s.rtt.p50)} · p99 ${ms(s.rtt.p99)} · 최대 ${ms(s.rtt.max)} (응답 ${s.rtt.count}/보냄 ${s.sent})`,
      s.n,
      `사용자마다 ${o.interval}ms 간격(+0~1틱 무작위 지터) 무작위 통행 셀(스폰 연결 영역) intent, 송신 직전 → 같은 commandSeq·내 userId PathAccepted 수신. 서버가 다음 틱(≤50ms)에 처리하므로 틱 대기 포함. 최근접 순위 백분위`,
    );
    push('MoveRejected', countText(s.rejects), s.n, '요청자 세션에만 오는 MoveRejected 를 reason 별로');
    push('무응답 intent', `${s.noAnswer}건 (미연결로 못 보냄 ${s.sendSkipped}건)`, s.n, `부하 끝 + ${o.grace}초 안에 PathAccepted·MoveRejected 가 없던 intent`);
    push(
      'Snapshot 수신 간격',
      `p50 ${ms(s.snap.p50)} · p99 ${ms(s.snap.p99)} · 최대 ${ms(s.snap.max)} · 100ms 이상 ${s.snap.over100 === null ? '—' : (s.snap.over100 * 100).toFixed(2) + '%'} (표본 ${s.snap.count})`,
      s.n,
      '20Hz 기대 50ms. 직전 Snapshot 에 MOVING entity 가 있을 때 다음 Snapshot 까지의 간격(정지 뒤 공백 제외), 전 세션 합산',
    );
    push(
      '세션당 수신량',
      s.bytesPerSec
        ? `평균 ${s.bytesPerSec.mean.toFixed(0)} B/s (≈ ${((s.bytesPerSec.mean * 3600) / 1e6).toFixed(1)} MB/시간) · ${s.bytesPerSec.min === s.bytesPerSec.max ? '세션 간 편차 0' : `세션 최소~최대 ${s.bytesPerSec.min.toFixed(0)}~${s.bytesPerSec.max.toFixed(0)} B/s`} · Snapshot 본문 평균 ${s.snapBodyMean === null ? '—' : s.snapBodyMean.toFixed(0) + ' B'}`
        : '측정 불가 — 준비된 세션 없음',
      s.n,
      `부하 ${o.duration}초 동안 WebSocket message 바이트(STOMP 헤더·하트비트 포함) ÷ ${o.duration}. 전 세션이 같은 브로드캐스트를 받아 세션 간 편차는 거의 없다`,
    );
    push(
      '끊김·ERROR',
      [
        s.closes.length ? `close ${s.closes.join(' / ')}` : 'close 0건',
        s.stompErrors.length ? `STOMP ERROR ${s.stompErrors.join(' / ')}` : 'STOMP ERROR 0건',
        `오류 큐 ${countText(s.queueErrors)}`,
      ].join(' · '),
      s.n,
      '의도적 해제 전 WebSocket close code·reason, STOMP ERROR message, /user/queue/errors code',
    );
    if (!m) {
      push('Prometheus 이동 지표', noMetric, s.n, o.metricsCmd);
      continue;
    }
    const how = '/actuator/prometheus 실행 전후 델타(평균 = Δsum/Δcount). 최대 = 뒤 스크레이프의 _max(Micrometer 최근 약 2분 창)';
    push(
      'movement_tick_seconds',
      m.tick.missing ? MISSING_METRIC_TEXT : `Δcount ${m.tick.count} · 평균 ${ms(m.tick.meanMs)} · 최대 ${ms(m.tick.maxMs)}`,
      s.n,
      how,
    );
    push('틱 p50·p99', '측정 불가 — movement.tick Timer 가 백분위·히스토그램을 내지 않는다(count·sum·max 만)', s.n, '—');
    push(
      'movement_pathfind_seconds',
      m.pathfind.missing ? MISSING_METRIC_TEXT : `Δcount ${m.pathfind.count} · 평균 ${ms(m.pathfind.meanMs)} · 최대 ${ms(m.pathfind.maxMs)}`,
      s.n,
      how,
    );
    push(
      'movement_outbox_reliable_depth',
      m.depth.missing
        ? MISSING_METRIC_TEXT
        : `표본 ${m.depth.count} · 평균 ${m.depth.mean === null ? '—' : m.depth.mean.toFixed(2)} · 최대 ${m.depth.max}`,
      s.n,
      `${how}. reliable 사건을 넣은 직후 세션 큐 깊이`,
    );
    push('movement_outbox_snapshot_superseded_total', counterText(m.superseded), s.n, '보내기 전에 더 새 Snapshot 으로 덮어쓴 횟수(전후 델타)');
    push(
      'movement_outbox_overflow_total · send_failed_total',
      `${counterText(m.overflow)} · ${counterText(m.sendFailed)}`,
      s.n,
      '큐 상한·넘기기 실패로 닫은 세션 수(전후 델타)',
    );
    push('movement_recheck_suspended_total', counterText(m.recheckSuspended), s.n, '강퇴 재검사로 멈춘 outbox 수(전후 델타)');
    push(
      'jvm_gc_pause_seconds',
      `_max 최대 ${ms(m.gc.maxMs)} · Δcount ${m.gc.count} · Δsum ${ms(m.gc.sumMs)}`,
      s.n,
      '전 GC 계열 합산. _max 는 뒤 스크레이프 기준 최근 창',
    );
  }
  rows.push([
    '틱 지연·catch-up·Snapshot 건너뜀·토큰 버킷 드롭',
    '측정 불가 — MovementTicker(delayed·skippedSnapshot·skippedTick)·RoomRuntime(rateLimitedDrop) 카운터가 지표로 노출되지 않는다',
    '공통',
    '—',
  ]);
  const esc = (c) => String(c).replaceAll('|', '\\|');
  return rows.map((r, i) => `| ${r.map(esc).join(' | ')} |${i === 0 ? '\n|---|---|---|---|' : ''}`).join('\n');
}

function selfCheck(nav) {
  assert.equal(pct([10, 20, 30, 40], 0.5), 20);
  assert.equal(pct([10, 20, 30, 40], 0.99), 40);
  assert.equal(pct([], 0.5), null);
  const prom = parseProm(
    [
      '# HELP x',
      'movement_tick_seconds_count 10',
      'movement_tick_seconds_sum 0.5',
      'movement_tick_seconds_max 0.07',
      'jvm_gc_pause_seconds_max{action="end of minor GC",cause="G1 Evacuation Pause",gc="G1 Young Generation"} 0.004',
      'jvm_other 1',
    ].join('\n'),
  );
  assert.equal(prom.size, 4);
  assert.equal(prom.get('jvm_gc_pause_seconds_max{action="end of minor GC",cause="G1 Evacuation Pause",gc="G1 Young Generation"}'), 0.004);
  const s = metricSummary(new Map([['movement_tick_seconds_count', 4], ['movement_tick_seconds_sum', 0.1]]), prom);
  assert.equal(s.tick.count, 6);
  assert.ok(Math.abs(s.tick.meanMs - (0.4 / 6) * 1000) < 1e-9);
  assert.ok(Math.abs(s.gc.maxMs - 4) < 1e-9);
  // 지표 존재 검사 — 스크레이프에 없는 지표는 missing 으로 잡혀야 한다(「이름이 틀려 조용히 Δ 0」 방지).
  assert.equal(s.tick.missing, false);
  assert.equal(s.pathfind.missing, true);
  assert.deepEqual(
    s.missingMetrics.sort(),
    [
      'movement_outbox_overflow_total',
      'movement_outbox_reliable_depth',
      'movement_outbox_send_failed_total',
      'movement_pathfind_seconds',
      'movement_recheck_suspended_total',
      'movement_outbox_snapshot_superseded_total',
    ].sort(),
  );
  const region = spawnRegion(nav);
  const { cx, cy } = nav.spawns.character;
  assert.ok(region.some((p) => p.x === cx + 0.5 && p.y === cy + 0.5));
  for (const p of region) assert.equal(nav.walkable[Math.floor(p.y) * nav.columns + Math.floor(p.x)], '1');
  console.log(`self-check 통과 — 스폰 연결 영역 통행 셀 ${region.length}개`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const nav = JSON.parse(readFileSync(o.nav, 'utf8'));
  if (o.selfCheck) return selfCheck(nav);
  if (typeof WebSocket !== 'function') throw new Error('전역 WebSocket 이 없다 — Node 22 이상');
  let Client;
  try {
    ({ Client } = createRequire(import.meta.url)('@stomp/stompjs'));
  } catch {
    throw new Error('@stomp/stompjs 를 못 찾았다 — NODE_PATH=<레포>/app/app-dev/node_modules 로 실행한다(앱과 같은 패키지)');
  }
  const log = (msg) => console.error(`[measure] ${msg}`);
  const state = o.state && existsSync(o.state) ? JSON.parse(readFileSync(o.state, 'utf8')) : { accounts: [] };
  if (state.base && state.base !== o.base) throw new Error(`--state 는 ${state.base} 용이다`);
  state.base = o.base;
  const save = () => o.state && writeFileSync(o.state, JSON.stringify(state, null, 2), { mode: 0o600 });
  let accountError;
  try {
    accountError = await prepare(o, state, Math.max(...o.users), log);
  } finally {
    save();
  }
  const goals = spawnRegion(nav);
  log(`섬 ${state.islandId} · 계정 ${state.accounts.length} · 목적지 후보 ${goals.length}셀`);
  const results = [];
  for (const [i, n] of o.users.entries()) {
    if (i > 0) await sleep(o.gap * 1000);
    let r;
    try {
      r = await runOnce(n, { o, state, Client, goals, log, accountError });
    } catch (e) {
      r = { n, startedAt: new Date().toISOString(), skipped: `측정 불가 — ${e.message}` };
    }
    save();
    results.push(summarize(r, o));
  }
  console.log(table(results, o));
  if (o.json) {
    writeFileSync(
      o.json,
      JSON.stringify({ base: o.base, islandId: state.islandId, duration: o.duration, interval: o.interval, results }, null, 2),
    );
    log(`원자료 ${o.json}`);
  }
}

main().catch((e) => {
  console.error(`[measure] 실패: ${e.message}`);
  process.exit(1);
});
