import assert from 'node:assert/strict';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { GoldenFishMemberTimeline, useGoldenFishLedger } from '@/screens/focus/useGoldenFishLedger';
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
  sessionStartedAt = Date.parse('2026-09-28T00:00:00Z'),
  clockOffsetMs = 0,
}: any) {
  useGoldenFishLedger({
    active,
    islandId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionStartedAt,
    sessionEligibleUntil,
    membersAt: () => members,
    onGoldenFish,
    clockOffsetMs,
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

test('단말 시계가 빨라도 서버 시각 보정으로 다음 원장 행을 놓치지 않는다', async () => {
  jest.setSystemTime(new Date('2026-09-28T00:01:10Z'));
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValueOnce(emptyPage()).mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'server-clock',
        direction: 'earn',
        reason: 'golden_fish',
        amount: 50,
        createdAt: '2026-09-28T00:00:10.500Z',
        groupedUntil: '2026-09-28T00:00:10.500Z',
        entryCount: 1,
      },
    ],
  });
  const screen = await render(<Harness clockOffsetMs={-60_000} onGoldenFish={onGoldenFish} />);
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(1_000));

  assert.equal(onGoldenFish.mock.calls.length, 1);
  await screen.unmount();
});

test('KST 월 경계를 넘으면 커서의 직전 달과 현재 달을 모두 조회한다', async () => {
  jest.setSystemTime(new Date('2026-09-30T15:00:01Z'));
  const onGoldenFish = jest.fn();
  ledgerMock.mockImplementation((_islandId: string, query: { month: string }) =>
    Promise.resolve({
      ...emptyPage(),
      month: query.month,
      items:
        query.month === '2026-09'
          ? [
              {
                id: 'month-boundary',
                direction: 'earn',
                reason: 'golden_fish',
                amount: 50,
                createdAt: '2026-09-30T14:59:59.500Z',
                groupedUntil: '2026-09-30T14:59:59.500Z',
                entryCount: 1,
              },
            ]
          : [],
    }),
  );
  const screen = await render(
    <Harness sessionStartedAt={Date.parse('2026-09-30T14:59:59Z')} onGoldenFish={onGoldenFish} />,
  );
  await act(async () => {});

  assert.equal(
    ledgerMock.mock.calls.map((call: any[]) => call[1].month).join(','),
    '2026-09,2026-10',
  );
  assert.equal(onGoldenFish.mock.calls.length, 1);
  await screen.unmount();
});

test('참여자 타임라인은 원장 발생 시각 이후에 바뀐 주민을 과거 당첨에 섞지 않는다', () => {
  const timeline = new GoldenFishMemberTimeline();
  timeline.observe(1_000, defaultMembers);
  timeline.observe(2_000, [defaultMembers[0], { userId: 'new', sessionId: 'new-session' }]);

  assert.deepEqual(timeline.membersAt(1_500), defaultMembers);
  assert.deepEqual(
    timeline.membersAt(2_500).map((member) => member.userId),
    [defaultMembers[0].userId, 'new'].sort(),
  );
});
