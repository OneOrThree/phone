import { scryptSync } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { authorizeConsole, csrfToken, login, readSession, sudo } from '../src/lib/console-auth';
import { getPool } from '../src/lib/db/pool';
import { notificationAdmin } from '../src/lib/notification-admin';
import { createServer, type Server } from 'node:http';

const origin = 'https://links.example.test';
function request(path: string, cookie?: string, csrf?: string) {
  return new Request(`${origin}${path}`, { method: 'POST', headers: { origin,
    'x-link-proxy-secret': 'fixture-proxy', 'x-link-client-ip': '203.0.113.23',
    cookie: cookie ? `gromo_console=${cookie}` : '', 'x-csrf-token': csrf ?? '' } });
}

beforeAll(() => {
  process.env.CONSOLE_SESSION_KEY = 'fixture-session-key';
  const hash = (password: string) => {
    const salt = Buffer.alloc(16, 7);
    return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  };
  for (const slot of [1, 2, 3]) process.env[`CONSOLE_PASSWORD_${slot}_HASH`] = hash(`member-${slot}`);
  process.env.CONSOLE_SUDO_HASH = hash('write-password');
});

it('3개 계정 슬롯을 식별하고 sudo 없는 변경과 CSRF를 거부한다', async () => {
  const cookie = await login(request('/console/session'), 'member-2');
  const session = await readSession(cookie);
  expect(session.actor).toBe('member-2');
  const csrf = csrfToken(session.id);
  await expect(authorizeConsole(request('/console/test', cookie, csrf), true)).rejects.toMatchObject({ code: 'CONSOLE_SUDO_REQUIRED' });
  await sudo(request('/console/session', cookie, csrf), 'write-password');
  expect((await authorizeConsole(request('/console/test', cookie, csrf), true)).sudo).toBe(true);
  await expect(authorizeConsole(request('/console/test', cookie, 'forged'), true)).rejects.toMatchObject({ code: 'CSRF_TOKEN_MISMATCH' });
  await getPool().query("UPDATE console_sessions SET sudo_until=now()-interval '1 second' WHERE id=$1", [session.id]);
  expect((await readSession(cookie)).sudo).toBe(false);
  await getPool().query('UPDATE console_sessions SET revoked_at=now() WHERE id=$1', [session.id]);
  await expect(readSession(cookie)).rejects.toMatchObject({ code: 'CONSOLE_LOGIN_REQUIRED' });
});

it('비밀번호 실패를 DB에 기록하고 다른 Origin과 만료 세션을 거부한다', async () => {
  const other = new Request(`${origin}/console/session`, { method: 'POST', headers: { origin: 'https://attacker.test' } });
  await expect(login(other, 'member-1')).rejects.toMatchObject({ code: 'CSRF_ORIGIN_MISMATCH' });
  const cookie = await login(request('/console/session'), 'member-1');
  const session = await readSession(cookie);
  await getPool().query("UPDATE console_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [session.id]);
  await expect(readSession(cookie)).rejects.toMatchObject({ code: 'CONSOLE_LOGIN_REQUIRED' });
  for (let attempt = 0; attempt < 5; attempt++) await expect(login(request('/console/session'), 'wrong')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
  await expect(login(request('/console/session'), 'member-1')).rejects.toMatchObject({ code: 'CONSOLE_LOGIN_LOCKED' });
  await getPool().query('DELETE FROM console_login_attempts');
});

it('실제 HTTP admin 호출은 선택한 대상의 서비스 토큰과 actor만 전달한다', async () => {
  let received: Record<string, unknown> = {};
  const server: Server = createServer((req, res) => {
    received = { path: req.url, auth: req.headers.authorization, actor: req.headers['x-console-actor'], cookie: req.headers.cookie };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'upstream-secret=hidden');
    res.end(JSON.stringify({ items: [{ id: 'test-job', enabled: true }], nextCursor: null }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('테스트 서버 주소 없음');
  process.env.NOTIFICATION_DEV_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SVC_TOKEN_CONSOLE_TO_NOTI_DEV = 'fixture-console-to-noti';
  try {
    const cookie = await login(request('/console/session'), 'member-3');
    const response = await notificationAdmin(new Request(`${origin}/console/notification/jobs?environment=dev`, { headers: { cookie: `gromo_console=${cookie}` } }), ['jobs']);
    expect(received).toEqual({ path: '/internal/admin/jobs', auth: 'Bearer fixture-console-to-noti', actor: 'member-3', cookie: undefined });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toMatchObject({ items: [{ id: 'test-job' }] });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
