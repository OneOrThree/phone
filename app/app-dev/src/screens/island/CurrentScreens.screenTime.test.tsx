import React from 'react';
import { AppState, Linking, Platform, type AppStateStatus } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CurrentScreens } from './CurrentScreens';
import { initialState } from '@/services/model';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { screenTime } from '@/services/screenTime';
import { applyLocalePref } from '@/i18n';

jest.mock('@/services/ScreenTimeModule', () => ({
  screenTimeNative: {
    getAuthorizationStatus: jest.fn(),
    requestAuthorization: jest.fn(),
    getMeasurementSelectionCounts: jest.fn(),
    getAllowedSelectionCounts: jest.fn(),
    getFocusAllowSafariWeb: jest.fn(),
    presentAppPicker: jest.fn(),
    presentAllowedAppManager: jest.fn(),
    canDrawOverlays: jest.fn(),
    getAllowedPackages: jest.fn(),
  },
}));
// 알림 행(GROMO-2526)이 읽는 권한 조회·요청만 관찰한다 — 실제 구현은 push.test.ts 가 고정한다. 기본은 브리지 없는 바이너리(unavailable).
const mockPushPermissionStatus = jest.fn();
const mockRequestPushPermission = jest.fn();
jest.mock('@/services/push', () => ({
  pushPermissionStatus: () => mockPushPermissionStatus(),
  requestPushPermission: () => mockRequestPushPermission(),
}));
jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({
  useBoardHomeIndicator: () => ({ hasNew: false }),
}));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    landscape: false,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./sceneKit', () => ({ ...jest.requireActual('./sceneKit'), useGowun: () => undefined }));

const native = screenTimeNative as jest.Mocked<Required<NonNullable<typeof screenTimeNative>>>;
const selection = (applications: number) => ({ applications, categories: 0, webDomains: 0 });
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  delete (screenTimeNative as NonNullable<typeof screenTimeNative>).supportsFocusShield;
  native.getAuthorizationStatus.mockResolvedValue('denied');
  native.requestAuthorization.mockResolvedValue(false);
  native.getMeasurementSelectionCounts.mockResolvedValue(selection(2));
  native.getAllowedSelectionCounts.mockResolvedValue(selection(1));
  native.getFocusAllowSafariWeb.mockResolvedValue(false);
  native.canDrawOverlays.mockResolvedValue(false);
  native.getAllowedPackages.mockResolvedValue([]);
  mockPushPermissionStatus.mockResolvedValue('unavailable');
  jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(async () => {
  await cleanup();
  applyLocalePref('system');
  jest.restoreAllMocks();
  Platform.OS = originalOS;
});
function environment(detail = '', route = 'permission') {
  return {
    state: initialState(true),
    route,
    detail,
    now: Date.now(),
    dispatch: jest.fn(),
    go: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    home: jest.fn(),
    notify: jest.fn(),
  };
}

test('차단 미지원 Android는 측정 설정만 표시하고 차단 권한을 조회하지 않는다', async () => {
  Platform.OS = 'android';
  native.supportsFocusShield = false;
  native.getAuthorizationStatus.mockResolvedValue('approved');
  const e = environment('settings');
  const view = await render(<CurrentScreens e={e} />);
  await view.findByText('2개 선택됨');
  expect(view.getByRole('switch', { name: '스크린타임 연결' })).toBeTruthy();
  for (const label of ['집중 중 허용', '허용 앱', '다른 앱 위에 표시', '집중 상태 알림']) {
    expect(view.queryByText(label)).toBeNull();
  }
  expect(native.canDrawOverlays).not.toHaveBeenCalled();
  expect(native.getAllowedPackages).not.toHaveBeenCalled();
  expect(native.getAllowedSelectionCounts).not.toHaveBeenCalled();
  expect(native.getFocusAllowSafariWeb).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('측정 앱'));
  expect(e.go).toHaveBeenCalledWith('screenTimeApps', 'settings');
});

test.each(['ios', 'android'] as const)(
  'en 로케일 — 앱 권한 관리(%s)는 한글 없이 영문으로 그린다',
  async (os) => {
    Platform.OS = os;
    applyLocalePref('en');
    native.getAuthorizationStatus.mockResolvedValue('approved');
    const view = await render(<CurrentScreens e={environment('settings')} />);
    await view.findByText('2 selected');
    expect(view.getByText('Manage App Permissions')).toBeTruthy();
    expect(view.getByRole('switch', { name: 'Connect Screen Time' })).toBeTruthy();
    expect(view.getByText('Allowed during focus')).toBeTruthy();
    expect(view.queryByText(/[가-힣]/)).toBeNull();
    expect(view.queryByLabelText(/[가-힣]/)).toBeNull();
  },
);

test.each([
  ['ios', 'denied', 'permission'],
  ['ios', 'notDetermined', 'permission'],
  ['android', 'approved', 'permission'],
  ['ios', 'approved', 'screenTimeApps'],
  ['android', 'approved', 'screenTimeApps'],
] as const)('en 로케일 — %s %s %s 화면은 한글이 없다', async (os, auth, route) => {
  Platform.OS = os;
  applyLocalePref('en');
  native.getAuthorizationStatus.mockResolvedValue(auth);
  const view = await render(<CurrentScreens e={environment('', route)} />);
  await view.findAllByText(route === 'permission' ? 'Measurement permission' : 'Measured apps');
  expect(view.queryByText(/[가-힣]/)).toBeNull();
  expect(view.queryByLabelText(/[가-힣]/)).toBeNull();
});

test('차단 미지원 Android 측정 권한 안내에는 앱 차단 권한을 요구하지 않는다', async () => {
  Platform.OS = 'android';
  native.supportsFocusShield = false;
  const view = await render(<CurrentScreens e={environment()} />);
  await view.findByText('선택한 앱의 사용 시간만 기록해요.');
  expect(view.queryByText(/집중 중 앱 차단/)).toBeNull();
});

test('거절 화면에서 재요청해 승인되면 측정 앱 선택으로 이동한다', async () => {
  const e = environment('measured-apps');
  const view = await render(<CurrentScreens e={e} />);
  await view.findByText('권한 다시 요청하기');
  if (e.detail === 'settings') {
    expect(view.queryByText('시스템 설정')).toBeNull();
    expect(view.queryByText('측정 권한')).toBeNull();
    expect(view.getByText('스크린타임 연결')).toBeTruthy();
  }
  native.requestAuthorization.mockImplementationOnce(async () => {
    native.getAuthorizationStatus.mockResolvedValue('approved');
    return true;
  });
  await fireEvent.press(view.getByText('권한 다시 요청하기'));
  await waitFor(() => expect(e.replace).toHaveBeenCalledWith('screenTimeApps', 'settings-auto'));
  expect(native.requestAuthorization).toHaveBeenCalledTimes(1);
  expect(Linking.openSettings).not.toHaveBeenCalled();
});

test('요청 취소 후 notDetermined가 유지돼도 재시도 안내를 표시한다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('notDetermined');
  const e = environment();
  const view = await render(<CurrentScreens e={e} />);
  await fireEvent.press(await view.findByText('스크린타임 연결하기'));
  await view.findByText('권한 다시 요청하기');
  expect(view.getByText('허용 창이 안 뜨면 시스템 설정에서 허용해 주세요.')).toBeTruthy();
  expect(e.back).not.toHaveBeenCalled();
  expect(e.dispatch).not.toHaveBeenCalledWith({ type: 'SETTING', key: 'permission', value: true });
});

test('시스템 설정 열기 실패를 안내하고 재시도 경로를 유지한다', async () => {
  jest.mocked(Linking.openSettings).mockRejectedValueOnce(new Error('unavailable'));
  const e = environment();
  const view = await render(<CurrentScreens e={e} />);
  await fireEvent.press(await view.findByText('시스템 설정 열기'));
  await waitFor(() =>
    expect(e.notify).toHaveBeenCalledWith(expect.stringContaining('설정을 열지 못했어요')),
  );
  expect(view.getByText('권한 다시 요청하기')).toBeTruthy();
});

test('뗏목 권한 관리에서 재요청하고 승인 후 측정 앱과 허용 앱을 모두 연다', async () => {
  const e = environment('settings');
  const view = await render(<CurrentScreens e={e} />);
  await waitFor(() =>
    expect(
      view.getByRole('switch', { name: '스크린타임 연결' }).props.accessibilityState.disabled,
    ).toBe(false),
  );
  if (e.detail === 'settings') {
    expect(view.queryByText('시스템 설정')).toBeNull();
    expect(view.queryByText('측정 권한')).toBeNull();
    expect(view.getByText('스크린타임 연결')).toBeTruthy();
  }
  native.requestAuthorization.mockImplementationOnce(async () => {
    native.getAuthorizationStatus.mockResolvedValue('approved');
    return true;
  });
  native.presentAllowedAppManager.mockResolvedValue(selection(3));
  await fireEvent.press(view.getByRole('switch', { name: '스크린타임 연결' }));
  await waitFor(() => expect(e.go).toHaveBeenCalledWith('screenTimeApps', 'settings-auto'));
  expect(view.queryByText('권한 다시 요청하기')).toBeNull();
  await fireEvent.press(view.getByText('측정 앱'));
  expect(e.go).toHaveBeenCalledWith('screenTimeApps', 'settings');
  await fireEvent.press(view.getByText('허용 앱'));
  await waitFor(() => expect(native.presentAllowedAppManager).toHaveBeenCalledTimes(1));
  expect(view.getByText('3개 선택됨')).toBeTruthy();
});

test('설정에는 예약 선택을 표시하고 측정 소비자에는 현재 선택을 유지한다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('approved');
  native.getMeasurementSelectionCounts.mockResolvedValue({
    ...selection(2),
    pendingSelection: { ...selection(5), pending: true },
  });
  const view = await render(<CurrentScreens e={environment('settings')} />);
  await view.findByText('5개 선택됨 · 내일부터 적용');
  expect((await screenTime.getMeasurementSelectionCounts())?.applications).toBe(2);
});

test('측정 앱 진입은 설명 화면 없이 피커를 열고 저장 뒤 돌아간다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('approved');
  native.getMeasurementSelectionCounts.mockResolvedValue({
    ...selection(2),
    pendingSelection: { ...selection(5), pending: true },
  });
  native.presentAppPicker.mockResolvedValue({
    ...selection(4),
    pending: true,
    appliesImmediately: false,
  });
  const e = environment('settings', 'screenTimeApps');
  const view = await render(<CurrentScreens e={e} />);
  expect(view.queryByText('줄이고 싶은 앱을 골라주세요')).toBeNull();
  expect(view.queryByText('저장한 측정 대상')).toBeNull();
  expect(view.queryByLabelText('스크린타임 서버 전송 동의')).toBeNull();
  await waitFor(() => expect(e.back).toHaveBeenCalledTimes(1));
  expect(e.notify).toHaveBeenCalledWith('측정 앱 4개를 내일부터 적용해요.');
});

test('시스템 설정에서 승인하고 복귀하면 권한 상태와 다음 화면을 갱신한다', async () => {
  let onActive: ((state: AppStateStatus) => void) | undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onActive = listener;
    return { remove: jest.fn() };
  });
  const e = environment('board-first|board|');
  const view = await render(<CurrentScreens e={e} />);
  await view.findByText('권한 다시 요청하기');
  native.getAuthorizationStatus.mockResolvedValue('approved');
  await act(async () => onActive?.('active'));
  await waitFor(() => expect(e.replace).toHaveBeenCalledWith('screenTimeApps', e.detail));
});

test('연결 요청 중·취소 후에도 추가 버튼 없이 같은 스위치로 재요청한다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('notDetermined');
  let resolve!: (value: boolean) => void;
  native.requestAuthorization.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = await render(<CurrentScreens e={environment('settings')} />);
  const toggle = () => view.getByRole('switch', { name: '스크린타임 연결' });
  await waitFor(() => expect(toggle().props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(toggle());
  expect(toggle().props.accessibilityState.disabled).toBe(true);
  for (const label of ['권한 요청 중…', '권한 다시 요청하기', '시스템 설정 열기']) {
    expect(view.queryByText(label)).toBeNull();
  }
  await act(async () => resolve(false));
  await waitFor(() => expect(toggle().props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(toggle());
  expect(native.requestAuthorization).toHaveBeenCalledTimes(2);
  expect(view.queryByText('시스템 설정 열기')).toBeNull();
});

test('권한 허용 후 측정 앱 피커를 자동으로 한 번 열고 취소하면 돌아간다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('approved');
  native.presentAppPicker.mockResolvedValue(null);
  const e = environment('settings-auto', 'screenTimeApps');
  const view = await render(<CurrentScreens e={e} />);
  await waitFor(() => expect(native.presentAppPicker).toHaveBeenCalledTimes(1));
  expect(e.back).toHaveBeenCalledTimes(1);
  await view.rerender(<CurrentScreens e={{ ...e }} />);
  expect(native.presentAppPicker).toHaveBeenCalledTimes(1);
});

// ── 앱 권한 관리의 iOS 알림 행(GROMO-2526) ──
test.each([
  ['granted', '허용됨'],
  ['denied', '꺼짐'],
  ['undetermined', '아직 묻지 않았어요'],
] as const)(
  '알림 행 — 권한이 %s 면 부제 «%s» 를 보여 주고 읽는 이름에도 싣는다',
  async (permission, description) => {
    mockPushPermissionStatus.mockResolvedValue(permission);
    const view = await render(<CurrentScreens e={environment('settings')} />);
    await view.findByText(description);
    expect(view.getByText('알림')).toBeTruthy();
    expect(view.getByText('알림 권한')).toBeTruthy();
    expect(view.getByLabelText(`알림 권한, ${description}`)).toBeTruthy();
  },
);

test('알림 행 — 푸시 브리지가 없는 바이너리(unavailable)에서는 알림 섹션을 그리지 않는다', async () => {
  const view = await render(<CurrentScreens e={environment('settings')} />);
  await view.findByText('스크린타임 연결');
  await waitFor(() => expect(mockPushPermissionStatus).toHaveBeenCalled());
  expect(view.queryByText('알림')).toBeNull();
  expect(view.queryByText('알림 권한')).toBeNull();
});

test('알림 행 — 아직 안 물음이면 눌러서 시스템 팝업을 띄우고 답으로 부제를 바꾸며, 정해진 뒤에는 시스템 설정을 연다', async () => {
  mockPushPermissionStatus.mockResolvedValue('undetermined');
  mockRequestPushPermission.mockResolvedValue('granted');
  const view = await render(<CurrentScreens e={environment('settings')} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await view.findByText('허용됨');
  expect(mockRequestPushPermission).toHaveBeenCalledTimes(1);
  expect(Linking.openSettings).not.toHaveBeenCalled();

  await fireEvent.press(view.getByText('알림 권한'));
  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  expect(mockRequestPushPermission).toHaveBeenCalledTimes(1);
});

test('알림 행 — 거부 상태에서 누르면 팝업 없이 시스템 설정을 열고, 열지 못하면 안내한다', async () => {
  mockPushPermissionStatus.mockResolvedValue('denied');
  const e = environment('settings');
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  expect(mockRequestPushPermission).not.toHaveBeenCalled();

  jest.mocked(Linking.openSettings).mockRejectedValueOnce(new Error('unavailable'));
  await fireEvent.press(view.getByText('알림 권한'));
  await waitFor(() =>
    expect(e.notify).toHaveBeenCalledWith(expect.stringContaining('설정을 열지 못했어요')),
  );
});

test('알림 행 — 시스템 설정에서 돌아오면(앱 활성) 권한을 다시 읽어 부제를 갱신한다', async () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  mockPushPermissionStatus.mockResolvedValue('denied');
  const view = await render(<CurrentScreens e={environment('settings')} />);
  await view.findByText('꺼짐');

  mockPushPermissionStatus.mockResolvedValue('granted');
  await act(async () => listeners.forEach((listener) => listener('active')));
  await view.findByText('허용됨');
});

test('en 로케일 — 알림 행은 한글 없이 영문으로 그린다', async () => {
  applyLocalePref('en');
  mockPushPermissionStatus.mockResolvedValue('denied');
  const view = await render(<CurrentScreens e={environment('settings')} />);
  await view.findByText('Off');
  expect(view.getByText('Notifications')).toBeTruthy();
  expect(view.getByText('Notification permission')).toBeTruthy();
  expect(view.getByLabelText('Notification permission, Off')).toBeTruthy();
  expect(view.queryByText(/[가-힣]/)).toBeNull();
  expect(view.queryByLabelText(/[가-힣]/)).toBeNull();
});

// ── 알림 행은 앱 설정 「알림」도 켠다(GROMO-2526) — 이 행은 알림을 다시 켜는 자리다 ──
// 앱 설정 「알림」이 꺼진 환경. dispatch 는 목이라 state 는 그대로다.
const environmentNotificationsOff = () => {
  const e = environment('settings');
  e.state.settings.notifications = false;
  return e;
};
const notificationSettingDispatches = (e: ReturnType<typeof environment>) =>
  (e.dispatch as jest.Mock).mock.calls.filter(
    ([action]) => action.type === 'SETTING' && action.key === 'notifications',
  );
const NOTIFICATIONS_ON = { type: 'SETTING', key: 'notifications', value: true };
// AppState 'active' 를 내보내는 함수 — 시스템 설정에서 돌아오는 장면
const captureAppActive = () => {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove: jest.fn() };
  });
  return () => act(async () => listeners.forEach((listener) => listener('active')));
};
const flushAsync = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });

test.each([
  ['granted', 1],
  ['denied', 0],
] as const)(
  '알림 행 — 앱 설정 「알림」이 꺼져 있고 시스템 팝업에서 %s 면 앱 설정을 켜는 횟수는 %i',
  async (answer, times) => {
    mockPushPermissionStatus.mockResolvedValue('undetermined');
    mockRequestPushPermission.mockResolvedValue(answer);
    const e = environmentNotificationsOff();
    const view = await render(<CurrentScreens e={e} />);

    await fireEvent.press(await view.findByText('알림 권한'));
    await view.findByText(answer === 'granted' ? '허용됨' : '꺼짐');
    await flushAsync();
    expect(notificationSettingDispatches(e)).toEqual(Array(times).fill([NOTIFICATIONS_ON]));
  },
);

test('알림 행 — 앱 설정 「알림」이 이미 켜져 있으면 팝업에서 허용돼도 설정을 다시 쓰지 않는다', async () => {
  mockPushPermissionStatus.mockResolvedValue('undetermined');
  mockRequestPushPermission.mockResolvedValue('granted');
  const e = environment('settings');
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await view.findByText('허용됨');
  await flushAsync();
  expect(notificationSettingDispatches(e)).toEqual([]);
});

test('알림 행 — 거부 상태에서 시스템 설정으로 나갔다가 허용으로 돌아오면 꺼진 앱 설정 「알림」을 한 번 켠다', async () => {
  const returnToApp = captureAppActive();
  mockPushPermissionStatus.mockResolvedValue('denied');
  const e = environmentNotificationsOff();
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  expect(notificationSettingDispatches(e)).toEqual([]);

  mockPushPermissionStatus.mockResolvedValue('granted');
  await returnToApp();
  await view.findByText('허용됨');
  expect(notificationSettingDispatches(e)).toEqual([[NOTIFICATIONS_ON]]);

  // 한 번뿐이다 — 다시 활성이 돼도 켜지 않는다.
  await returnToApp();
  await flushAsync();
  expect(notificationSettingDispatches(e)).toHaveLength(1);
});

test('알림 행 — 시스템 설정에서 돌아와도 여전히 거부면 켜지 않고, 나간 표시를 지워 이후 다른 경로로 허용돼도 켜지 않는다', async () => {
  const returnToApp = captureAppActive();
  mockPushPermissionStatus.mockResolvedValue('denied');
  const e = environmentNotificationsOff();
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  await returnToApp();
  await flushAsync();
  expect(mockPushPermissionStatus).toHaveBeenCalledTimes(2);
  expect(notificationSettingDispatches(e)).toEqual([]);

  // 이 행을 거치지 않고 허용됐다(예: 기기 설정 앱에서 직접) — 앱 설정은 그대로 둔다.
  mockPushPermissionStatus.mockResolvedValue('granted');
  await returnToApp();
  await view.findByText('허용됨');
  expect(notificationSettingDispatches(e)).toEqual([]);
});

test('알림 행 — 앱 설정 「알림」이 이미 켜져 있으면 시스템 설정을 다녀와도 설정을 다시 쓰지 않는다', async () => {
  const returnToApp = captureAppActive();
  mockPushPermissionStatus.mockResolvedValue('denied');
  const e = environment('settings');
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  mockPushPermissionStatus.mockResolvedValue('granted');
  await returnToApp();
  await view.findByText('허용됨');
  await flushAsync();
  expect(notificationSettingDispatches(e)).toEqual([]);
});

test('알림 행 — 권한이 이미 허용인데 앱 설정 「알림」만 꺼져 있으면 시스템 설정을 열지 않고 바로 켠다', async () => {
  mockPushPermissionStatus.mockResolvedValue('granted');
  const e = environmentNotificationsOff();
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await flushAsync();
  expect(notificationSettingDispatches(e)).toEqual([[NOTIFICATIONS_ON]]);
  expect(Linking.openSettings).not.toHaveBeenCalled();
});

test('알림 행 — 권한이 허용이고 앱 설정 「알림」도 켜져 있으면 끌 수 있게 시스템 설정을 연다', async () => {
  mockPushPermissionStatus.mockResolvedValue('granted');
  const e = environment('settings');
  const view = await render(<CurrentScreens e={e} />);

  await fireEvent.press(await view.findByText('알림 권한'));
  await waitFor(() => expect(Linking.openSettings).toHaveBeenCalledTimes(1));
  expect(notificationSettingDispatches(e)).toEqual([]);
});
