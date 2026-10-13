// 망원경 → 도착 기록이 실제 HTTP 요청에서 `Idempotency-Key` 헤더를 싣는지(화면 → API 배선).
// 다른 망원경 테스트와 달리 API 모듈을 목으로 바꾸지 않는다 — fetch 만 스텁해 나가는 요청을 그대로 본다.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Telescope } from '@/screens/island/Telescope';
import { clearSession, saveSession } from '@/services/api/session';
import { initialState, reducer } from '@/services/model';

jest.mock('@/screens/world/WorldViews', () => ({
  Sailing: ({ destination }: any) => {
    const { Text } = require('react-native');
    return <Text testID="sailing">{destination}</Text>;
  },
}));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    compact: false,
    landscape: false,
    tablet: false,
    contentWidth: 402,
    gutter: 20,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];
const arrivals = () => calls.filter((c) => new URL(c.url).pathname.endsWith('/arrivals'));

const wireItem = (id: string) => ({
  islandId: id,
  name: `섬 ${id}`,
  intro: '',
  memberCount: 3,
  maxMembers: 15,
  approvalRequired: false,
  membershipStatus: 'none',
  slot: 'random',
  sailingMinutes: 30,
  averageFocusMinutesPerDay: 83,
  full: false,
  arrivedBefore: false,
});

// /me/telescope 는 섬 둘, 도착 기록은 404·404·200 순서로 답한다
function stubFetch() {
  const arrivalReplies = [
    { status: 404, body: { error: { code: 'NOT_FOUND', message: '없어요', retryable: false } } },
    { status: 404, body: { error: { code: 'NOT_FOUND', message: '없어요', retryable: false } } },
    { status: 200, body: { data: { membershipStatus: 'none', currentIslandId: 'a' } } },
  ];
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = new URL(url).pathname.endsWith('/arrivals')
      ? arrivalReplies.shift()!
      : {
          status: 200,
          body: {
            data: {
              bucketStart: '2026-10-12T05:00:00Z',
              nextRefreshMinutes: 30,
              items: [wireItem('r1'), wireItem('r2')],
            },
          },
        };
    return {
      ok: reply.status < 300,
      status: reply.status,
      headers: { get: () => null },
      text: async () => JSON.stringify(reply.body),
    } as unknown as Response;
  });
}

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
  stubFetch();
});

test('도착 기록 요청은 Idempotency-Key 를 싣는다 — 같은 섬 재시도는 같은 키, 다른 섬은 다른 키', async () => {
  const state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [{ id: 'a', name: '섬 a', intro: '', memberCount: 1, maxMembers: 15 }],
      currentIslandId: 'a',
      nextCursor: null,
      lossReason: null,
    },
  } as any);
  const e = {
    state,
    dispatch: jest.fn(),
    reset: jest.fn(),
    replace: jest.fn(),
    go: jest.fn(),
    back: jest.fn(),
    home: jest.fn(),
    notify: jest.fn(),
    backOverride: { current: null },
    islands: { visit: jest.fn().mockResolvedValue(undefined), sync: jest.fn() },
  };
  const screen = await render(<Telescope e={e} />);
  const sail = async (id: string) => {
    await fireEvent.press(await screen.findByTestId(`telescope-island-${id}`));
    await fireEvent.press(screen.getByLabelText('항해하기'));
    await act(async () => {});
  };
  await sail('r1'); // 404
  await sail('r1'); // 404 — 같은 키로 다시
  await sail('r2'); // 200 — 다른 섬
  await screen.findByTestId('sailing');

  const sent = arrivals();
  expect(sent).toHaveLength(3);
  expect(sent.map((c) => new URL(c.url).pathname)).toEqual([
    '/islands/r1/arrivals',
    '/islands/r1/arrivals',
    '/islands/r2/arrivals',
  ]);
  expect(sent.every((c) => c.init.method === 'POST' && c.init.body === undefined)).toBe(true);
  const keys = sent.map((c) => header(c, 'Idempotency-Key'));
  expect(keys[0]).toMatch(UUID_V4);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).toMatch(UUID_V4);
  expect(keys[2]).not.toBe(keys[0]);
});
