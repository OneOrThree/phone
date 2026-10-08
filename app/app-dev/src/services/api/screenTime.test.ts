import { putScreenTime, screenTimeDeviceId } from './screenTime';
import { request } from './client';
jest.mock('./client', () => ({ request: jest.fn().mockResolvedValue({}) }));

test('서버 UTC 날짜와 실제 관측 시각을 분리하고 sid·멱등키·인증 세대를 전달한다', async () => {
  await putScreenTime(
    {
      date: '2026-10-08',
      measuredAt: '2026-10-09T01:00:00Z',
      minutes: 75,
      measurementStatus: 'authorized',
    },
    'sid',
    'key',
    7,
  );
  expect(request).toHaveBeenCalledWith('/me/screen-time/2026-10-08', {
    method: 'PUT',
    body: {
      measuredAt: '2026-10-09T01:00:00Z',
      minutes: 75,
      measurementStatus: 'authorized',
      timezone: 'UTC',
      deviceId: 'sid',
    },
    idempotencyKey: 'key',
    generation: 7,
  });
});
test('설치 UUID를 만들지 않고 유효한 토큰 sid만 읽는다', () => {
  const sid = '12345678-1234-4234-8234-123456789abc';
  expect(screenTimeDeviceId(`h.${btoa(JSON.stringify({ sid }))}.s`)).toBe(sid);
  expect(screenTimeDeviceId('invalid')).toBeNull();
  expect(screenTimeDeviceId(`h.${btoa(JSON.stringify({ sub: sid }))}.s`)).toBeNull();
});
