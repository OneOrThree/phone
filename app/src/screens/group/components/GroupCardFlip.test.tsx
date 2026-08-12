import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { useMotion } from '@/hooks/useMotion';
import {
  GROUP_CARD_FLIP_SAFE_INSET,
  GroupCardFlip,
  nextGroupCardRotationTurn,
} from './GroupCardFlip';

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

test('카드 크기는 유지하고 더 큰 상위 stage 중앙에서 회전해 투영 여백을 확보한다', async () => {
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
  const surfaceStyle = () =>
    StyleSheet.flatten(screen.getByTestId('group.card.flipSurface.g1').props.style);

  expect(shellStyle()).toMatchObject({
    height: 520 + GROUP_CARD_FLIP_SAFE_INSET * 2,
    position: 'relative',
    justifyContent: 'center',
  });
  expect(surfaceStyle()).toMatchObject({ height: 520, position: 'relative', width: '100%' });
  expect(shellStyle().overflow).toBeUndefined();
  expect(surfaceStyle().overflow).toBeUndefined();
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

  // 전환 중에도 카드 자체를 clip하지 않고 stage가 위아래 투영 공간을 소유한다.
  expect(shellStyle().overflow).toBeUndefined();
  expect(surfaceStyle().overflow).toBeUndefined();
  expect(surfaceStyle().height).toBe(520);
  expect(shellStyle().width).toBeUndefined();
  expect(shellStyle().transform).toBeUndefined();

  await act(async () => jest.advanceTimersByTime(290));

  expect(shellStyle().overflow).toBeUndefined();
  expect(surfaceStyle().height).toBe(520);
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

test('앞뒤 어느 전환에서도 rotateY 차수는 증가해 같은 방향으로 회전한다', () => {
  const backTurn = nextGroupCardRotationTurn(0);
  const frontTurn = nextGroupCardRotationTurn(backTurn);

  expect(backTurn).toBe(1);
  expect(frontTurn).toBe(2);
  expect([0, backTurn, frontTurn].map((turn) => turn * 180)).toEqual([0, 180, 360]);
});
