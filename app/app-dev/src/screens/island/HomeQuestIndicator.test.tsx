import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { claimableQuestRewardCount, HomeQuestIndicator } from './HomeQuestIndicator';
import type { Quest, Reward } from '@/services/model';

const quest = (overrides: Partial<Quest> = {}): Quest => ({
  id: 'q1',
  title: '아침 집중',
  type: 'focus',
  target: 25,
  windowStart: '07:00',
  windowEnd: '09:00',
  claimed: false,
  ...overrides,
});

test('퀘스트 1개는 제목과 실제 조건만 한 장에 보여준다', async () => {
  const screen = await render(
    <HomeQuestIndicator quests={[quest()]} rewardCount={0} onPress={jest.fn()} />,
  );

  expect(screen.getByText('아침 집중')).toBeTruthy();
  expect(screen.getByText('07:00–09:00 · 25분')).toBeTruthy();
  expect(screen.queryByTestId('home-quest-note-back-near')).toBeNull();
});

test('퀘스트 여러 개는 앞 퀘스트와 남은 개수, 겹친 쪽지를 보여준다', async () => {
  const screen = await render(
    <HomeQuestIndicator
      quests={[quest(), quest({ id: 'q2' }), quest({ id: 'q3' })]}
      rewardCount={0}
      onPress={jest.fn()}
    />,
  );

  expect(screen.getByText('외 2개 보기')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByTestId('home-quest-note-back-near')).toBeTruthy();
  expect(screen.getByTestId('home-quest-note-back-far')).toBeTruthy();
});

test('받을 보상이 있으면 퀘스트 요약보다 보상 받기를 우선한다', async () => {
  const onPress = jest.fn();
  const screen = await render(
    <HomeQuestIndicator
      quests={[quest(), quest({ id: 'q2' })]}
      rewardCount={2}
      onPress={onPress}
    />,
  );

  expect(screen.getByText('완료한 퀘스트 2개')).toBeTruthy();
  expect(screen.getByText('보상 받기')).toBeTruthy();
  expect(screen.getByText('눌러서 받을 보상 보기')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: '받을 퀘스트 보상 2개. 보상 받기' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('퀘스트도 받을 보상도 없으면 표시하지 않는다', async () => {
  const screen = await render(
    <HomeQuestIndicator quests={[]} rewardCount={0} onPress={jest.fn()} />,
  );
  expect(screen.toJSON()).toBeNull();
});

test('보상 개수는 현재 섬의 미수령 개인 보상만 센다', () => {
  const rewards: Reward[] = [
    {
      id: 'personal-open',
      islandId: 'island-a',
      questId: 'q1',
      day: '2026-09-22',
      amount: 10,
      kind: 'personal',
      acknowledged: false,
    },
    {
      id: 'bonus-open',
      islandId: 'island-a',
      questId: 'q1',
      day: '2026-09-22',
      amount: 5,
      kind: 'bonus',
      acknowledged: false,
    },
    {
      id: 'personal-claimed',
      islandId: 'island-a',
      questId: 'q2',
      day: '2026-09-21',
      amount: 10,
      kind: 'personal',
      acknowledged: true,
    },
    {
      id: 'other-island',
      islandId: 'island-b',
      questId: 'q3',
      day: '2026-09-22',
      amount: 10,
      kind: 'personal',
      acknowledged: false,
    },
  ];

  expect(claimableQuestRewardCount(rewards, 'island-a')).toBe(1);
});
