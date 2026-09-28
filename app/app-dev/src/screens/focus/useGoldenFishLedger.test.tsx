import assert from 'node:assert/strict';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { View } from 'react-native';
import { getLedger, type LedgerPage } from '@/services/api/townHall';
import { clearSession, saveSession } from '@/services/api/session';
import { useGoldenFishLedger } from '@/screens/focus/useGoldenFishLedger';

jest.mock('@/services/api/townHall', () => ({ getLedger: jest.fn() }));

const ledgerMock = getLedger as jest.Mock;
const members = [
  { userId: 'me', sessionId: 'session-me' },
  { userId: 'peer', sessionId: 'session-peer' },
];
const page = (createdAt: string): LedgerPage => ({
  month: '2026-09',
  earnedTotal: 50,
  spentTotal: 0,
  items: [
    {
      id: createdAt,
      direction: 'earn',
      reason: 'golden_fish',
      amount: 50,
      createdAt,
      groupedUntil: createdAt,
      entryCount: 1,
    },
  ],
  nextCursor: null,
});

function Harness({
  onGoldenFish,
  active = true,
  sinceMs = Date.parse('2026-09-28T00:00:00Z'),
}: {
  onGoldenFish: jest.Mock;
  active?: boolean;
  sinceMs?: number;
}) {
  useGoldenFishLedger({
    active,
    islandId: 'island',
    sessionId: 'session-me',
    sinceMs,
    members: () => members,
    onGoldenFish,
    pollMs: 5_000,
  });
  return <View />;
}

beforeEach(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-28T00:00:00Z'));
  ledgerMock.mockReset();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

afterEach(() => jest.useRealTimers());

test('마운트 뒤 새로 적립된 원장 행을 현재 ACTIVE 참여자 사건으로 바꾼다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue(page('2026-09-28T00:00:01Z'));
  const screen = await render(<Harness onGoldenFish={onGoldenFish} />);

  await act(async () => jest.advanceTimersByTime(5_000));

  assert.equal(onGoldenFish.mock.calls.length, 1);
  assert.equal(onGoldenFish.mock.calls[0][0].eventId, 'ledger:2026-09-28T00:00:01Z');
  assert.equal(onGoldenFish.mock.calls[0][0].reward, 50);
  assert.equal(onGoldenFish.mock.calls[0][0].sharePerMember, 0);
  assert.deepEqual(Array.from(onGoldenFish.mock.calls[0][0].members), members);
  await screen.unmount();
});

test('재마운트 이전 원장 행은 이미 본 사건으로 간주해 재생하지 않는다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue(page('2026-09-27T23:59:59Z'));
  const screen = await render(<Harness onGoldenFish={onGoldenFish} />);

  await act(async () => jest.advanceTimersByTime(5_000));

  assert.equal(onGoldenFish.mock.calls.length, 0);
  await screen.unmount();
});

test('초기 realtime 스냅숏을 기다리는 동안 생성된 행도 활성화 즉시 복구한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock.mockResolvedValue(page('2026-09-28T00:00:01Z'));
  const screen = await render(<Harness active={false} onGoldenFish={onGoldenFish} />);
  await act(async () => jest.setSystemTime(new Date('2026-09-28T00:00:05Z')));
  await screen.rerender(<Harness active onGoldenFish={onGoldenFish} />);
  await act(async () => {});

  assert.equal(onGoldenFish.mock.calls.length, 1);
  await screen.unmount();
});

test('조회 경계보다 최신 행이 30개를 넘어도 nextCursor를 따라 끝까지 확인한다', async () => {
  const onGoldenFish = jest.fn();
  ledgerMock
    .mockResolvedValueOnce({ ...page('2026-09-28T00:00:04Z'), nextCursor: 'next' })
    .mockResolvedValueOnce(page('2026-09-28T00:00:01Z'));
  const screen = await render(<Harness onGoldenFish={onGoldenFish} />);
  await act(async () => {});

  assert.equal(ledgerMock.mock.calls.length, 2);
  assert.equal(ledgerMock.mock.calls[1][1].cursor, 'next');
  assert.equal(onGoldenFish.mock.calls.length, 2);
  await screen.unmount();
});
