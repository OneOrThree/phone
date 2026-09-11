import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { optional, required } from './env';
import { fail, uuid } from './errors';

export function secretEqual(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clientIp(headers: Headers): string {
  const proxy = headers.get('x-link-proxy-secret');
  let ip: string | null;
  if (proxy !== null) {
    if (!secretEqual(proxy, required('LINK_PROXY_SECRET'))) fail(401, 'INVALID_PROXY');
    // Vercel은 XFF를 재작성한다. 인증된 전용 헤더만 원본 IP로 사용한다.
    ip = headers.get('x-link-client-ip');
  } else if (process.env.VERCEL === '1') {
    ip = headers.get('x-vercel-forwarded-for');
  } else if (process.env.NODE_ENV !== 'production' && optional('LOCAL_CLIENT_IP')) {
    ip = optional('LOCAL_CLIENT_IP')!;
  } else {
    fail(400, 'TRUSTED_CLIENT_IP_REQUIRED');
  }
  if (!ip || !isIP(ip.trim())) fail(400, 'INVALID_CLIENT_IP');
  return ip.trim();
}

const permissions = {
  business: [
    ['POST', /^\/internal\/links$/], ['GET', /^\/internal\/links\/[a-z0-9]{1,12}$/],
    ['POST', /^\/internal\/links\/[a-z0-9]{1,12}\/claim$/],
    ['POST', /^\/internal\/links\/match$/],
  ],
  // Data 는 relay 자격만 가진다. 링크 «발급»은 위임 사용자를 요구하는 Business 전용 경로다 —
  // 여기에 두면 Data 토큰만으로 임의의 groupId·inviterId 링크를 만들 수 있다.
  data: [
    ['POST', /^\/internal\/events$/],
    ['POST', /^\/internal\/links\/revoke$/],
    ['POST', /^\/internal\/links\/[a-z0-9]{1,12}\/joined$/],
    ['POST', /^\/internal\/links\/claims\/[0-9a-f-]{36}\/confirm$/],
    ['POST', /^\/internal\/users\/[0-9a-f-]{36}\/withdraw$/],
    ['POST', /^\/internal\/(groups|users)\/[0-9a-f-]{36}\/snapshot$/],
    ['POST', /^\/internal\/groups\/[0-9a-f-]{36}\/close$/],
  ],
  migration: [['POST', /^\/internal\/migration\/(import|verify|close)$/]],
} as const;

export function authorize(request: Request): { caller: keyof typeof permissions; userId?: string } {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) fail(401, 'INVALID_SERVICE_TOKEN');
  const supplied = authorization.slice(7);
  const keys = { business: 'SVC_TOKEN_BIZ_TO_LINK', data: 'SVC_TOKEN_DATA_TO_LINK', migration: 'LINK_MIGRATION_TOKEN' } as const;
  const caller = (Object.keys(keys) as (keyof typeof keys)[]).find(name => {
    const token = optional(keys[name]);
    return token && secretEqual(supplied, token);
  });
  if (!caller) fail(401, 'INVALID_SERVICE_TOKEN');
  const path = new URL(request.url).pathname;
  if (!permissions[caller].some(([method, pattern]) => method === request.method && pattern.test(path))) fail(403, 'SERVICE_ROUTE_FORBIDDEN');
  const delegated = request.headers.get('x-user-id');
  return { caller, userId: delegated === null ? undefined : uuid(delegated) };
}

export function capability(link: { slug: string; group_id: string; inviter_id: string; link_version: string }, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ slug: link.slug, groupId: link.group_id,
    inviterId: link.inviter_id, membershipEpoch: link.link_version, exp: Math.floor(now / 1000) + 300,
  })).toString('base64url');
  const signature = createHmac('sha256', required('LINK_CAPABILITY_KEY')).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
