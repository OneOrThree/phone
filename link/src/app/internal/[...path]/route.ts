import { ingestEvent } from '@/lib/events';
import { authorize, capability } from '@/lib/auth';
import { fail, object, respond, text, uuid } from '@/lib/errors';
import { claim, confirm, findLink, issue, joined, match, revoke, updateSnapshot, withdraw } from '@/lib/links';
import { importBatch, verifyMigration } from '@/lib/migration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  return respond(async () => {
    const auth = authorize(request);
    const path = new URL(request.url).pathname.split('/').filter(Boolean).slice(1);
    if (request.method === 'GET' && path[0] === 'links' && path.length === 2) {
      const link = await findLink(path[1]!);
      if (!link || link.status !== 'ACTIVE' || link.group_closed) fail(404, 'SLUG_NOT_FOUND');
      return { slug: link.slug, groupId: link.group_id, inviterId: link.inviter_id, capability: capability(link) };
    }
    const body = object(await request.json().catch(() => fail(400, 'INVALID_JSON')));
    if (path.join('/') === 'events') return ingestEvent(body);
    if (path.join('/') === 'links/match') return match(body);
    if (path.join('/') === 'migration/import') return importBatch(body);
    if (path.join('/') === 'migration/verify') return verifyMigration(text(body.migrationId, 100));
    if (path.join('/') === 'migration/close') return verifyMigration(text(body.migrationId, 100), true);
    const key = text(request.headers.get('idempotency-key'), 200);
    if (path.join('/') === 'links') {
      if (auth.caller === 'business' && !auth.userId) fail(401, 'USER_REQUIRED');
      return issue(body, key, auth.userId);
    }
    if (path.join('/') === 'links/revoke') return revoke(body, key);
    if (path[0] === 'links' && path[2] === 'claim') {
      if (!auth.userId) fail(401, 'USER_REQUIRED');
      return claim(path[1]!, auth.userId, key);
    }
    if (path[0] === 'links' && path[2] === 'joined') return joined(path[1]!, body, key);
    if (path[0] === 'links' && path[1] === 'claims' && path[3] === 'confirm') return confirm(uuid(path[2]), body, key);
    if (path[0] === 'users' && path[2] === 'withdraw') return withdraw(uuid(path[1]), body, key);
    if ((path[0] === 'groups' || path[0] === 'users') && path[2] === 'snapshot') return updateSnapshot(path[0], uuid(path[1]), body, key);
    if (path[0] === 'groups' && path[2] === 'close') return updateSnapshot('groups', uuid(path[1]), body, key, true);
    fail(404, 'ROUTE_NOT_FOUND');
  });
}

export const GET = handle;
export const POST = handle;
