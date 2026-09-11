import { readFileSync, readdirSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { authorize } from '../src/lib/auth';
import { csrfToken, login, readSession, sudo } from '../src/lib/console-auth';
import { getPool } from '../src/lib/db/pool';
import { missingTables, requiredTables } from '../src/lib/db/required-tables';
import { GET as health } from '../src/app/health/route';
import { ConsoleRequestError, IdempotencyKeyring, outcomeSettled } from '../src/lib/console-idempotency';

const origin = 'https://links.example.test';
// 다른 테스트 파일과 같은 IP 를 쓰면 실패 카운터가 섞인다 — 이 파일 전용 IP 를 쓴다.
const ip = '198.51.100.7';

function internal(method: string, path: string, token: string) {
  return new Request(`${origin}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
}

describe('Data 서비스 토큰은 링크를 발급할 수 없다', () => {
  it('Data 토큰의 POST /internal/links 는 403 이다', () => {
    let thrown: unknown;
    try { authorize(internal('POST', '/internal/links', 'fixture-data')); } catch (cause) { thrown = cause; }
    expect(thrown).toMatchObject({ status: 403, code: 'SERVICE_ROUTE_FORBIDDEN' });
  });

  it('Business 토큰의 발급과 Data 토큰의 relay 경로는 그대로 열려 있다', () => {
    expect(authorize(internal('POST', '/internal/links', 'fixture-business')).caller).toBe('business');
    expect(authorize(internal('POST', '/internal/events', 'fixture-data')).caller).toBe('data');
    expect(authorize(internal('POST', '/internal/links/revoke', 'fixture-data')).caller).toBe('data');
  });
});

describe('health 는 필수 테이블 전체를 확인한다', () => {
  it('requiredTables 가 migration 이 만드는 모든 테이블을 덮는다', () => {
    const created = readdirSync('migrations').filter(name => name.endsWith('.sql')).flatMap(name =>
      [...readFileSync(`migrations/${name}`, 'utf8').matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/gi)]
        .map(match => match[1]!));
    expect(created.length).toBeGreaterThan(0);
    expect([...new Set(created)].sort()).toEqual([...requiredTables].sort());
  });

  it('migration 이 끝난 DB 에서는 누락이 없고 UP 을 반환한다', async () => {
    expect(await missingTables(getPool())).toEqual([]);
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'UP' });
  });

  it('후속 migration 이 빠진 상태를 503 으로 잡고, 복구되면 200 으로 돌아온다', async () => {
    const pool = getPool();
    // 0003 이 적용되지 않은 부분 migration 상태를 그대로 재현한다 — 콘솔 로그인이 즉시 깨지는 상태다.
    await pool.query('ALTER TABLE console_sessions RENAME TO console_sessions_not_migrated');
    try {
      expect(await missingTables(pool)).toEqual(['console_sessions']);
      const down = await health();
      expect(down.status).toBe(503);
      // 어떤 테이블이 없는지는 응답에 싣지 않는다.
      expect(await down.json()).toEqual({ status: 'DOWN' });
    } finally {
      // 뒤 테스트들이 같은 DB 를 쓴다 — 실패해도 반드시 되돌린다.
      await pool.query('ALTER TABLE console_sessions_not_migrated RENAME TO console_sessions');
    }
    expect(await missingTables(pool)).toEqual([]);
    const up = await health();
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ status: 'UP' });
  });
});

describe('콘솔 로그인과 sudo 의 실패 횟수는 분리된다', () => {
  beforeAll(async () => {
    process.env.CONSOLE_SESSION_KEY = 'fixture-session-key';
    const hash = (password: string) => {
      const salt = Buffer.alloc(16, 11);
      return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
    };
    for (const slot of [1, 2, 3]) process.env[`CONSOLE_PASSWORD_${slot}_HASH`] = hash(`member-${slot}`);
    process.env.CONSOLE_SUDO_HASH = hash('write-password');
    await getPool().query('DELETE FROM console_login_attempts');
  });

  function request(cookie?: string, csrf?: string) {
    return new Request(`${origin}/console/session`, { method: 'POST', headers: { origin,
      'x-link-proxy-secret': 'fixture-proxy', 'x-link-client-ip': ip,
      cookie: cookie ? `gromo_console=${cookie}` : '', 'x-csrf-token': csrf ?? '' } });
  }

  it('일반 로그인 성공이 sudo 실패 기록을 지우지 않는다', async () => {
    const cookie = await login(request(), 'member-1');
    const csrf = csrfToken((await readSession(cookie)).id);

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(sudo(request(cookie, csrf), 'wrong')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    }
    // 자기 계정 비밀번호를 아는 사용자가 실패 기록을 지우려고 정상 로그인을 끼워 넣는다.
    await login(request(), 'member-1');
    await expect(sudo(request(cookie, csrf), 'wrong')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    await expect(sudo(request(cookie, csrf), 'wrong')).rejects.toMatchObject({ code: 'CONSOLE_LOGIN_LOCKED' });
    // 올바른 sudo 비밀번호도 잠금 중에는 통과하지 못한다.
    await expect(sudo(request(cookie, csrf), 'write-password')).rejects.toMatchObject({ code: 'CONSOLE_LOGIN_LOCKED' });

    // 반대 방향도 성립한다 — sudo 잠금이 일반 로그인을 막지 않는다.
    expect(await login(request(), 'member-2')).toBeTruthy();
    await getPool().query('DELETE FROM console_login_attempts');
  });
});

describe('콘솔 쓰기의 멱등 키는 결과가 확정될 때까지 보존된다', () => {
  const operation = { resource: 'deliveries', environment: 'prod', id: 'delivery-1', action: 'resend' };
  let minted = 0;
  const keyring = () => new IdempotencyKeyring(() => `key-${++minted}`);

  it('응답이 유실된 재시도는 같은 키를 다시 쓴다', async () => {
    const ring = keyring();
    const used: string[] = [];
    const attempt = (fail: boolean) => ring.run(operation, async key => {
      used.push(key);
      if (fail) throw new ConsoleRequestError('서버에 닿지 못했습니다.', null);
      return 'ok';
    });
    await expect(attempt(true)).rejects.toBeInstanceOf(ConsoleRequestError);
    await expect(attempt(true)).rejects.toBeInstanceOf(ConsoleRequestError);
    expect(ring.retained(operation)).toBe(true);
    await expect(attempt(false)).resolves.toBe('ok');
    expect(new Set(used).size).toBe(1);
    expect(used).toHaveLength(3);
  });

  it('확정된 뒤의 새 작업은 새 키를 받는다', async () => {
    const ring = keyring();
    const used: string[] = [];
    const send = () => ring.run(operation, async key => { used.push(key); return 'ok'; });
    await send();
    expect(ring.retained(operation)).toBe(false);
    await send();
    expect(new Set(used).size).toBe(2);
  });

  it('서버가 평가하고 거절한 실패는 키를 버린다', async () => {
    const ring = keyring();
    await expect(ring.run(operation, async () => { throw new ConsoleRequestError('잘못된 요청', 400); }))
      .rejects.toBeInstanceOf(ConsoleRequestError);
    expect(ring.retained(operation)).toBe(false);
  });

  it('작업이 다르면 키도 다르다', async () => {
    const ring = keyring();
    const used: string[] = [];
    const record = async (key: string) => { used.push(key); throw new ConsoleRequestError('유실', null); };
    await expect(ring.run(operation, record)).rejects.toBeInstanceOf(ConsoleRequestError);
    await expect(ring.run({ ...operation, action: 'test' }, record)).rejects.toBeInstanceOf(ConsoleRequestError);
    await expect(ring.run({ ...operation, environment: 'dev' }, record)).rejects.toBeInstanceOf(ConsoleRequestError);
    expect(new Set(used).size).toBe(3);
  });

  it('처리 여부를 알 수 없는 응답만 재시도 대상으로 본다', () => {
    expect([null, 500, 502, 503, 504, 408, 425, 429].map(outcomeSettled)).toEqual(Array(8).fill(false));
    expect([200, 400, 401, 403, 404, 409, 422].map(outcomeSettled)).toEqual(Array(7).fill(true));
  });
});
