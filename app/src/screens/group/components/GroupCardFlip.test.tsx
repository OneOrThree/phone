import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { GroupCardFlip } from './GroupCardFlip';

test('전환 완료 전 양쪽 입력을 잠그고 완료 뒤 뒷면만 연다', async () => {
  jest.useFakeTimers();
  const onTransitioningChange = jest.fn();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitioningChange={onTransitioningChange}
    />,
  );

  const front = () =>
    screen.getByTestId('group.card.flipFront.g1', { includeHiddenElements: true });
  const back = () => screen.getByTestId('group.card.flipBack.g1', { includeHiddenElements: true });
  expect(screen.getByTestId('group.card.flipShell.g1')).toBeOnTheScreen();
  expect(front().props.pointerEvents).toBe('auto');
  expect(front().props.importantForAccessibility).toBe('auto');
  expect(back().props.pointerEvents).toBe('none');
  expect(back().props.importantForAccessibility).toBe('no-hide-descendants');

  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitioningChange={onTransitioningChange}
    />,
  );

  expect(front().props.pointerEvents).toBe('none');
  expect(front().props.importantForAccessibility).toBe('no-hide-descendants');
  expect(back().props.pointerEvents).toBe('none');
  expect(onTransitioningChange).toHaveBeenCalledWith(true);

  await act(async () => {
    jest.advanceTimersByTime(290);
  });

  expect(back().props.pointerEvents).toBe('auto');
  expect(back().props.importantForAccessibility).toBe('auto');
  expect(onTransitioningChange).toHaveBeenLastCalledWith(false);
  jest.useRealTimers();
});

test('스와이프 정리는 전환 잠금 없이 앞면을 즉시 연다', async () => {
  const onTransitioningChange = jest.fn();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitioningChange={onTransitioningChange}
    />,
  );

  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      skipTransition
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitioningChange={onTransitioningChange}
    />,
  );

  expect(screen.getByTestId('group.card.flipFront.g1').props.pointerEvents).toBe('auto');
  expect(onTransitioningChange).not.toHaveBeenCalledWith(true);
});
