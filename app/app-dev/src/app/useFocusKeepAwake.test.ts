import { act, renderHook } from '@testing-library/react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useFocusKeepAwake } from './useFocusKeepAwake';

const activate = jest.mocked(activateKeepAwakeAsync);
const deactivate = jest.mocked(deactivateKeepAwake);
let change: (next: AppStateStatus) => void;
const remove = jest.fn();
const originalAppState = AppState.currentState;
beforeEach(() => {
  jest.clearAllMocks();
  activate.mockResolvedValue(undefined);
  deactivate.mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_name, callback) => {
    change = callback;
    return { remove };
  });
});
afterEach(() => {
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
});

test.each(['ios', 'android'] as const)('%s 집중 중 켜고 휴식·종료에서는 해제한다', async (os) => {
  jest.replaceProperty(Platform, 'OS', os);
  const hook = await renderHook((enabled: boolean) => useFocusKeepAwake(enabled), {
    initialProps: false,
  });
  expect(activate).not.toHaveBeenCalled();
  await hook.rerender(true);
  const tag = activate.mock.calls[0][0];
  await hook.rerender(true);
  expect(activate).toHaveBeenCalledTimes(1);
  await hook.rerender(false);
  expect(deactivate).toHaveBeenCalledWith(tag);
  await hook.rerender(true);
  expect(activate.mock.calls[1][0]).not.toBe(tag);
  await hook.unmount();
  expect(deactivate).toHaveBeenCalledWith(activate.mock.calls[1][0]);
  expect(remove).toHaveBeenCalled();
});

test('앱이 가려지면 해제하고 활성 집중으로 복귀하면 다시 켠다', async () => {
  const hook = await renderHook(() => useFocusKeepAwake(true));
  const tag = activate.mock.calls[0][0];
  await act(async () => change('inactive'));
  expect(deactivate).toHaveBeenCalledWith(tag);
  await act(async () => change('background'));
  expect(activate).toHaveBeenCalledTimes(1);
  await act(async () => change('active'));
  expect(activate).toHaveBeenCalledTimes(2);
  await hook.unmount();
});

test('백그라운드에서 복원된 세션은 전경 진입 뒤에만 화면을 유지한다', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'background',
  });
  const hook = await renderHook(() => useFocusKeepAwake(true));
  expect(activate).not.toHaveBeenCalled();
  await act(async () => change('active'));
  expect(activate).toHaveBeenCalledTimes(1);
  await hook.unmount();
});

test('이전 활성화가 늦게 끝나도 새 집중 태그를 해제하지 않는다', async () => {
  let finish!: () => void;
  activate.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const hook = await renderHook((enabled: boolean) => useFocusKeepAwake(enabled), {
    initialProps: true,
  });
  const first = activate.mock.calls[0][0];
  await hook.rerender(false);
  await hook.rerender(true);
  const second = activate.mock.calls[1][0];
  await act(async () => finish());
  expect(deactivate).toHaveBeenCalledWith(first);
  expect(deactivate).not.toHaveBeenCalledWith(second);
  expect(deactivate).not.toHaveBeenCalledWith('verification-spike');
  await hook.unmount();
});

test('Activity 부재로 실패해도 앱 복귀 때 다시 요청한다', async () => {
  activate.mockRejectedValueOnce(new Error('ACTIVITY_MISSING'));
  const hook = await renderHook(() => useFocusKeepAwake(true));
  await act(async () => change('background'));
  await act(async () => change('active'));
  expect(activate).toHaveBeenCalledTimes(2);
  await hook.unmount();
});
