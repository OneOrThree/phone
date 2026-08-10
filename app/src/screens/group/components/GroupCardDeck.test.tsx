import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { GroupCardDeck, resolveDeckIndex } from './GroupCardDeck';

function group(index: number): GroupSummaryResponse {
  return {
    groupId: `group-${index}`,
    name: `그룹 ${index}`,
    code: null,
    currentMembers: 1,
    maxMembers: 5,
    role: 'MEMBER',
    status: 'WAITING',
  };
}

test('서버 data에 찾기 카드를 섞지 않고 가로 snap 덱으로 렌더한다', async () => {
  const groups = Array.from({ length: 11 }, (_, index) => group(index));
  const onFind = jest.fn();
  await render(
    <GroupCardDeck
      groups={groups}
      activeGroupId="group-0"
      onFind={onFind}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  const deck = screen.getByTestId('group.cardDeck');
  expect(deck.props.data).toEqual(groups);
  expect(deck.props.horizontal).toBe(true);
  expect(deck.props.disableIntervalMomentum).toBe(true);
  expect(screen.getAllByTestId('group.deck.findMore')).toHaveLength(1);
  fireEvent.press(screen.getByTestId('group.deck.findMore'));
  expect(onFind).toHaveBeenCalledTimes(1);
});

test('drag 종료와 momentum 종료가 모두 active card 확정 경로를 가진다', async () => {
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  const deck = screen.getByTestId('group.cardDeck');
  expect(deck.props.onScrollEndDrag).toEqual(expect.any(Function));
  expect(deck.props.onMomentumScrollEnd).toEqual(expect.any(Function));

  await act(async () => {
    fireEvent(deck, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
  });
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('2 / 3');
});

test('실측 폭에 따라 dots를 표시하고 찾기 페이지까지 선택한다', async () => {
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  await act(async () => {
    fireEvent(screen.getByTestId('group.cardDeck.indicator'), 'layout', {
      nativeEvent: { layout: { width: 400 } },
    });
  });
  const findDot = screen.getByTestId('group.cardDeck.indicator.dot.2');
  expect(findDot.props.accessibilityLabel).toBe('그룹 찾기, 3 / 3');
  await act(async () => {
    fireEvent.press(findDot);
  });
  expect(findDot.props.accessibilityState).toEqual({ selected: true });
});

test('dots 폭은 좌우 20pt gutter를 제외한 가용 폭으로 판정한다', async () => {
  await render(
    <GroupCardDeck
      groups={Array.from({ length: 7 }, (_, index) => group(index))}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  await act(async () => {
    fireEvent(screen.getByTestId('group.cardDeck.indicator'), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
  });

  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('1 / 8');
});

test('활성 그룹이 삭제되면 마지막 카드가 아니라 직전 위치를 새 범위로 clamp한다', () => {
  const remaining = [group(0), group(2), group(3)];

  expect(resolveDeckIndex(remaining, 'group-1', 1)).toBe(1);
  expect(resolveDeckIndex(remaining, 'group-3', 3)).toBe(2);
  expect(resolveDeckIndex(remaining, null, 1)).toBe(remaining.length);
});

test('부모가 전달한 stable groupId를 초기 페이지와 후속 복원의 기준으로 쓴다', async () => {
  const groups = [group(0), group(1), group(2)];
  const view = await render(
    <GroupCardDeck
      groups={groups}
      activeGroupId="group-1"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('2 / 4');

  await view.rerender(
    <GroupCardDeck
      groups={groups}
      activeGroupId="group-2"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('3 / 4');
});
