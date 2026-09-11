import { login, sudo, cookieFrom, readSession, csrfToken, assertOrigin, sessionCookie } from '@/lib/console-auth';
import { fail, object, respond, text } from '@/lib/errors';
import { getPool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let cookie: string | undefined;
  const response = await respond(async () => {
    const body = object(await request.json());
    if (body.action === 'sudo') return sudo(request, text(body.password, 1024));
    cookie = await login(request, text(body.password, 1024));
    const session = await readSession(cookie);
    return { actor: session.actor, csrfToken: csrfToken(session.id) };
  });
  if (cookie) response.headers.set('Set-Cookie', `${sessionCookie}=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return response;
}

export async function GET(request: Request) {
  return respond(async () => {
    const session = await readSession(cookieFrom(request));
    return { actor: session.actor, sudo: session.sudo, csrfToken: csrfToken(session.id) };
  });
}

export async function DELETE(request: Request) {
  const response = await respond(async () => {
    assertOrigin(request);
    const session = await readSession(cookieFrom(request));
    if (request.headers.get('x-csrf-token') !== csrfToken(session.id)) fail(403, 'CSRF_TOKEN_MISMATCH');
    await getPool().query('UPDATE console_sessions SET revoked_at=now() WHERE id=$1', [session.id]);
    return { loggedOut: true };
  });
  if (response.ok) response.headers.set('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return response;
}
