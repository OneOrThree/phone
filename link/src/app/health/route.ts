import { getPool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await getPool().query('SELECT 1 FROM links LIMIT 1');
    return Response.json({ status: 'UP' });
  } catch { return Response.json({ status: 'DOWN' }, { status: 503 }); }
}
