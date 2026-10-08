import { request } from './client';
import type { ScreenTimeObservation } from '../screenTimeWindow';

export function putScreenTime(
  observation: ScreenTimeObservation,
  deviceId: string,
  idempotencyKey: string,
  generation: number,
): Promise<unknown> {
  const { date, ...body } = observation;
  return request(`/me/screen-time/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: { ...body, timezone: 'UTC', deviceId },
    idempotencyKey,
    generation,
  });
}

/** sid는 기기 식별 계약이며 토큰의 서명·소유권 검증은 서버가 담당한다. */
export function screenTimeDeviceId(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sid === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sid)
      ? payload.sid
      : null;
  } catch {
    return null;
  }
}
