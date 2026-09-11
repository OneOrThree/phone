import { getPool } from '@/lib/db/pool';
import { missingTables } from '@/lib/db/required-tables';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const missing = await missingTables(getPool());
    // 어떤 테이블이 없는지는 응답에 싣지 않는다 — readiness 는 상세를 노출하지 않는다.
    if (missing.length) throw new Error(`필수 테이블 누락: ${missing.join(', ')}`);
    return Response.json({ status: 'UP' });
  } catch (cause) {
    console.error('[health] readiness 실패', cause);
    return Response.json({ status: 'DOWN' }, { status: 503 });
  }
}
