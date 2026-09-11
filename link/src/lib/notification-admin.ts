import { authorizeConsole } from './console-auth';
import { fail } from './errors';
import { required } from './env';

const resources = new Set(['jobs', 'templates', 'deeplinks', 'deliveries']);

export async function notificationAdmin(request: Request, path: string[]) {
  const write = request.method !== 'GET';
  const session = await authorizeConsole(request, write);
  const [resource, id, action] = path;
  if (!resource || !resources.has(resource) || path.length > 3
      || (id && !/^[a-zA-Z0-9_.:-]{1,150}$/.test(id)) || (action && !['preview', 'test', 'resend'].includes(action))) fail(404, 'ADMIN_ROUTE_NOT_FOUND');
  if (!['GET', 'PUT', 'POST'].includes(request.method)) fail(405, 'METHOD_NOT_ALLOWED');
  const query = new URL(request.url).searchParams;
  const env = query.get('environment') ?? 'dev';
  if (!['dev', 'prod'].includes(env)) fail(400, 'INVALID_ENVIRONMENT');
  const origin = new URL(required(`NOTIFICATION_${env.toUpperCase()}_BASE_URL`));
  const target = new URL(`/internal/admin/${path.map(encodeURIComponent).join('/')}`, origin);
  for (const key of ['cursor', 'limit', 'kind', 'locale', 'status', 'userId', 'from', 'to']) {
    if (query.has(key)) target.searchParams.set(key, query.get(key)!);
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${required(`SVC_TOKEN_CONSOLE_TO_NOTI_${env.toUpperCase()}`)}`,
    'X-Console-Actor': session.actor, 'Content-Type': 'application/json' };
  if (write) {
    const key = request.headers.get('idempotency-key');
    if (!key || key.length > 200) fail(400, 'IDEMPOTENCY_KEY_REQUIRED');
    headers['Idempotency-Key'] = key;
  }
  const response = await fetch(target, { method: request.method, headers, body: write ? await request.text() : undefined,
    signal: AbortSignal.timeout(4000), redirect: 'error', cache: 'no-store' });
  // 상류 쿠키·Location·인증 헤더를 브라우저로 전달하지 않는다.
  return new Response(await response.text(), { status: response.status, headers: {
    'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store',
  } });
}
