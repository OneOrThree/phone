import React from 'react';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
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

test('짧은 탭과 3초 전 해제는 종료하지 않고 3초 연속 누름만 한 번 종료한다', async () => {
  const { finish, ui } = mount();
  const screen = await render(ui);
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const button = screen.getByTestId('finish');
  await user.press(button);
  expect(finish).not.toHaveBeenCalled();
  await user.longPress(button, { duration: 2999 });
  expect(finish).not.toHaveBeenCalled();
  await user.longPress(button, { duration: 3000 });
  expect(finish).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(5000));
  expect(finish).toHaveBeenCalledTimes(1);
});

test('누르는 동안 왼쪽부터 차오르고 약한 햅틱이 반복되며 해제하면 모두 멈춘다', async () => {
  const { finish, ui } = mount();
  const screen = await render(ui);
  const button = screen.getByTestId('finish');
  await fireEvent(button, 'pressIn');
  await act(() => jest.advanceTimersByTime(1500));
  const style = StyleSheet.flatten(screen.getByTestId('finish-progress').props.style);
  expect(style.left).toBe(0);
  const width = typeof style.width === 'object' ? (style.width as any).__getValue() : style.width;
  expect(parseFloat(width)).toBeGreaterThan(40);
  expect(parseFloat(width)).toBeLessThan(60);
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

test('진동을 껐으면 3초 길게 눌러도 진동 없이 종료한다', async () => {
  const { finish, ui } = mount(false);
  const screen = await render(ui);
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await user.longPress(screen.getByTestId('finish'), { duration: 3000 });
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
