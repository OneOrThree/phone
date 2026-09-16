import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Pressable, StyleSheet, Text } from 'react-native';
import type { GroupSummaryResponse } from '@/types/dto/group';
import { GroupCardDeck, resolveDeckIndex, resolveDotFocusKey } from './GroupCardDeck';

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
  expect(
    screen.getAllByTestId('group.deck.findMore', { includeHiddenElements: true }),
  ).toHaveLength(1);
  expect(
    screen.getByTestId('group.cardDeck.findMorePage', { includeHiddenElements: true }).props
      .pointerEvents,
  ).toBe('none');
  expect(
    screen.getByTestId('group.deck.findMore', { includeHiddenElements: true }).props.focusable,
  ).toBe(false);
  await act(async () => {
    fireEvent(deck, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 100_000 } } });
  });
  fireEvent.press(screen.getByTestId('group.deck.findMore', { includeHiddenElements: true }));
  expect(onFind).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('group.deck.findMore').props.focusable).toBe(true);
});

test('후반 그룹이 초기 활성 카드면 첫 렌더 배치를 그 index에서 시작한다', async () => {
  const groups = Array.from({ length: 12 }, (_, index) => group(index));
  await render(
    <GroupCardDeck
      groups={groups}
      activeGroupId="group-10"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  expect(screen.getByTestId('group.cardDeck').props.initialScrollIndex).toBe(10);
});

test('활성 카드 control이 위치를 이름에 병합하도록 position과 pageCount를 전달한다', async () => {
  const renderCard = jest.fn((item: GroupSummaryResponse, position: number, pageCount: number) => (
    <Text accessibilityLabel={`${item.name}, 현재 ${position}/${pageCount} 페이지`}>
      {item.name}
    </Text>
  ));
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={renderCard}
    />,
  );

  expect(renderCard).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 'group-0' }),
    1,
    3,
    true,
  );
  expect(renderCard).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: 'group-1' }),
    2,
    3,
    false,
  );
  expect(screen.getByLabelText('그룹 0, 현재 1/3 페이지')).toBeOnTheScreen();
});

test('momentum은 최종 종료에서, momentum 없는 drag는 target offset에서만 확정한다', async () => {
  jest.useFakeTimers();
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
    fireEvent(deck, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 160 } } });
  });
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('1 / 3');

  await act(async () => {
    fireEvent(deck, 'scrollEndDrag', {
      nativeEvent: { contentOffset: { x: 160 }, targetContentOffset: { x: 400 } },
    });
    await jest.runOnlyPendingTimersAsync();
  });
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('2 / 3');

  await act(async () => {
    fireEvent(deck, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 0 } } });
  });
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('1 / 3');
  jest.useRealTimers();
});

test('momentum이 시작되면 drag fallback을 취소하고 실제 종료 위치에서만 확정한다', async () => {
  jest.useFakeTimers();
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  const deck = screen.getByTestId('group.cardDeck');
  await act(async () => {
    fireEvent(deck, 'scrollEndDrag', {
      nativeEvent: { contentOffset: { x: 120 }, targetContentOffset: { x: 400 } },
    });
    fireEvent(deck, 'momentumScrollBegin', { nativeEvent: { contentOffset: { x: 120 } } });
    await jest.runOnlyPendingTimersAsync();
  });
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('1 / 3');

  await act(async () => {
    fireEvent(deck, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
  });
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('2 / 3');
  jest.useRealTimers();
});

test('Android 비관성 drag는 targetContentOffset 없이 현재 offset으로 확정한다', async () => {
  jest.useFakeTimers();
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  const deck = screen.getByTestId('group.cardDeck');
  await act(async () => {
    fireEvent(deck, 'scrollBeginDrag', { nativeEvent: { contentOffset: { x: 0 } } });
    fireEvent(deck, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 400 } } });
    await jest.runOnlyPendingTimersAsync();
  });

  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('2 / 3');
  jest.useRealTimers();
});

test('실측 폭에 따라 dots를 표시하고 찾기 페이지까지 선택한다', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
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
  expect(findDot.props.accessibilityLabel).toBe('그룹 찾기, 3 / 3 페이지로 이동');
  await act(async () => {
    fireEvent.press(findDot);
  });
  expect(findDot.props.accessibilityState).toEqual({ selected: true });
  expect(announce).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent(screen.getByTestId('group.cardDeck'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 100_000 } },
    });
  });
  expect(announce).toHaveBeenCalledWith('그룹 찾기, 3 / 3 페이지');
  announce.mockRestore();
});

test('현재 페이지 외 카드와 끝 카드는 접근성 트리에서 숨긴다', async () => {
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text testID={`body.${item.groupId}`}>{item.name}</Text>}
    />,
  );

  expect(screen.getByText('그룹 0')).toBeOnTheScreen();
  expect(screen.queryByText('그룹 1')).toBeNull();
  expect(screen.queryByTestId('group.deck.findMore')).toBeNull();
  expect(screen.getByText('그룹 1', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(
    screen.getByTestId('group.deck.findMore', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(
    screen.getByLabelText('그룹 찾기, 현재 3/3 페이지', { includeHiddenElements: true }),
  ).toBeOnTheScreen();
  expect(screen.getByTestId('group.cardDeck.pageBody.group-0').props.pointerEvents).toBe('auto');
  expect(
    screen.getByTestId('group.cardDeck.pageBody.group-1', { includeHiddenElements: true }).props
      .pointerEvents,
  ).toBe('none');
  expect(
    screen.getByTestId('group.cardDeck.findMorePage', { includeHiddenElements: true }).props
      .pointerEvents,
  ).toBe('none');
});

test('비활성 카드의 D-pad control과 peek overlay를 focusable 대상에서 제외한다', async () => {
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item, _position, _pageCount, active) => (
        <Pressable testID={`control.${item.groupId}`} focusable={active} />
      )}
    />,
  );

  expect(screen.getByTestId('control.group-0').props.focusable).toBe(true);
  expect(
    screen.getByTestId('control.group-1', { includeHiddenElements: true }).props.focusable,
  ).toBe(false);
  expect(
    screen.getByTestId('group.cardDeck.peek.group-1', { includeHiddenElements: true }).props
      .focusable,
  ).toBe(false);
});

test('compact indicator는 텍스트 확대 시 고정 높이로 잘리지 않는다', async () => {
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  const indicatorStyle = StyleSheet.flatten(
    screen.getByTestId('group.cardDeck.indicator').props.style,
  );
  const counterStyle = StyleSheet.flatten(
    screen.getByTestId('group.cardDeck.indicator.counter').props.style,
  );
  expect(indicatorStyle.height).toBeUndefined();
  expect(indicatorStyle.minHeight).toBe(44);
  expect(counterStyle).toEqual(expect.objectContaining({ minHeight: 44, paddingVertical: 8 }));
});

test('비활성 peek 탭은 내부 카드 입력 대신 페이지 선택과 peek 콜백을 한 번 실행한다', async () => {
  const onPeekPress = jest.fn();
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      onPeekPress={onPeekPress}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  await act(async () => {
    fireEvent.press(
      screen.getByTestId('group.cardDeck.peek.group-1', { includeHiddenElements: true }),
    );
  });

  expect(onPeekPress).not.toHaveBeenCalled();
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('1 / 3');
  await act(async () => {
    fireEvent(screen.getByTestId('group.cardDeck'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 400 } },
    });
  });
  expect(onPeekPress).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1' }));
  expect(screen.getByTestId('group.cardDeck.indicator.counter')).toHaveTextContent('2 / 3');
});

test('스와이프 확정은 새 페이지를 한 번만 능동 안내한다', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  const deck = screen.getByTestId('group.cardDeck');
  await act(async () => {
    fireEvent(deck, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 400 } } });
    fireEvent(deck, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
  });

  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith('그룹 1, 2 / 3 페이지');
  announce.mockRestore();
});

test('포커스된 인디케이터가 counter에서 dots로 바뀐 때 현재 페이지로 포커스를 잇는다', async () => {
  await render(
    <GroupCardDeck
      groups={[group(0), group(1)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );
  await act(async () => {
    screen.getByTestId('group.cardDeck.indicator.counter').props.onFocus();
  });
  await act(async () => {
    fireEvent(screen.getByTestId('group.cardDeck.indicator'), 'layout', {
      nativeEvent: { layout: { width: 400 } },
    });
  });

  expect(screen.getByTestId('group.cardDeck.indicator.dot.0').props.onFocus).toEqual(
    expect.any(Function),
  );
});

test('indicator mode 복원은 이전 비활성 dot 이력보다 현재 페이지를 우선한다', () => {
  const pageKeys = ['group-0', 'group-1', 'find-more'];

  expect(resolveDotFocusKey(pageKeys, 0, 'group-1', true)).toBe('group-0');
  expect(resolveDotFocusKey(pageKeys, 0, 'group-1', false)).toBe('group-1');
});

test('목록 재정렬 중 포커스된 dot은 stable groupId key로 같은 native 항목을 유지한다', async () => {
  const groups = [group(0), group(1)];
  const view = await render(
    <GroupCardDeck
      groups={groups}
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
  const groupOneDot = screen.getByTestId('group.cardDeck.indicator.dot.1');
  await act(async () => groupOneDot.props.onFocus());

  await view.rerender(
    <GroupCardDeck
      groups={[group(1), group(0)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text>{item.name}</Text>}
    />,
  );

  expect(screen.getByTestId('group.cardDeck.indicator.dot.0')).toBe(groupOneDot);
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
  expect(screen.getByTestId('group.cardDeck').props.contentOffset.x).toBeGreaterThan(0);

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

test('순서 변경 렌더는 effect 전에 직전 활성 groupId의 새 offset으로 시작한다', async () => {
  const groups = [group(0), group(1), group(2)];
  const view = await render(
    <GroupCardDeck
      groups={groups}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text testID={`body.${item.groupId}`}>{item.name}</Text>}
    />,
  );
  const deck = screen.getByTestId('group.cardDeck');
  await act(async () => {
    fireEvent(deck, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 400 } } });
  });
  const activeCardBody = screen.getByTestId('body.group-1');

  await view.rerender(
    <GroupCardDeck
      groups={[group(1), group(0), group(2)]}
      activeGroupId="group-0"
      onFind={jest.fn()}
      renderCard={(item) => <Text testID={`body.${item.groupId}`}>{item.name}</Text>}
    />,
  );

  expect(screen.getByTestId('group.cardDeck').props.contentOffset.x).toBe(0);
  expect(screen.getByTestId('body.group-1')).toBe(activeCardBody);
});
