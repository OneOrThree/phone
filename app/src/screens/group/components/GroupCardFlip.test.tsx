import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { useMotion } from '@/hooks/useMotion';
import { GroupCardFlip } from './GroupCardFlip';

jest.mock('@/hooks/useMotion', () => ({
  useMotion: jest.fn(() => ({ reduce: false })),
}));

const mockedUseMotion = jest.mocked(useMotion);

beforeEach(() => {
  mockedUseMotion.mockReturnValue({ reduce: false } as ReturnType<typeof useMotion>);
});

test('전환 완료 전 양쪽 입력을 잠그고 완료 뒤 뒷면만 연다', async () => {
  jest.useFakeTimers();
  const onTransitioningChange = jest.fn();
  const onTransitionComplete = jest.fn();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitioningChange={onTransitioningChange}
      onTransitionComplete={onTransitionComplete}
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
      onTransitionComplete={onTransitionComplete}
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
  expect(onTransitionComplete).toHaveBeenCalledTimes(1);
  expect(onTransitionComplete).toHaveBeenCalledWith('back', 'g1');
  jest.useRealTimers();
});

test('3D 전환 중에만 원래 카드 rect로 투영된 face를 잘라 헤더 침범을 막는다', async () => {
  jest.useFakeTimers();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
    />,
  );
  const shellStyle = () =>
    StyleSheet.flatten(screen.getByTestId('group.card.flipShell.g1').props.style);

  expect(shellStyle()).toMatchObject({ minHeight: 520, position: 'relative' });
  expect(shellStyle().overflow).toBeUndefined();
  expect(shellStyle().transform).toBeUndefined();

  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
    />,
  );

  expect(shellStyle()).toMatchObject({
    minHeight: 520,
    position: 'relative',
    borderRadius: 28,
    overflow: 'hidden',
  });
  // clip은 shell의 rect만 제한하며 덱의 폭·위치·transform 계약은 건드리지 않는다.
  expect(shellStyle().width).toBeUndefined();
  expect(shellStyle().transform).toBeUndefined();

  await act(async () => jest.advanceTimersByTime(290));

  expect(shellStyle().overflow).toBeUndefined();
  expect(shellStyle()).toMatchObject({ minHeight: 520, position: 'relative' });
  jest.useRealTimers();
});

test('스와이프 정리는 전환 잠금 없이 앞면을 즉시 연다', async () => {
  const onTransitioningChange = jest.fn();
  const onTransitionComplete = jest.fn();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitioningChange={onTransitioningChange}
      onTransitionComplete={onTransitionComplete}
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
      onTransitionComplete={onTransitionComplete}
    />,
  );

  expect(screen.getByTestId('group.card.flipFront.g1').props.pointerEvents).toBe('auto');
  expect(onTransitioningChange).not.toHaveBeenCalledWith(true);
  expect(onTransitionComplete).not.toHaveBeenCalled();
});

test('동작 줄이기에서도 짧은 전환이 끝난 뒤 현재 면을 한 번 완료한다', async () => {
  jest.useFakeTimers();
  mockedUseMotion.mockReturnValue({ reduce: true } as ReturnType<typeof useMotion>);
  const onTransitionComplete = jest.fn();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitionComplete={onTransitionComplete}
    />,
  );

  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitionComplete={onTransitionComplete}
    />,
  );
  const shellStyle = StyleSheet.flatten(screen.getByTestId('group.card.flipShell.g1').props.style);
  expect(shellStyle.overflow).toBeUndefined();
  await act(async () => jest.advanceTimersByTime(149));
  expect(onTransitionComplete).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));

  expect(onTransitionComplete).toHaveBeenCalledTimes(1);
  expect(onTransitionComplete).toHaveBeenCalledWith('back', 'g1');
  jest.useRealTimers();
});

test('취소된 이전 세대 완료는 알리지 않고 마지막 면만 정확히 한 번 완료한다', async () => {
  jest.useFakeTimers();
  const onTransitionComplete = jest.fn();
  const view = await render(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitionComplete={onTransitionComplete}
    />,
  );

  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitionComplete={onTransitionComplete}
    />,
  );
  await view.rerender(
    <GroupCardFlip
      groupId="g1"
      minHeight={520}
      flipped={false}
      front={<Text>앞면</Text>}
      back={<Text>뒷면</Text>}
      onTransitionComplete={onTransitionComplete}
    />,
  );

  await act(async () => jest.advanceTimersByTime(290));

  expect(onTransitionComplete).toHaveBeenCalledTimes(1);
  expect(onTransitionComplete).toHaveBeenCalledWith('front', 'g1');
  jest.useRealTimers();
});
