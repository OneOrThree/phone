import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { applyLocalePref, t } from '@/i18n';
import { readAccountGuides, saveAccountGuides } from '@/services/accountGuides';
import { screenTime } from '@/services/screenTime';
import { VerificationToggle } from './VerificationSpike';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/screens/island/sceneKit', () => ({
  ...jest.requireActual('@/screens/island/sceneKit'),
  useGowun: () => undefined,
}));
let mockOwner = 'alice';
let mockGeneration = 1;
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getSession: () => ({ userId: mockOwner }),
  sessionGeneration: () => mockGeneration,
}));
jest.mock('@/services/screenTime', () => ({
  ...jest.requireActual('@/services/screenTime'),
  isScreenTimeAvailable: true,
  screenTime: {
    bindMeasurementOwner: jest.fn(async () => undefined),
    getAuthorizationStatus: jest.fn(),
    requestAuthorization: jest.fn(),
    getMeasurementSelectionCounts: jest.fn(),
    presentAppPicker: jest.fn(),
    promoteSelection: jest.fn(),
    getUnconfirmedUsageBucketDays: jest.fn(),
    getTodayUsageBucketMinutes: jest.fn(),
    getAllowedSelectionCounts: jest.fn(),
    presentAllowedAppManager: jest.fn(),
  },
}));
const native = jest.mocked(screenTime);
const selection = { applications: 1, categories: 0, webDomains: 0 };
const originalOS = Platform.OS;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Platform.OS = 'ios';
  applyLocalePref('ko');
  mockOwner = 'alice';
  mockGeneration = 1;
  native.getAuthorizationStatus.mockReset().mockResolvedValue('approved');
  native.requestAuthorization.mockReset().mockResolvedValue(true);
  native.getMeasurementSelectionCounts.mockReset().mockResolvedValue(null);
  native.getAllowedSelectionCounts.mockReset().mockResolvedValue(null);
  native.presentAllowedAppManager.mockReset().mockResolvedValue(null);
  native.presentAppPicker.mockReset().mockResolvedValue(null);
  native.promoteSelection.mockReset().mockResolvedValue(true);
  native.getUnconfirmedUsageBucketDays.mockResolvedValue(['2026-11-07']);
  native.getTodayUsageBucketMinutes.mockResolvedValue(0);
});
afterEach(() => {
  Platform.OS = originalOS;
  applyLocalePref('system');
});
const setupButton = { name: '설정하기' };
async function manual(props = {}) {
  const view = await render(<VerificationToggle on={false} onChange={jest.fn()} {...props} />);
  await fireEvent.press(view.getByRole('button', { name: '허용 앱 설정' }));
  return view;
}

test('AI 다음에 승인한 통합 안내와 설정 버튼 하나를 표시하고 노출·응답 이력을 구분한다', async () => {
  const view = await render(
    <VerificationToggle on={false} onChange={jest.fn()} intro="automatic" />,
  );
  await view.findByTestId('verification-intro');
  await fireEvent.press(view.getByRole('button', { name: t('focusBlocking.next') }));
  expect(view.getByText(t('screenTimeSetup.title'))).toBeTruthy();
  expect(view.getByText(t('screenTimeSetup.allowedBody'))).toBeTruthy();
  expect(
    within(view.getByTestId('focus-blocking-guide'))
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel),
  ).toEqual(['설정하기']);
  await waitFor(async () =>
    expect((await readAccountGuides('alice')).screenTimeGuideShownVersion).toBe(1),
  );
  expect((await readAccountGuides('alice')).screenTimeGuideAcknowledgedVersion).toBeUndefined();
  expect(native.getAuthorizationStatus).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: '닫기' }));
  await waitFor(() => expect(view.queryByTestId('focus-blocking-guide')).toBeNull());
  expect(await readAccountGuides('alice')).toMatchObject({
    verificationIntroSeen: true,
    screenTimeGuideAcknowledgedVersion: 1,
  });
});

test('AI에서 닫으면 같은 방문에 통합 안내가 이어 뜨지 않고 다음 도착에서 이어진다', async () => {
  const view = await render(
    <VerificationToggle on={false} onChange={jest.fn()} intro="automatic" />,
  );
  await view.findByTestId('verification-intro');
  await fireEvent.press(view.getByRole('button', { name: '닫기' }));
  await waitFor(async () =>
    expect((await readAccountGuides('alice')).verificationIntroSeen).toBe(true),
  );
  expect(view.queryByTestId('focus-blocking-guide')).toBeNull();
  expect((await readAccountGuides('alice')).screenTimeGuideAcknowledgedVersion).toBeUndefined();
  await view.unmount();
  const next = await render(
    <VerificationToggle on={false} onChange={jest.fn()} intro="automatic" />,
  );
  await next.findByTestId('focus-blocking-guide');
});

test('통합 안내를 확인한 계정은 자동 재노출하지 않고 수동으로 다시 연다', async () => {
  await saveAccountGuides('alice', {
    verificationIntroSeen: true,
    screenTimeGuideAcknowledgedVersion: 1,
  });
  const view = await render(
    <VerificationToggle on={false} onChange={jest.fn()} intro="automatic" />,
  );
  await waitFor(() => expect(view.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(view.queryByTestId('focus-blocking-guide')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: '허용 앱 설정' }));
  expect(view.getByTestId('focus-blocking-guide')).toBeTruthy();
});

test('복원된 집중 세션에서는 두 안내 모두 자동으로 표시하지 않는다', async () => {
  const view = await render(
    <VerificationToggle on={false} onChange={jest.fn()} intro="automatic" inSession />,
  );
  await waitFor(() => expect(view.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(view.queryByTestId('verification-intro')).toBeNull();
  expect(view.queryByTestId('focus-blocking-guide')).toBeNull();
});

test('권한 승인 → 측정 앱 저장·활성화 → 허용 앱 저장 순서로 진행한다', async () => {
  const calls: string[] = [];
  native.getAuthorizationStatus
    .mockResolvedValueOnce('notDetermined')
    .mockResolvedValue('approved');
  native.requestAuthorization.mockImplementation(async () => {
    calls.push('permission');
    return true;
  });
  native.presentAppPicker.mockImplementation(async () => {
    calls.push('measure');
    return { ...selection, appliesImmediately: true };
  });
  native.promoteSelection.mockImplementation(async () => {
    calls.push('activate');
    return true;
  });
  native.presentAllowedAppManager.mockImplementation(async () => {
    calls.push('allowed');
    return { ...selection, applications: 0 };
  });
  const ready = jest.fn();
  const view = await manual({ onMeasurementReady: ready });
  await fireEvent.press(view.getByRole('button', setupButton));
  await waitFor(() => expect(view.queryByTestId('focus-blocking-guide')).toBeNull(), {
    timeout: 2500,
  });
  expect(calls).toEqual(['permission', 'measure', 'activate', 'allowed']);
  expect(ready).toHaveBeenCalledWith(0, ['2026-11-07']);
});

test('측정 피커를 취소하면 허용 앱 피커를 열지 않고 설정 버튼으로 재시도한다', async () => {
  const view = await manual();
  await fireEvent.press(view.getByRole('button', setupButton));
  await waitFor(() => expect(native.presentAppPicker).toHaveBeenCalledTimes(1));
  expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
  expect(view.getByTestId('focus-blocking-guide')).toBeTruthy();
  expect((await readAccountGuides('alice')).screenTimeGuideAcknowledgedVersion).toBe(1);
});

test('측정 저장 뒤 허용 앱 선택을 취소하면 다음 시도에서 허용 앱부터 재개한다', async () => {
  native.presentAppPicker.mockImplementation(async () => {
    native.getMeasurementSelectionCounts.mockResolvedValue(selection);
    return { ...selection, appliesImmediately: true };
  });
  const view = await manual();
  await fireEvent.press(view.getByRole('button', setupButton));
  await waitFor(() => expect(native.presentAllowedAppManager).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.getByRole('button', setupButton)).toBeEnabled());
  native.presentAllowedAppManager.mockResolvedValue({ ...selection, applications: 0 });
  await fireEvent.press(view.getByRole('button', setupButton));
  await waitFor(() => expect(view.queryByTestId('focus-blocking-guide')).toBeNull());
  expect(native.presentAppPicker).toHaveBeenCalledTimes(1);
  expect(native.presentAllowedAppManager).toHaveBeenCalledTimes(2);
});

test('권한 거절·요청 실패는 안내에 머물며 재시도할 수 있다', async () => {
  native.getAuthorizationStatus.mockResolvedValue('denied');
  native.requestAuthorization.mockResolvedValue(false);
  const view = await manual();
  await fireEvent.press(view.getByRole('button', setupButton));
  await view.findByText(t('settings.permissions.errors.grantIos'));
  expect(native.presentAppPicker).not.toHaveBeenCalled();
  native.requestAuthorization.mockRejectedValueOnce(new Error('native error'));
  await fireEvent.press(view.getByRole('button', setupButton));
  await view.findByText(t('settings.permissions.errors.requestFailed'));
});

test('요청 중 연타·닫기를 무시하고 계정 전환 뒤 늦은 응답으로 피커를 열지 않는다', async () => {
  let resolve!: (value: boolean) => void;
  native.getAuthorizationStatus.mockResolvedValue('notDetermined');
  native.requestAuthorization.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await manual();
  await fireEvent.press(view.getByRole('button', setupButton));
  await waitFor(() => expect(native.requestAuthorization).toHaveBeenCalledTimes(1));
  await fireEvent.press(view.getByRole('button', { name: '닫기' }));
  expect(view.getByTestId('focus-blocking-guide')).toBeTruthy();
  mockOwner = 'bob';
  mockGeneration++;
  await act(async () => resolve(true));
  expect(native.presentAppPicker).not.toHaveBeenCalled();
  expect((await readAccountGuides('bob')).screenTimeGuideAcknowledgedVersion).toBeUndefined();
});

test.each(['ko', 'en'])(
  '%s Android는 차단을 약속하지 않고 기존 측정 설정으로 연결한다',
  async (locale) => {
    Platform.OS = 'android';
    applyLocalePref(locale);
    const openMeasurement = jest.fn();
    const view = await render(
      <VerificationToggle on={false} onChange={jest.fn()} onAndroidSetup={openMeasurement} />,
    );
    await fireEvent.press(view.getByRole('button', { name: t('focusBlocking.button') }));
    expect(view.getByText(t('screenTimeSetup.androidBlocking'))).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: t('screenTimeSetup.setup') }));
    await waitFor(() => expect(openMeasurement).toHaveBeenCalledTimes(1));
    expect(native.requestAuthorization).not.toHaveBeenCalled();
    expect(native.presentAllowedAppManager).not.toHaveBeenCalled();
  },
);
