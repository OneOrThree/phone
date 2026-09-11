import { clientIp } from '@/lib/auth';
import { findLink, recordClick } from '@/lib/links';
import { classifyOs, hashIp, isBot, landing } from '@/lib/public-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const link = /^[a-z0-9]{1,12}$/.test(slug) ? await findLink(slug) : undefined;
  const active = link?.status === 'ACTIVE' && !link.group_closed ? link : undefined;
  const ua = request.headers.get('user-agent');
  if (active && !isBot(ua)) {
    let referer = '';
    try { referer = new URL(request.headers.get('referer') ?? '').hostname; } catch { /* 잘못된 URL은 전송하지 않는다. */ }
    try { await recordClick(active, hashIp(clientIp(request.headers)), classifyOs(ua), ua!, referer); }
    catch { console.error('link_click_record_failed'); }
  }
  return new Response(landing(active), { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' } });
}
