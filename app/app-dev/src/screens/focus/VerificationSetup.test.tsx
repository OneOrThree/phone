import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, Linking } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { VerificationSetup } from './VerificationSetup';
import { componentTokens } from '@/design-system/tokens';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-camera', () => ({
  CameraView: (props: object) =>
    require('react').createElement(require('react-native').View, props),
  useCameraPermissions: jest.fn(),
}));
jest.mock('./VerificationCamera', () => ({
  VerificationCamera: ({ active, ...props }: { active: boolean }) =>
    active
      ? require('react').createElement(require('react-native').View, {
          ...props,
          testID: 'verification-camera-preview',
        })
      : null,
}));

type Permission = NonNullable<ReturnType<typeof useCameraPermissions>[0]>;
const request = jest.fn<Promise<Permission>, []>();
const getPermission = jest.fn<Promise<Permission>, []>();
let permission: Permission;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  AppState.currentState = 'active';
  permission = {
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  } as Permission;
  request.mockImplementation(async () => {
    permission = { ...permission, status: 'denied' as Permission['status'], canAskAgain: false };
    return permission;
  });
  getPermission.mockImplementation(async () => permission);
  jest.mocked(useCameraPermissions).mockImplementation(() => [permission, request, getPermission]);
});
afterEach(() => jest.restoreAllMocks());

function allow() {
  permission = {
    ...permission,
    status: 'granted' as Permission['status'],
    granted: true,
    canAskAgain: false,
  };
}
async function setup(on = false) {
  const onChange = jest.fn();
  const onClose = jest.fn();
  const screen = await render(
    <VerificationSetup on={on} cameraPosition="back" onChange={onChange} onClose={onClose} />,
  );
  return { ...screen, onChange, onClose };
}

test('권한 거절은 인증을 켜지 않고 설정 열기를 제공한다', async () => {
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  const screen = await setup();
  await waitFor(() => expect(screen.getByText('설정에서 카메라를 허용해 주세요')).toBeTruthy());
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
  expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '설정 열기' }));
  expect(openSettings).toHaveBeenCalled();
  expect(screen.onChange).not.toHaveBeenCalled();
});

test('이미 거절한 권한은 OS 요청을 반복하지 않는다', async () => {
  permission = { ...permission, status: 'denied' as Permission['status'], canAskAgain: false };
  const screen = await setup();
  expect(request).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '설정 열기' })).toBeTruthy();
});

test('권한 조회 중에는 거절 안내를 띄우지 않고 앱 상태를 구독한다', async () => {
  jest.mocked(useCameraPermissions).mockReturnValue([null, request, getPermission]);
  const screen = await setup();
  expect(screen.getByLabelText('카메라 권한 확인 중')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '설정 열기' })).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
});

test('전환한 카메라가 준비된 뒤 같은 카메라로 시작한다', async () => {
  allow();
  const screen = await setup();
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'ready');
  await fireEvent.press(screen.getByRole('button', { name: '카메라 전환' }));
  expect(screen.getByTestId('verification-camera-preview').props.position).toBe('front');
  expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled();
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'ready');
  await fireEvent.press(screen.getByRole('button', { name: '시작하기' }));
  expect(screen.onChange).toHaveBeenCalledWith(true, 'front');
  expect(screen.onClose).toHaveBeenCalled();
});

test('끄기를 눌렀을 때만 인증을 해제한다', async () => {
  allow();
  const screen = await setup(true);
  await fireEvent.press(screen.getByRole('button', { name: '끄기' }));
  expect(screen.onChange).toHaveBeenCalledWith(false, 'back');
  expect(screen.onClose).toHaveBeenCalled();
});

test('백그라운드에서는 카메라를 해제하고 복귀 후 새 프리뷰를 기다린다', async () => {
  allow();
  const subscription = jest.spyOn(AppState, 'addEventListener');
  const screen = await setup();
  const onStateChange = subscription.mock.calls.find(([event]) => event === 'change')![1];
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'ready');
  await act(async () => onStateChange('background'));
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
  expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled();
  await act(async () => onStateChange('active'));
  expect(screen.getByTestId('verification-camera-preview')).toBeTruthy();
  expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled();
  expect(getPermission).toHaveBeenCalled();
});

test('카메라 시작 실패를 표시하고 전환으로 다시 시도할 수 있다', async () => {
  allow();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const screen = await setup();
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'error', {
    message: 'camera unavailable',
  });
  expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: '카메라 전환' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('verification-camera-preview').props.position).toBe('front');
});

test('실제 손 판정이 성공할 때만 초록불과 집중 확인 완료를 표시하고 다시 실패하면 해제한다', async () => {
  allow();
  const screen = await setup();
  const camera = () => screen.getByTestId('verification-camera-preview');
  await fireEvent(camera(), 'ready');
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await fireEvent(camera(), 'detection', 'focused');
  expect(screen.getByText('집중 확인 완료')).toBeTruthy();
  expect(screen.getByTestId('verification-detection-light').props.style.backgroundColor).toBe(
    componentTokens.verificationSetup.readyColor,
  );
  await fireEvent(camera(), 'detection', 'missingHand');
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  expect(screen.getByText('손이 보이지 않아요.')).toBeTruthy();
  expect(screen.getByTestId('verification-detection-light').props.style.backgroundColor).toBe(
    componentTokens.verificationSetup.waitingColor,
  );
});

test('카메라 전환과 프리뷰 중단은 이전 집중 확인 완료 표시를 지운다', async () => {
  allow();
  const screen = await setup();
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'ready');
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'detection', 'focused');
  await fireEvent.press(screen.getByRole('button', { name: '카메라 전환' }));
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'ready');
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'detection', 'focused');
  await fireEvent(screen.getByTestId('verification-camera-preview'), 'paused');
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  expect(screen.getByRole('button', { name: '시작하기' })).toBeDisabled();
});
