import { act, renderHook } from '@testing-library/react-native';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useFocusShieldSync } from './useScreenTimeSync';
import { initialState } from '@/services/model';
import { syncAndroidFocus } from '@/services/androidScreenTime';
import { screenTimeNative } from '@/services/ScreenTimeModule';

jest.mock('@/services/androidScreenTime', () => ({
  syncAndroidFocus: jest.fn().mockResolvedValue(true),
  syncAndroidMeasurement: jest.fn(),
}));
jest.mock('@/services/api/session', () => ({
  getSession: () => ({ userId: 'owner' }),
  sessionGeneration: () => 1,
}));
jest.mock('@/services/focusShield', () => ({
  syncFocusShield: jest.fn(),
  shouldReportShieldFailure: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  screenTimeNative: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));
const sync = jest.mocked(syncAndroidFocus);
const state = {
  ...initialState(),
  session: {
    id: 'focus',
    islandId: 'island',
    subject: '수학',
    status: 'active' as const,
    startedAt: 0,
    seconds: 0,
    version: 1,
  },
};
const input = {
  loaded: true,
  storageOwnerReady: true,
  hasServerSession: true,
  authGeneration: 1,
  state,
  stateRef: { current: state },
  notify: jest.fn(),
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Platform.OS = 'android';
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([
  { storageOwnerReady: false, hasServerSession: false },
  { storageOwnerReady: false, hasServerSession: true },
  { storageOwnerReady: true, hasServerSession: false },
])('로그아웃·계정 채택 gate %j에서도 이전 임대를 즉시 해제한다', async (next) => {
  const hook = await renderHook((props: typeof input) => useFocusShieldSync(props), {
    initialProps: input,
  });
  sync.mockClear();
  await hook.rerender({ ...input, ...next });
  expect(sync).toHaveBeenCalledWith(null, state.color);
  await hook.unmount();
});

test('백그라운드 재확인 오류 뒤 다음 네이티브 이벤트가 다시 서버 동기화를 요청한다', async () => {
  let background: (state: AppStateStatus) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    background = listener;
    return { remove: jest.fn() };
  });
  const hook = await renderHook(() => useFocusShieldSync(input));
  const listener = jest.mocked(screenTimeNative!.addListener!).mock.calls[0][1];
  await act(async () => background('background'));
  sync.mockClear();
  sync.mockRejectedValueOnce(new Error('OFFLINE'));
  await act(async () => listener());
  await act(async () => listener());
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync.mock.calls[1][0]).toBe(state.session);
  await hook.unmount();
});
