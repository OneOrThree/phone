const API = 'https://metamoa.com/api';
const WINDOW_MS = 5 * 60_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const encoder = new TextEncoder();
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

// 토큰·사용자 ID는 저장하지 않는다. 기존 서버가 인증한 요청만 짧은 수명의 집계에 쓴다.
export async function recordWebPresence(request, response, env) {
  if (!env.METAMOA_PRESENCE || !env.METAMOA_PRESENCE_SALT || !response.ok) return;
  const path = new URL(request.url).pathname;
  if (
    path !== '/service-api/me' ||
    request.method !== 'GET' ||
    request.headers.get('X-Metamoa-Presence') !== '1'
  )
    return;
  if (
    request.headers.get('X-Metamoa-Exclude') === '1' ||
    /bot|crawler|spider|headless|playwright|selenium/i.test(request.headers.get('User-Agent') || '')
  )
    return;
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if (!token) return;
  let claims;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(atob(part));
  } catch {
    return;
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub || '') ||
    claims.type !== 'access' ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now()
  )
    return;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.METAMOA_PRESENCE_SALT),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(claims.sub));
  const visitor = Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, '0')).join(
    '',
  );
  await env.METAMOA_PRESENCE.get(env.METAMOA_PRESENCE.idFromName('web')).fetch(
    'https://presence/seen',
    {
      method: 'POST',
      body: visitor,
    },
  );
}

// 외부 라우트가 없는 Durable Object. 서로 다른 탭·서버의 같은 계정도 한 사람으로 센다.
export class MetamoaPresence {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, seen INTEGER NOT NULL)',
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS visitors_seen ON visitors(seen)');
  }
  async fetch(request) {
    const now = Date.now();
    this.sql.exec('DELETE FROM visitors WHERE seen <= ?', now - WINDOW_MS);
    const path = new URL(request.url).pathname;
    if (path === '/seen' && request.method === 'POST') {
      const id = await request.text();
      if (!/^[0-9a-f]{64}$/.test(id)) return new Response(null, { status: 400 });
      this.sql.exec(
        'INSERT INTO visitors(id,seen) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen',
        id,
        now,
      );
      return new Response(null, { status: 204 });
    }
    if (path === '/count' && request.method === 'GET') {
      return json({ count: this.sql.exec('SELECT COUNT(*) AS count FROM visitors').one().count });
    }
    if (path === '/sync' && request.method === 'POST') {
      // cron 재전달·동시 호출 때도 외부 API의 9분 간격을 지킨다.
      return this.ctx.blockConcurrencyWhile(async () => {
        if (!this.env.METAMOA_KEY || !SAFE_ID.test(this.env.METAMOA_SPACE_ID || ''))
          return json({ enabled: false });
        const last = await this.ctx.storage.get('last_attempt');
        if (last && now - last < 9 * 60_000) return json({ skipped: true });
        const count = this.sql.exec('SELECT COUNT(*) AS count FROM visitors').one().count;
        if (count > 100000) return json({ error: 'count_out_of_range' }, 503);
        await this.ctx.storage.put('last_attempt', now);
        let response;
        try {
          response = await metamoaFetch(this.env, `/live/${this.env.METAMOA_SPACE_ID}`, 'POST', {
            count,
          });
        } catch {
          await this.ctx.storage.put('last_sync', { at: now, count, status: 0 });
          return json({ error: 'sync_transport_failed' }, 502);
        }
        await this.ctx.storage.put('last_sync', { at: now, count, status: response.status });
        return json(
          { ok: response.status === 204, status: response.status, count },
          response.status === 204 ? 200 : 502,
        );
      });
    }
    if (path === '/status')
      return json({ last_sync: (await this.ctx.storage.get('last_sync')) || null });
    return new Response(null, { status: 404 });
  }
}

export function scheduledMetamoa(_controller, env, ctx) {
  if (!env.METAMOA_PRESENCE) return;
  ctx.waitUntil(
    env.METAMOA_PRESENCE.get(env.METAMOA_PRESENCE.idFromName('web'))
      .fetch('https://presence/sync', { method: 'POST' })
      .then((response) => {
        if (!response.ok) throw new Error(`Metamoa sync: HTTP ${response.status}`);
      }),
  );
}

async function metamoaFetch(env, path, method = 'GET', body, requestKey = false) {
  return fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${requestKey ? env.METAMOA_REQUEST_KEY : env.METAMOA_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
}

async function sameSecret(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all(
    [a, b].map((v) => crypto.subtle.digest('SHA-256', encoder.encode(v))),
  );
  const left = new Uint8Array(x),
    right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

// 관리 호출에는 별도의 서버 비밀키가 필요하다. 브라우저 앱에는 키나 관리 UI를 넣지 않는다.
export async function metamoaAdmin(request, env) {
  if (
    !(await sameSecret(
      request.headers.get('Authorization'),
      `Bearer ${env.METAMOA_ADMIN_KEY || ''}`,
    )) ||
    !env.METAMOA_ADMIN_KEY
  )
    return json({ error: 'unauthorized' }, 401);
  const path = new URL(request.url).pathname.replace('/service-api/metamoa/', '');
  if (path === 'status' && request.method === 'GET') {
    if (!env.METAMOA_REQUEST_KEY || !SAFE_ID.test(env.METAMOA_SUBMISSION_ID || ''))
      return json({ submitted: false });
    const response = await metamoaFetch(
      env,
      `/submit/${env.METAMOA_SUBMISSION_ID}`,
      'GET',
      undefined,
      true,
    );
    if (!response.ok) return json({ error: 'status_failed', status: response.status }, 502);
    const data = await response.json();
    return json({
      id: env.METAMOA_SUBMISSION_ID,
      status: data.status,
      space_id:
        data.space_id ||
        data.space?.id ||
        (data.status === 'approved' ? env.METAMOA_SUBMISSION_ID : null),
    });
  }
  if (path === 'sync-status' && request.method === 'GET' && env.METAMOA_PRESENCE)
    return env.METAMOA_PRESENCE.get(env.METAMOA_PRESENCE.idFromName('web')).fetch(
      'https://presence/status',
    );
  if (!env.METAMOA_KEY || !SAFE_ID.test(env.METAMOA_SPACE_ID || ''))
    return json({ error: 'awaiting_owner_verification' }, 409);
  if (path === 'character' && ['GET', 'PUT'].includes(request.method)) {
    let response;
    if (request.method === 'GET') {
      response = await metamoaFetch(env, `/space/${env.METAMOA_SPACE_ID}/character`);
    } else {
      const type = request.headers.get('Content-Type');
      const limit =
        type === 'image/png' ? 1024 * 1024 : type === 'model/gltf-binary' ? 4 * 1024 * 1024 : 0;
      if (!limit || !request.body) return json({ error: 'invalid_character' }, 400);
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return json({ error: 'character_too_large' }, 413);
        }
        chunks.push(value);
      }
      if (!size) return json({ error: 'empty_character' }, 400);
      response = await fetch(`${API}/space/${env.METAMOA_SPACE_ID}/character`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${env.METAMOA_KEY}`, 'Content-Type': type },
        body: new Blob(chunks, { type }),
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    }
    if (!response.ok) return json({ error: 'character_rejected', status: response.status }, 502);
    const data = await response.json();
    return json({ status: data.status, upload_id: data.upload_id || null }, response.status);
  }
  let target, body;
  if (path === 'update' && request.method === 'POST') {
    body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json({ error: 'invalid_update' }, 400);
    if (
      typeof body.text !== 'string' ||
      !body.text.trim() ||
      Array.from(body.text).length > 200 ||
      body.text.split('\n').length > 3
    )
      return json({ error: 'invalid_update' }, 400);
    body = { text: body.text };
    target = `/update/${env.METAMOA_SPACE_ID}`;
  } else if (path === 'events' && ['POST', 'GET'].includes(request.method)) {
    target = `/space/${env.METAMOA_SPACE_ID}/events`;
    if (request.method === 'POST') {
      const value = await request.json().catch(() => null);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return json({ error: 'invalid_event' }, 400);
      body = Object.fromEntries(
        ['title', 'desc', 'starts_at', 'ends_at', 'daily_from', 'daily_to', 'url']
          .filter((k) => value[k] !== undefined)
          .map((k) => [k, value[k]]),
      );
      const iso = (v) =>
        typeof v === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
        Number.isFinite(Date.parse(v));
      const time = (v) => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
      let validUrl = body.url === undefined;
      if (typeof body.url === 'string') {
        try {
          const url = new URL(body.url);
          validUrl =
            url.origin === 'https://try.oneorthree.world' && !url.username && !url.password;
        } catch {
          /* 허용된 공개 웹 주소만 전달한다. */
        }
      }
      if (
        typeof body.title !== 'string' ||
        !body.title.trim() ||
        Array.from(body.title).length > 30 ||
        !iso(body.starts_at) ||
        !iso(body.ends_at) ||
        Date.parse(body.ends_at) <= Date.parse(body.starts_at) ||
        Date.parse(body.ends_at) - Date.parse(body.starts_at) > 31 * 86400000 ||
        (body.desc !== undefined &&
          (typeof body.desc !== 'string' || Array.from(body.desc).length > 40)) ||
        ((body.daily_from !== undefined || body.daily_to !== undefined) &&
          (!time(body.daily_from) || !time(body.daily_to))) ||
        !validUrl
      )
        return json({ error: 'invalid_event' }, 400);
    }
  } else if (/^events\/[1-9][0-9]*$/.test(path) && request.method === 'DELETE') {
    target = `/space/${env.METAMOA_SPACE_ID}/${path}`;
  } else return json({ error: 'not_found' }, 404);
  const response = await metamoaFetch(env, target, request.method, body);
  // 제공자의 응답 원문은 키·개인정보를 포함할 수 있어 통과시키지 않는다.
  if (!response.ok) return json({ error: 'metamoa_rejected', status: response.status }, 502);
  if (response.status === 204) return new Response(null, { status: 204 });
  const data = await response.json();
  if (path === 'events' && request.method === 'GET') {
    if (!Array.isArray(data.events)) return json({ error: 'invalid_event_list' }, 502);
    return json({
      events: data.events
        .filter((event) => event && Number.isSafeInteger(event.id) && event.id > 0)
        .map((event) =>
          Object.fromEntries(
            ['id', 'title', 'starts_at', 'ends_at']
              .filter((key) => event[key] !== undefined)
              .map((key) => [key, event[key]]),
          ),
        ),
    });
  }
  return json(
    { ok: true, id: data.id || data.event?.id || null, status: response.status },
    response.status,
  );
}
