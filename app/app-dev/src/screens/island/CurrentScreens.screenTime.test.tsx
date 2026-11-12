import { applyLocalePref } from '@/i18n';
import { createPreviewEnvironment } from '@/navigation/previewEnvironment';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { FocusBlockingIntro } from '@/screens/permissions/FocusBlockingIntro';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import type { Route } from '@/services/model';
import { initialState } from '@/services/model';
import { screenTime } from '@/services/screenTime';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, Linking, Platform } from 'react-native';

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
  delete screenTimeNative!.getAndroidFocusAccess;
  native.getAuthorizationStatus.mockResolvedValue('denied');
  native.requestAuthorization.mockResolvedValue(false);
  native.getMeasurementSelectionCounts.mockResolvedValue(selection(2));
  native.getAllowedSelectionCounts.mockResolvedValue(selection(1));
  native.getFocusAllowSafariWeb.mockResolvedValue(false);
  native.canDrawOverlays.mockResolvedValue(false);
  native.getAllowedPackages.mockResolvedValue([]);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(async () => {
  await cleanup();
  applyLocalePref('system');
  jest.restoreAllMocks();
  Platform.OS = originalOS;
});
function environment(detail = '', route: Route = 'permission') {
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
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  await view.findByText('2개 선택됨');
  expect(view.getByRole('switch', { name: '스크린타임 연결' })).toBeTruthy();
  expect(view.queryByText('사용 시간 공유')).toBeNull();
  expect(view.queryByRole('switch', { name: '스크린타임 서버 전송 동의' })).toBeNull();
  expect(
    view.getByText(
      '측정 앱을 저장하면 사용 시간과 측정 상태를 서버에 보내 통계·퀘스트에 사용해요.',
    ),
  ).toBeTruthy();
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
    if (os === 'android')
      native.getAndroidFocusAccess = jest.fn().mockResolvedValue({
        enabled: false,
        connected: false,
        consented: false,
        configured: false,
      });
    applyLocalePref('en');
    native.getAuthorizationStatus.mockResolvedValue('approved');
    const view = await render(
      <CurrentScreens e={createPreviewEnvironment(environment('settings'))} />,
    );
    await view.findByText('2 selected');
    expect(view.getByText('Phone use & app blocking')).toBeTruthy();
    expect(view.getByRole('switch', { name: 'Connect Screen Time' })).toBeTruthy();
    expect(view.queryByText('Share usage time')).toBeNull();
    expect(
      view.getByText(
        'Saving measured apps sends usage time and measurement status to the server for statistics and quests.',
      ),
    ).toBeTruthy();
    expect(view.getByText('App blocking during focus')).toBeTruthy();
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
] as const)('en 로케일 — %s %s %s 화면은 한글이 없다', async (os, auth, route: Route) => {
  Platform.OS = os;
  applyLocalePref('en');
  native.getAuthorizationStatus.mockResolvedValue(auth);
  const view = await render(
    <CurrentScreens e={createPreviewEnvironment(environment('', route))} />,
  );
  await view.findAllByText(
    os === 'ios'
      ? 'Phone usage and\nblocking during focus'
      : route === 'permission'
        ? 'Measurement permission'
        : 'Measured apps',
  );
  expect(view.queryByText(/[가-힣]/)).toBeNull();
  expect(view.queryByLabelText(/[가-힣]/)).toBeNull();
});

test('차단 미지원 Android 측정 권한 안내에는 앱 차단 권한을 요구하지 않는다', async () => {
  Platform.OS = 'android';
  native.supportsFocusShield = false;
  const view = await render(<CurrentScreens e={createPreviewEnvironment(environment())} />);
  await view.findByText(
    '선택한 앱의 사용 시간만 기록해요. 이 선택은 앱 차단 설정에 영향을 주지 않아요.',
  );
  expect(view.queryByText(/집중 중 앱 차단/)).toBeNull();
});

test('튜토리얼 다음 집중의 앱 차단 안내는 권한 흐름 또는 원래 집중으로 이어진다', async () => {
  const callbacks = { onAllow: jest.fn(), onLater: jest.fn(), onClose: jest.fn() };
  const view = await render(<FocusBlockingIntro e={callbacks} />);
  expect(
    view.getByTestId('focus-blocking-character', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    view.getByTestId('focus-blocking-logo-instagram', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    view.getByTestId('focus-blocking-logo-youtube', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    view.getByTestId('focus-blocking-logo-tiktok', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(view.queryByTestId('island-sheet-box')).toBeNull();
  expect(view.queryByLabelText('뒤로')).toBeNull();
  expect(view.getByLabelText('닫기')).toBeTruthy();
  expect(view.getByText('집중 중에도 쓸 ‘허용 앱’을 골라 줘.', { exact: false })).toBeTruthy();
  expect(
    view.getByText('사용 시간을 기록할 ‘측정 앱’ 선택과는 별개야.', { exact: false }),
  ).toBeTruthy();
  await fireEvent.press(view.getByText('권한 허용하기'));
  expect(callbacks.onAllow).toHaveBeenCalledTimes(1);
  expect(callbacks.onLater).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('나중에'));
  expect(callbacks.onLater).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByLabelText('닫기'));
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
});

test('앱 차단 권한 요청 중에는 버튼을 다시 눌러도 중복 요청하지 않는다', async () => {
  const callbacks = { onAllow: jest.fn(), onLater: jest.fn(), onClose: jest.fn(), busy: true };
  const view = await render(<FocusBlockingIntro e={callbacks} />);
  await fireEvent.press(view.getByText('권한 요청 중…'));
  expect(callbacks.onAllow).not.toHaveBeenCalled();
});

test('통합 안내에서 승인하면 측정 피커를 열고 저장 후 돌아간다', async () => {
  const e = environment('measured-apps');
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  native.requestAuthorization.mockImplementationOnce(async () => {
    native.getAuthorizationStatus.mockResolvedValue('approved');
    return true;
  });
  native.presentAppPicker.mockResolvedValue({ ...selection(4), appliesImmediately: false });
  await fireEvent.press(view.getByText('설정하기'));
  await waitFor(() => expect(native.presentAppPicker).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(e.back).toHaveBeenCalledTimes(1));
  expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
});

test('권한 요청을 취소하면 설정 버튼과 오류를 유지한다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('notDetermined');
  const e = environment();
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  await fireEvent.press(view.getByText('설정하기'));
  await view.findByText('iOS 설정에서 스크린타임 권한을 허용해 주세요.');
  expect(view.getByRole('button', { name: '설정하기' })).toBeEnabled();
  expect(e.back).not.toHaveBeenCalled();
  expect(native.presentAppPicker).not.toHaveBeenCalled();
});

test('통합 안내를 닫으면 권한이나 목록을 변경하지 않고 돌아간다', async () => {
  const e = environment();
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  await fireEvent.press(view.getByRole('button', { name: '닫기' }));
  await waitFor(() => expect(e.back).toHaveBeenCalledTimes(1));
  expect(native.requestAuthorization).not.toHaveBeenCalled();
  expect(native.presentAppPicker).not.toHaveBeenCalled();
});

test('뗏목 권한 관리에서 재요청하고 승인 후 측정 앱과 허용 앱을 모두 연다', async () => {
  const e = environment('settings');
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
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
  const view = await render(
    <CurrentScreens e={createPreviewEnvironment(environment('settings'))} />,
  );
  await view.findByText('5개 선택됨 · 내일부터 적용');
  expect((await screenTime.getMeasurementSelectionCounts())?.applications).toBe(2);
});

test('측정 앱 진입은 통합 안내의 설정 버튼으로 피커를 열고 저장 뒤 돌아간다', async () => {
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
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  expect(view.queryByText('줄이고 싶은 앱을 골라주세요')).toBeNull();
  expect(view.queryByText('저장한 측정 대상')).toBeNull();
  expect(view.queryByLabelText('스크린타임 서버 전송 동의')).toBeNull();
  expect(native.presentAppPicker).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('설정하기'));
  await waitFor(() => expect(e.back).toHaveBeenCalledTimes(1));
  expect(e.notify).toHaveBeenCalledWith('측정 앱 4개를 내일부터 적용해요.');
});

test('시스템 설정에서 승인한 뒤 설정하기를 누르면 실제 권한을 다시 확인한다', async () => {
  const e = environment();
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  native.getAuthorizationStatus.mockResolvedValue('approved');
  native.presentAppPicker.mockResolvedValue(null);
  await fireEvent.press(view.getByText('설정하기'));
  await waitFor(() => expect(native.presentAppPicker).toHaveBeenCalledTimes(1));
  expect(native.requestAuthorization).not.toHaveBeenCalled();
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'SETTING', key: 'permission', value: true });
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
  const view = await render(
    <CurrentScreens e={createPreviewEnvironment(environment('settings'))} />,
  );
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

test('측정 피커 취소 후 안내에 머물고 재렌더로 자동 재요청하지 않는다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('approved');
  native.presentAppPicker.mockResolvedValue(null);
  const e = environment('settings-auto', 'screenTimeApps');
  const view = await render(<CurrentScreens e={createPreviewEnvironment(e)} />);
  await fireEvent.press(view.getByText('설정하기'));
  await waitFor(() => expect(native.presentAppPicker).toHaveBeenCalledTimes(1));
  expect(e.back).not.toHaveBeenCalled();
  await view.rerender(<CurrentScreens e={createPreviewEnvironment({ ...e })} />);
  expect(native.presentAppPicker).toHaveBeenCalledTimes(1);
});
