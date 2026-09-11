import { clientIp } from '@/lib/auth';
import { fail, object, respond } from '@/lib/errors';
import { match } from '@/lib/links';
import { hashIp } from '@/lib/public-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return respond(async () => {
    const body = object(await request.json().catch(() => fail(400, 'INVALID_JSON')));
    return match({ os: body.os, deviceId: body.deviceId, appInstanceId: body.appInstanceId,
      ipHash: hashIp(clientIp(request.headers)) });
  });
}
