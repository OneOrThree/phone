import { ApiError } from '@/lib/errors';
import { notificationAdmin } from '@/lib/notification-admin';

export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try { return await notificationAdmin(request, (await context.params).path); }
  catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ code: error instanceof ApiError ? error.code : 'NOTIFICATION_UNAVAILABLE' }, { status });
  }
}
export const GET = handle;
export const PUT = handle;
export const POST = handle;
