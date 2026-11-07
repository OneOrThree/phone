import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { applyLocalePref, t } from '@/i18n';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { AndroidScreenTimeSetup } from './AndroidScreenTimeSetup';

let mockOwner = 'owner';
let mockConnected = false;
jest.mock('@/services/api/session', () => ({
  getSession: () => ({ userId: mockOwner }),
  sessionGeneration: () => 1,
}));
jest.mock('@/services/androidScreenTime', () => ({
  syncAndroidMeasurement: jest.fn(async () => ({})),
}));
jest.mock('../focus/focusLeave', () => ({
  duringSystemPrompt: (work: () => Promise<unknown>) => work(),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  screenTimeNative: {
    bindMeasurementOwner: jest.fn(async () => undefined),
    getAuthorizationStatus: jest.fn(async () => 'approved'),
    requestAuthorization: jest.fn(async () => true),
    getAndroidSelection: jest.fn(async () => ({ configured: false, allApps: false, packages: [] })),
    getInstalledApps: jest.fn(async () => [{ packageName: 'video', label: 'YouTube' }]),
    getAllowedPackages: jest.fn(async () => []),
    getAllowedSelectionCounts: jest.fn(async () => null),
    setAndroidSelection: jest.fn(async () => ({ pending: false })),
    setAndroidAllowedPackages: jest.fn(async () => undefined),
    setAndroidFocusConsent: jest.fn(async () => undefined),
    requestAndroidFocusAccess: jest.fn(async () => true),
    getAndroidFocusAccess: jest.fn(async () => ({
      configured: true,
      consented: mockConnected,
      enabled: mockConnected,
      connected: mockConnected,
    })),
  },
}));
const native = screenTimeNative as jest.Mocked<Required<NonNullable<typeof screenTimeNative>>>;
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = 'owner';
  mockConnected = false;
  applyLocalePref('ko');
});
afterEach(() => {
  applyLocalePref('system');
});

test('측정 저장 다음 허용 0개 저장과 별도 동의 뒤에만 접근성 설정을 연다', async () => {
  const close = jest.fn(),
    configured = jest.fn(async () => undefined);
  const view = await render(<AndroidScreenTimeSetup onClose={close} onConfigured={configured} />);
  await view.findByText('YouTube');
  await fireEvent.press(view.getByRole('switch', { name: 'YouTube 선택' }));
  await fireEvent.press(view.getByText(t('settings.permissions.androidPicker.save')));
  await waitFor(() =>
    expect(native.setAndroidSelection).toHaveBeenCalledWith('owner', ['video'], false),
  );
  await view.findByText('집중 중 허용 앱');
  expect(native.requestAndroidFocusAccess).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText(t('settings.permissions.androidPicker.save')));
  await view.findByText('집중 화면으로 돌아오게 해요');
  expect(native.setAndroidAllowedPackages).toHaveBeenCalledWith('owner', []);
  expect(native.setAndroidFocusConsent).not.toHaveBeenCalled();
  native.requestAndroidFocusAccess.mockImplementationOnce(async () => {
    mockConnected = true;
    return true;
  });
  await fireEvent.press(view.getByText('동의하고 접근성 설정하기'));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(native.setAndroidFocusConsent).toHaveBeenCalledWith('owner', true);
  expect(configured).toHaveBeenCalledTimes(1);
});

test('허용 앱 피커에서 뒤로 가면 저장하거나 동의 화면으로 진행하지 않는다', async () => {
  const close = jest.fn();
  const view = await render(<AndroidScreenTimeSetup allowedOnly onClose={close} />);
  await view.findByText('YouTube');
  await fireEvent.press(view.getByText(t('settings.permissions.androidPicker.back')));
  expect(close).toHaveBeenCalledTimes(1);
  expect(native.setAndroidAllowedPackages).not.toHaveBeenCalled();
  expect(native.requestAndroidFocusAccess).not.toHaveBeenCalled();
});

test('접근성 미허용이면 완료로 닫지 않고, 뒤늦은 다른 계정의 허용 응답도 버린다', async () => {
  const close = jest.fn(),
    configured = jest.fn(async () => undefined);
  const view = await render(
    <AndroidScreenTimeSetup allowedOnly onClose={close} onConfigured={configured} />,
  );
  await view.findByText('YouTube');
  await fireEvent.press(view.getByText(t('settings.permissions.androidPicker.save')));
  await view.findByText('동의하고 접근성 설정하기');
  await fireEvent.press(view.getByText('동의하고 접근성 설정하기'));
  await view.findByText(/아직 연결되지 않았어요/);
  expect(close).not.toHaveBeenCalled();
  let resolve!: (value: boolean) => void;
  native.requestAndroidFocusAccess.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await fireEvent.press(view.getByText('동의하고 접근성 설정하기'));
  await waitFor(() => expect(native.requestAndroidFocusAccess).toHaveBeenCalledTimes(2));
  mockOwner = 'other';
  await act(async () => {
    mockConnected = true;
    resolve(true);
  });
  expect(configured).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
