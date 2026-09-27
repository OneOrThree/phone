import assert from 'node:assert/strict';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { useGoldenFishLedger } from '@/screens/focus/useGoldenFishLedger';
import { getLedger, type LedgerPage } from '@/services/api/townHall';
import { clearSession, saveSession } from '@/services/api/session';

jest.mock('@/services/api/townHall', () => ({ getLedger: jest.fn() }));

const ledgerMock = getLedger as jest.Mock;
const emptyPage = (): LedgerPage => ({
  month: '2026-09',
  earnedTotal: 0,
  spentTotal: 0,
  items: [],
  nextCursor: null,
});

const defaultMembers = [
  {
    userId: '22222222-2222-4222-8222-222222222222',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
  {
    userId: '33333333-3333-4333-8333-333333333333',
    sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  },
];

function Harness({
  active = true,
  members = defaultMembers,
  onGoldenFish,
  sessionEligibleUntil,
}: any) {
  useGoldenFishLedger({
    active,
    islandId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionStartedAt: Date.parse('2026-09-28T00:00:00Z'),
    sessionEligibleUntil,
    members,
    onGoldenFish,
    pollMs: 1_000,
  });
  return <View />;
}

beforeEach(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-28T00:00:10Z'));
  ledgerMock.mockReset();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

afterEach(() => jest.useRealTimers());

test('집중 시작 뒤 새 golden_fish 원장 행만 컷신 사건으로 바꾸고 중복은 거른다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'old',
        direction: 'earn',
        reason: 'golden_fish',
        amount: 50,
        createdAt: '2026-09-27T23:59:59Z',
        groupedUntil: '2026-09-27T23:59:59Z',
        entryCount: 1,
      },
      {
        id: 'new',
        direction: 'earn',
        reason: 'golden_fish',
        amount: 50,
        createdAt: '2026-09-28T00:00:05Z',
        groupedUntil: '2026-09-28T00:00:05Z',
        entryCount: 1,
      },
    ],
  });
  const screen = await render(<Harness onGoldenFish={onGoldenFish} />);
  await act(async () => {});

  assert.equal(onGoldenFish.mock.calls.length, 1);
  assert.equal(onGoldenFish.mock.calls[0][0].eventId, 'ledger:new');
  assert.equal(onGoldenFish.mock.calls[0][0].sharePerMember, 25);
  await act(async () => jest.advanceTimersByTime(1_000));
  assert.equal(onGoldenFish.mock.calls.length, 1);
  await screen.unmount();
});

test('조회가 실패해도 집중 화면을 막지 않고 다음 poll에서 재시도한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockRejectedValueOnce(new Error('network')).mockResolvedValue(emptyPage());
  const screen = await render(<Harness onGoldenFish={onGoldenFish} />);
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(1_000));
  assert.equal(ledgerMock.mock.calls.length, 2);
  assert.equal(onGoldenFish.mock.calls.length, 0);
  await screen.unmount();
});

test('활성 주민이 둘 미만이면 golden_fish 원장 행을 화면 사건으로 만들지 않는다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'solo',
        direction: 'earn',
        reason: 'golden_fish',
        amount: 50,
        createdAt: '2026-09-28T00:00:05Z',
        groupedUntil: '2026-09-28T00:00:05Z',
        entryCount: 1,
      },
    ],
  });
  const screen = await render(
    <Harness members={[defaultMembers[0]]} onGoldenFish={onGoldenFish} />,
  );
  await act(async () => {});

  assert.equal(onGoldenFish.mock.calls.length, 0);
  await screen.unmount();
});

test('휴식·종료 시점 뒤의 당첨은 해당 세션의 사건으로 잘못 복원하지 않는다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'after-rest',
        direction: 'earn',
        reason: 'golden_fish',
        amount: 50,
        createdAt: '2026-09-28T00:00:09Z',
        groupedUntil: '2026-09-28T00:00:09Z',
        entryCount: 1,
      },
    ],
  });
  const screen = await render(
    <Harness
      sessionEligibleUntil={Date.parse('2026-09-28T00:00:08Z')}
      onGoldenFish={onGoldenFish}
    />,
  );
  await act(async () => {});

  assert.equal(onGoldenFish.mock.calls.length, 0);
  await screen.unmount();
});
