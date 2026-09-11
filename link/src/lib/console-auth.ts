import { createHmac, randomUUID, scrypt as derive } from 'node:crypto';
import { promisify } from 'node:util';
import { getPool, withTransaction } from './db/pool';
import { clientIp, secretEqual } from './auth';
import { required } from './env';
import { fail } from './errors';
import { hashIp } from './public-contract';
import { lock } from './ledger';

const scrypt = promisify(derive);
export const sessionCookie = 'gromo_console';

function signature(value: string): string {
  return createHmac('sha256', required('CONSOLE_SESSION_KEY')).update(value).digest('base64url');
}

export function csrfToken(id: string): string { return signature(`csrf:${id}`); }

export function assertOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(required('LINK_BASE_URL')).origin) fail(403, 'CSRF_ORIGIN_MISMATCH');
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [salt, hash, extra] = encoded.split(':');
  if (extra || !salt || !/^[a-f0-9]{32}$/.test(salt) || !hash || !/^[a-f0-9]{128}$/.test(hash)) {
    throw new Error('콘솔 비밀번호 해시 설정 오류');
  }
  const derived = await scrypt(password, Buffer.from(salt, 'hex'), 64) as Buffer;
  return secretEqual(derived.toString('hex'), hash);
}

/**
 * 실패 횟수를 «시도 종류»별로 따로 센다.
 *
 * <p>로그인과 sudo 가 IP 하나의 행을 공유하면, 자기 계정 비밀번호를 아는 사용자가
 * sudo 를 네 번 찍고 정상 로그인 한 번으로 기록을 지우는 것을 반복할 수 있어
 * 5회 잠금이 sudo 무차별 대입을 전혀 막지 못한다. 그래서 `ip_hash` 키에 scope 를 붙여
 * 두 계열이 서로의 실패를 지우지도, 서로의 잠금을 나누지도 않게 한다.
 */
async function passwordAttempt(request: Request, scope: 'login' | 'sudo', check: () => Promise<number>): Promise<number> {
  const ip = `${scope}:${hashIp(clientIp(request.headers))}`;
  const result = await withTransaction(async tx => {
    await lock(tx, `console-login:${ip}`);
    const prior = (await tx.query('SELECT * FROM console_login_attempts WHERE ip_hash=$1', [ip])).rows[0];
    if (prior?.locked_until && prior.locked_until.getTime() > Date.now()) return { locked: true, slot: 0 };
    const slot = await check();
    if (slot) await tx.query('DELETE FROM console_login_attempts WHERE ip_hash=$1', [ip]);
    else await tx.query(`INSERT INTO console_login_attempts(ip_hash,failures) VALUES($1,1)
      ON CONFLICT(ip_hash) DO UPDATE SET failures=CASE WHEN console_login_attempts.updated_at<now()-interval '15 minutes' THEN 1 ELSE console_login_attempts.failures+1 END,
      locked_until=CASE WHEN console_login_attempts.failures>=4 AND console_login_attempts.updated_at>=now()-interval '15 minutes' THEN now()+interval '15 minutes' ELSE NULL END,updated_at=now()`, [ip]);
    return { locked: false, slot };
  });
  if (result.locked) fail(429, 'CONSOLE_LOGIN_LOCKED');
  if (!result.slot) fail(401, 'INVALID_PASSWORD');
  return result.slot;
}

export async function login(request: Request, password: string): Promise<string> {
  assertOrigin(request);
  const slot = await passwordAttempt(request, 'login', async () => {
    // 각 슬롯을 모두 검사해 계정 슬롯의 순서를 응답 시간으로 노출하지 않는다.
    const matches = await Promise.all([1, 2, 3].map(slot => verifyPassword(password, required(`CONSOLE_PASSWORD_${slot}_HASH`))));
    return matches.findIndex(Boolean) + 1;
  });
  const id = randomUUID();
  await getPool().query("INSERT INTO console_sessions(id,actor_slot,expires_at) VALUES($1,$2,now()+interval '30 days')", [id, slot]);
  return `${id}.${signature(id)}`;
}

export async function readSession(cookie: string | undefined) {
  if (!cookie) fail(401, 'CONSOLE_LOGIN_REQUIRED');
  const [id, sig, extra] = cookie.split('.');
  if (extra || !id || !/^[0-9a-f-]{36}$/.test(id) || !sig || !secretEqual(sig, signature(id))) fail(401, 'CONSOLE_LOGIN_REQUIRED');
  const row = (await getPool().query(`SELECT id,actor_slot,sudo_until FROM console_sessions
    WHERE id=$1 AND expires_at>now() AND revoked_at IS NULL`, [id])).rows[0];
  if (!row) fail(401, 'CONSOLE_LOGIN_REQUIRED');
  return { id: row.id as string, actor: `member-${row.actor_slot}`, sudo: !!row.sudo_until && row.sudo_until.getTime() > Date.now() };
}

export function cookieFrom(request: Request): string | undefined {
  return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}

export async function sudo(request: Request, password: string) {
  const session = await readSession(cookieFrom(request));
  assertOrigin(request);
  if (!secretEqual(request.headers.get('x-csrf-token') ?? '', csrfToken(session.id))) fail(403, 'CSRF_TOKEN_MISMATCH');
  await passwordAttempt(request, 'sudo', async () => await verifyPassword(password, required('CONSOLE_SUDO_HASH')) ? 1 : 0);
  await getPool().query("UPDATE console_sessions SET sudo_until=now()+interval '10 minutes' WHERE id=$1", [session.id]);
  return { sudo: true };
}

export async function authorizeConsole(request: Request, write: boolean) {
  const session = await readSession(cookieFrom(request));
  if (write) {
    assertOrigin(request);
    if (!secretEqual(request.headers.get('x-csrf-token') ?? '', csrfToken(session.id))) fail(403, 'CSRF_TOKEN_MISMATCH');
    if (!session.sudo) fail(403, 'CONSOLE_SUDO_REQUIRED');
  }
  return session;
}
