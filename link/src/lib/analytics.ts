import { optional } from './env';

export function measurement(stream: 'app' | 'web', client: string, name: string, params: Record<string, unknown>) {
  const app = stream === 'app';
  const id = optional(app ? 'GA4_FIREBASE_APP_ID' : 'GA4_WEB_MEASUREMENT_ID');
  const secret = optional(app ? 'GA4_APP_API_SECRET' : 'GA4_WEB_API_SECRET');
  if (!id || !secret) return null;
  const url = new URL('https://www.google-analytics.com/mp/collect');
  url.searchParams.set(app ? 'firebase_app_id' : 'measurement_id', id);
  url.searchParams.set('api_secret', secret);
  const encoded = Object.fromEntries(Object.entries(params).filter(([, value]) => value != null)
    .map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value]));
  return { url, body: { [app ? 'app_instance_id' : 'client_id']: client,
    events: [{ name, params: { ...encoded, env: optional('DEPLOY_ENV') ?? 'local' } }] } };
}

export async function analytics(stream: 'app' | 'web', client: string, name: string, params: Record<string, unknown>) {
  if (optional('GA4_ENABLED') !== 'true') return;
  const event = measurement(stream, client, name, params);
  if (!event) return;
  try {
    // DB commit 뒤에만 호출한다. 분석 장애가 5초 match 예산을 소모하지 않게 짧게 종료한다.
    await fetch(event.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event.body), signal: AbortSignal.timeout(300), redirect: 'error' });
  } catch { console.error('link_analytics_delivery_failed'); }
}
