import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermissions } from 'expo-camera';
import * as sessionApi from '@/services/api/session';
import { readAccountGuides, saveAccountGuides } from '@/services/accountGuides';
import { VerificationToggle } from './VerificationSpike';

jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const request = jest.fn();
const getPermission = jest.fn();
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest
    .spyOn(sessionApi, 'getSession')
    .mockReturnValue({ userId: 'consent-test' } as ReturnType<typeof sessionApi.getSession>);
  const permission = {
    granted: false,
    canAskAgain: true,
    status: 'undetermined',
    expires: 'never',
  };
  getPermission.mockResolvedValue(permission);
  request.mockResolvedValue({ ...permission, granted: true });
  jest
    .mocked(useCameraPermissions)
    .mockReturnValue([permission, request, getPermission] as ReturnType<
      typeof useCameraPermissions
    >);
});
afterEach(() => jest.restoreAllMocks());

test('첫 안내가 보류되는 동안 스위치는 권한 요청과 측정을 시작하지 않는다', async () => {
  const onChange = jest.fn();
  const screen = await render(
    <VerificationToggle intro="automatic" on={false} onChange={onChange} />,
  );
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  await screen.rerender(<VerificationToggle on={false} onChange={onChange} />);
  await fireEvent.press(screen.getByRole('switch'));
  expect(getPermission).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect((await readAccountGuides('consent-test')).verificationIntroSeen).toBeUndefined();
  await screen.rerender(<VerificationToggle intro="automatic" on={false} onChange={onChange} />);
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(request).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('switch'));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(true, 'back'));
});

test('안내를 이미 본 계정은 자동 안내가 보류되어도 측정을 켤 수 있다', async () => {
  await saveAccountGuides('consent-test', { verificationIntroSeen: true });
  const onChange = jest.fn();
  const screen = await render(<VerificationToggle on={false} onChange={onChange} />);
  await waitFor(() =>
    expect(screen.getByRole('switch').props.accessibilityState.disabled).toBe(false),
  );
  await fireEvent.press(screen.getByRole('switch'));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(true, 'back'));
});

test('안내 이력이 없는 계정도 켜진 측정과 미리보기는 끌 수 있다', async () => {
  const onChange = jest.fn();
  const screen = await render(<VerificationToggle on onChange={onChange} />);
  await fireEvent.press(screen.getByRole('switch'));
  expect(onChange).toHaveBeenCalledWith(false, 'back');
  expect(request).not.toHaveBeenCalled();
});
