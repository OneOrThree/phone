import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { GroupCardDeck } from './GroupCardDeck';

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
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  const deck = screen.getByTestId('group.cardDeck');
  expect(deck.props.onScrollEndDrag).toEqual(expect.any(Function));
  expect(deck.props.onMomentumScrollEnd).toEqual(expect.any(Function));
});
