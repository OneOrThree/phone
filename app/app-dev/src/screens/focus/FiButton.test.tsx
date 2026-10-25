import React from 'react';
import { Animated, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { act, cleanup, fireEvent, render, userEvent } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { FiButton } from './FishingIsland';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  const timing = Animated.timing;
  // Jest에는 네이티브 애니메이터가 없으므로 같은 진행을 JS 드라이버로 관찰한다.
  jest
    .spyOn(Animated, 'timing')
    .mockImplementation((value, config) => timing(value, { ...config, useNativeDriver: false }));
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const mount = (haptics = true) => {
  const finish = jest.fn();
  return {
    finish,
    ui: (
      <FiButton
        title="집중 종료하기"
        id="finish"
        holdToConfirm
        haptics={haptics}
        onPress={finish}
      />
    ),
  };
};

test('짧은 탭과 1.5초 전 해제는 종료하지 않고 1.5초 연속 누름만 한 번 종료한다', async () => {
  const { finish, ui } = mount();
  const screen = await render(ui);
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const button = screen.getByTestId('finish');
  await user.press(button);
  expect(finish).not.toHaveBeenCalled();
  await user.longPress(button, { duration: 1499 });
  expect(finish).not.toHaveBeenCalled();
  await user.longPress(button, { duration: 1500 });
  expect(finish).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(5000));
  expect(finish).toHaveBeenCalledTimes(1);
});

test('누르는 동안 왼쪽부터 차오르고 약한 햅틱이 반복되며 해제하면 모두 멈춘다', async () => {
  const { finish, ui } = mount();
  const screen = await render(ui);
  const button = screen.getByTestId('finish');
  await fireEvent(button, 'pressIn');
  await act(() => jest.advanceTimersByTime(750));
  const style = StyleSheet.flatten(screen.getByTestId('finish-progress').props.style);
  expect(style.left).toBe(0);
  expect(style.right).toBe(0);
  expect(style.transformOrigin).toBe('left center');
  const scale = (style.transform as any)[0].scaleX;
  const progress = typeof scale === 'number' ? scale : scale.__getValue();
  expect(progress).toBeGreaterThan(0.4);
  expect(progress).toBeLessThan(0.6);
  expect(Animated.timing).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ duration: 1500, useNativeDriver: true }),
  );
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  expect(jest.mocked(Haptics.impactAsync).mock.calls.length).toBeGreaterThan(5);
  await fireEvent(button, 'pressOut');
  const calls = jest.mocked(Haptics.impactAsync).mock.calls.length;
  await act(() => jest.advanceTimersByTime(4000));
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(calls);
  expect(finish).not.toHaveBeenCalled();
});

test('앱이 비활성화되면 늦게 도착한 longPress도 종료하지 않는다', async () => {
  let changed: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => {
    changed = fn;
    return { remove: jest.fn() };
  });
  const { finish, ui } = mount();
  const screen = await render(ui);
  const button = screen.getByTestId('finish');
  await fireEvent(button, 'pressIn');
  await act(() => changed?.('inactive'));
  await fireEvent(button, 'longPress');
  expect(finish).not.toHaveBeenCalled();
  const calls = jest.mocked(Haptics.impactAsync).mock.calls.length;
  await act(() => jest.advanceTimersByTime(4000));
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(calls);
});

test('진동을 껐으면 1.5초 길게 눌러도 진동 없이 종료한다', async () => {
  const { finish, ui } = mount(false);
  const screen = await render(ui);
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.longPress(screen.getByTestId('finish'), { duration: 1500 });
  expect(finish).toHaveBeenCalledTimes(1);
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});

test('누르던 버튼이 사라지면 진동을 중단한다', async () => {
  const { ui } = mount();
  const screen = await render(ui);
  await fireEvent(screen.getByTestId('finish'), 'pressIn');
  await screen.unmount();
  const calls = jest.mocked(Haptics.impactAsync).mock.calls.length;
  await act(() => jest.advanceTimersByTime(4000));
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(calls);
});

test('native longPress 이벤트가 없어도 누름과 화면 갱신을 유지하면 정확히 1.5초 후 한 번 종료한다', async () => {
  const finish = jest.fn(),
    latestFinish = jest.fn();
  const props = { title: '집중 종료하기', id: 'finish', holdToConfirm: true, haptics: false };
  const screen = await render(<FiButton {...props} onPress={finish} />);
  await fireEvent(screen.getByTestId('finish'), 'pressIn');
  await act(() => jest.advanceTimersByTime(750));
  await screen.rerender(<FiButton {...props} onPress={latestFinish} />);
  await act(() => jest.advanceTimersByTime(749));
  expect(finish).not.toHaveBeenCalled();
  expect(latestFinish).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(1));
  expect(finish).not.toHaveBeenCalled();
  expect(latestFinish).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(5000));
  expect(latestFinish).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test('버튼 밖으로 나갔다 돌아오면 이전 누름 시간은 합산하지 않는다', async () => {
  const { finish, ui } = mount(false);
  const screen = await render(ui);
  const button = screen.getByTestId('finish');
  await fireEvent(button, 'pressIn');
  await act(() => jest.advanceTimersByTime(1000));
  await fireEvent(button, 'pressOut');
  await fireEvent(button, 'pressIn');
  await act(() => jest.advanceTimersByTime(1499));
  expect(finish).not.toHaveBeenCalled();
  await act(() => jest.advanceTimersByTime(1));
  expect(finish).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

test.each(['accessibilityTap', 'accessibilityAction'])(
  '%s 활성화도 1.5초를 기다리고 터치 해제 이벤트에 취소되지 않는다',
  async (event) => {
    const { finish, ui } = mount(false);
    const screen = await render(ui);
    const button = screen.getByTestId('finish');
    await fireEvent(button, event, { nativeEvent: { actionName: 'activate' } });
    expect(screen.getByLabelText('집중 종료 취소')).toBeTruthy();
    await fireEvent(button, 'pressIn');
    await fireEvent(button, 'pressOut');
    await act(() => jest.advanceTimersByTime(1499));
    expect(finish).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(finish).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(5000));
    expect(finish).toHaveBeenCalledTimes(1);
  },
);

test.each(['accessibilityTap', 'accessibilityAction'])(
  '%s로 다시 활성화하면 종료 대기를 취소하고 기존 집중을 유지한다',
  async (event) => {
    const { finish, ui } = mount(false);
    const screen = await render(ui);
    const button = screen.getByTestId('finish');
    const action = { nativeEvent: { actionName: 'activate' } };
    await fireEvent(button, event, action);
    await act(() => jest.advanceTimersByTime(750));
    await fireEvent(button, event, action);
    expect(screen.getByLabelText('집중 종료하기')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(5000));
    expect(finish).not.toHaveBeenCalled();
  },
);

test('스크린리더 종료 대기도 앱 비활성화에서 취소한다', async () => {
  let changed: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, fn) => {
    changed = fn;
    return { remove: jest.fn() };
  });
  const { finish, ui } = mount(false);
  const screen = await render(ui);
  await fireEvent(screen.getByTestId('finish'), 'accessibilityTap');
  await act(() => jest.advanceTimersByTime(750));
  await act(() => changed?.('inactive'));
  expect(screen.getByLabelText('집중 종료하기')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(5000));
  expect(finish).not.toHaveBeenCalled();
});
