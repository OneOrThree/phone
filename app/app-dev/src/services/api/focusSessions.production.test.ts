import type { startFocusSession } from './focusSessions';

const previousUrl = process.env.EXPO_PUBLIC_API_URL;
const previousFlag = process.env.EXPO_PUBLIC_FOCUS_SEAT_ENABLED;
const previousFetch = global.fetch;
const PROD = 'https://catus-api-v2.oneorthree.world';
const DEV = 'https://oneorthree.dev.mooo.com';
const input = {
  islandId: '019a2b3c-4d5e-7000-8000-000000000001',
  subject: '수학',
  targetMinutes: 25,
  seat: { x: 34.125, y: 55.875 },
};
const view = {
  id: 'session-1',
  islandId: input.islandId,
  subject: input.subject,
  targetMinutes: input.targetMinutes,
  status: 'active',
  activeSeconds: 0,
  startedAt: '2026-10-29T08:00:00Z',
  serverNow: '2026-10-29T08:00:00Z',
  restStartedAt: null,
  version: 1,
};

async function load(apiUrl: string, flag?: string, supportsSeat = false) {
  jest.resetModules();
  process.env.EXPO_PUBLIC_API_URL = apiUrl;
  if (flag === undefined) delete process.env.EXPO_PUBLIC_FOCUS_SEAT_ENABLED;
  else process.env.EXPO_PUBLIC_FOCUS_SEAT_ENABLED = flag;
  const api = require('./focusSessions') as { startFocusSession: typeof startFocusSession };
  const session = require('./session') as typeof import('./session');
  await session.saveSession({ userId: 'user-1', accessToken: 'AT', refreshToken: 'RT' });
  // 운영 catus-v2.1.0 FocusSessionController의 필드 검사를 재현한다.
  const fetch = jest.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const allowed = ['islandId', 'subject', 'targetMinutes', ...(supportsSeat ? ['seat'] : [])];
    const accepted = Object.keys(body).every((key) => allowed.includes(key));
    return {
      ok: accepted,
      status: accepted ? 201 : 400,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify(
          accepted
            ? { data: view }
            : {
                error: {
                  code: 'INVALID_REQUEST',
                  message: '요청 형식이 올바르지 않습니다.',
                  field: null,
                  retryable: false,
                },
              },
        ),
    } as unknown as Response;
  });
  global.fetch = fetch as typeof global.fetch;
  return { start: api.startFocusSession, fetch };
}

afterEach(() => {
  global.fetch = previousFetch;
  if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = previousUrl;
  if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_FOCUS_SEAT_ENABLED;
  else process.env.EXPO_PUBLIC_FOCUS_SEAT_ENABLED = previousFlag;
});

test('운영 API를 쓰는 개발 빌드도 구 운영 계약으로 한 번에 집중을 시작한다', async () => {
  const h = await load(PROD);
  await expect(h.start(input, 'same-intent-key')).resolves.toEqual(view);
  expect(h.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = h.fetch.mock.calls[0];
  expect(url).toBe(`${PROD}/focus-sessions`);
  expect(JSON.parse(init.body as string)).toEqual({
    islandId: input.islandId,
    subject: input.subject,
    targetMinutes: 25,
  });
  expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('same-intent-key');
  expect(input.seat).toEqual({ x: 34.125, y: 55.875 });
});

test('빈 공개 설정도 운영에서는 seat를 생략한다', async () => {
  const h = await load(PROD, '');
  await expect(h.start(input, 'empty-flag-key')).resolves.toEqual(view);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('목표 없이 시작하는 실제 화면 요청은 운영에 필수 두 필드만 보낸다', async () => {
  const h = await load(PROD);
  await expect(
    h.start(
      { islandId: input.islandId, subject: input.subject, seat: input.seat },
      'no-target-key',
    ),
  ).resolves.toEqual(view);
  expect(JSON.parse(h.fetch.mock.calls[0][1].body as string)).toEqual({
    islandId: input.islandId,
    subject: input.subject,
  });
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('지원 배포 후 운영에서 명시적으로 켜면 선택한 좌표의 소수부를 그대로 보낸다', async () => {
  const h = await load(PROD, '1', true);
  await expect(h.start(input, 'enabled-key')).resolves.toEqual(view);
  expect(JSON.parse(h.fetch.mock.calls[0][1].body as string)).toEqual(input);
});

test('이미 자리 좌표를 지원하는 dev API는 기본 전송한다', async () => {
  const h = await load(DEV, undefined, true);
  await expect(h.start(input, 'dev-key')).resolves.toEqual(view);
  expect(JSON.parse(h.fetch.mock.calls[0][1].body as string)).toEqual(input);
});

test('명시적으로 끄면 dev에서도 구 계약을 사용한다', async () => {
  const h = await load(DEV, '0');
  await expect(h.start(input, 'disabled-key')).resolves.toEqual(view);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('전송 결과가 불명확한 경우 키나 본문을 바꿔 추가 시작 요청을 보내지 않는다', async () => {
  const h = await load(PROD);
  h.fetch.mockRejectedValueOnce(new Error('connection lost'));
  await expect(h.start(input, 'network-key')).rejects.toMatchObject({
    code: 'CLIENT_NETWORK_ERROR',
  });
  expect(h.fetch).toHaveBeenCalledTimes(1);
});
