import assert from 'node:assert/strict';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import {
  GoldenFishOccurrenceTracker,
  useGoldenFishLedger,
} from '@/screens/focus/useGoldenFishLedger';
import type { GoldenFishEvent } from '@/services/islandRealtime';
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
  resolveMembers,
  pollMs = 1_000,
  recoveryVersion = 0,
}: any) {
  useGoldenFishLedger({
    active,
    islandId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionStartedAt,
    sessionEligibleUntil,
    membersAt: resolveMembers ?? (() => members),
    onGoldenFish,
    clockOffsetMs,
    recoveryVersion,
    pollMs,
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
  assert.equal(onGoldenFish.mock.calls[0][0].sharePerMember, 0);
  assert.deepEqual(onGoldenFish.mock.calls[0][0].members, [defaultMembers[0]]);
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

test('realtime 재연결 세대가 바뀌면 다음 타이머를 기다리지 않고 즉시 복구 조회한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue(emptyPage());
  const screen = await render(<Harness recoveryVersion={1} onGoldenFish={onGoldenFish} />);
  await act(async () => {});
  assert.equal(ledgerMock.mock.calls.length, 1);

  await screen.rerender(<Harness recoveryVersion={2} onGoldenFish={onGoldenFish} />);
  await act(async () => {});
  assert.equal(ledgerMock.mock.calls.length, 2);
  await screen.unmount();
});

test('조회와 커밋이 겹쳐 늦게 보인 원장 행을 look-back 구간에서 복구한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValueOnce(emptyPage()).mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'late-commit',
        direction: 'earn',
        reason: 'golden_fish',
        amount: 50,
        createdAt: '2026-09-28T00:00:09.500Z',
        groupedUntil: '2026-09-28T00:00:09.500Z',
        entryCount: 1,
      },
    ],
  });
  const screen = await render(<Harness onGoldenFish={onGoldenFish} />);
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(1_000));

  assert.equal(onGoldenFish.mock.calls.length, 1);
  assert.equal(onGoldenFish.mock.calls[0][0].eventId, 'ledger:late-commit');
  await screen.unmount();
});

test('정상 연결 중 원장 복구 조회는 짧은 주기로 반복하지 않는다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue(emptyPage());

  function DefaultPollHarness() {
    useGoldenFishLedger({
      active: true,
      islandId: '11111111-1111-4111-8111-111111111111',
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sessionStartedAt: Date.parse('2026-09-28T00:00:00Z'),
      membersAt: () => defaultMembers,
      onGoldenFish,
    });
    return <View />;
  }

  const screen = await render(<DefaultPollHarness />);
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(4_000));
  assert.equal(ledgerMock.mock.calls.length, 1);
  await act(async () => jest.advanceTimersByTime(56_000));
  assert.equal(ledgerMock.mock.calls.length, 2);
  await screen.unmount();
});

test('확정할 수 있는 참여자가 없으면 golden_fish 원장 행을 화면 사건으로 만들지 않는다', async () => {
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
  const screen = await render(<Harness members={[]} onGoldenFish={onGoldenFish} />);
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

test('자기 세션 참여 여부를 확정할 수 없는 행은 다음 복구 조회까지 보존한다', async () => {
  const onGoldenFish = jest.fn();
  let known = false;
  ledgerMock.mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'before-snapshot',
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
    <Harness resolveMembers={() => (known ? defaultMembers : null)} onGoldenFish={onGoldenFish} />,
  );
  await act(async () => {});
  assert.equal(onGoldenFish.mock.calls.length, 0);

  known = true;
  await act(async () => jest.advanceTimersByTime(1_000));
  assert.equal(onGoldenFish.mock.calls.length, 1);
  await screen.unmount();
});

test('재접속 전 당첨은 당시 집중 중이던 자기 세션만 확정해도 복구한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue({
    ...emptyPage(),
    items: [
      {
        id: 'before-reconnect',
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
    <Harness resolveMembers={() => [defaultMembers[0]]} onGoldenFish={onGoldenFish} />,
  );
  await act(async () => {});

  assert.equal(onGoldenFish.mock.calls.length, 1);
  assert.deepEqual(onGoldenFish.mock.calls[0][0].members, [defaultMembers[0]]);
  assert.equal(onGoldenFish.mock.calls[0][0].sharePerMember, 0);
  await screen.unmount();
});

test('realtime 추첨 분과 다음 분에 기록된 원장 행을 같은 발생으로 짝짓는다', () => {
  const tracker = new GoldenFishOccurrenceTracker();
  const signal = (eventId: string, drawnAt: string): GoldenFishEvent => ({
    eventId,
    islandId: 'island',
    drawnAt,
    reward: 50,
    sharePerMember: 25,
    members: defaultMembers,
  });

  assert.equal(
    tracker.accept(signal('golden:island:1', '2026-09-28T00:00:00Z'), 'session').display,
    true,
  );
  assert.equal(
    tracker.accept(signal('ledger:wallet-1', '2026-09-28T00:01:05Z'), 'session').display,
    false,
  );
  assert.equal(
    tracker.accept(signal('golden:island:2', '2026-09-28T00:01:00Z'), 'session').display,
    true,
  );
  assert.equal(
    tracker.accept(signal('ledger:wallet-2', '2026-09-28T00:01:21Z'), 'session').display,
    false,
  );
});

test('원장이 먼저 도착하면 뒤따른 realtime의 추가 참여자만 병합한다', () => {
  const tracker = new GoldenFishOccurrenceTracker();
  const ledger: GoldenFishEvent = {
    eventId: 'ledger:wallet-1',
    islandId: 'island',
    drawnAt: '2026-09-28T00:00:05Z',
    reward: 50,
    sharePerMember: 0,
    members: [defaultMembers[0]],
  };
  const realtime: GoldenFishEvent = {
    ...ledger,
    eventId: 'golden:island:1',
    drawnAt: '2026-09-28T00:00:00Z',
    sharePerMember: 25,
    members: defaultMembers,
  };

  assert.equal(tracker.accept(ledger, 'session').display, true);
  const merged = tracker.accept(realtime, 'session');
  assert.equal(merged.display, false);
  assert.deepEqual(merged.additionalMembers, [defaultMembers[1]]);
});

test('첫 페이지에 황금 물고기가 없어도 nextCursor를 따라 끝까지 조회한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock
    .mockResolvedValueOnce({
      ...emptyPage(),
      items: [
        {
          id: 'newer-contribution',
          direction: 'earn',
          reason: 'contribution',
          amount: 1,
          createdAt: '2026-09-28T00:00:08Z',
          groupedUntil: '2026-09-28T00:00:08Z',
          entryCount: 1,
        },
      ],
      nextCursor: 'page-2',
    })
    .mockResolvedValueOnce({
      ...emptyPage(),
      items: [
        {
          id: 'golden-page-2',
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

  assert.equal(ledgerMock.mock.calls.length, 2);
  assert.equal(ledgerMock.mock.calls[1][1].cursor, 'page-2');
  assert.equal(onGoldenFish.mock.calls[0][0].eventId, 'ledger:golden-page-2');
  await screen.unmount();
});
