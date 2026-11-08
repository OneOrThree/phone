import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

async function seenToggle(props: Partial<React.ComponentProps<typeof VerificationToggle>> = {}) {
  await saveAccountGuides('consent-test', { verificationIntroSeen: true });
  const { useState } = require('react');
  function Harness() {
    const [on, setOn] = useState(props.on ?? false);
    return <VerificationToggle {...props} on={on} onChange={setOn} />;
  }
  const screen = await render(<Harness />);
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled());
  return screen;
}

test('측정을 직접 켰을 때만 5초 도움말을 띄우고 미리보기는 자동으로 열지 않는다', async () => {
  const hint = jest.fn();
  const preview = jest.fn();
  const screen = await seenToggle({ onPlacementHintChange: hint, onPreviewChange: preview });
  expect(hint).not.toHaveBeenCalledWith(true);
  jest.useFakeTimers();
  try {
    await fireEvent.press(screen.getByRole('switch'));
    await waitFor(() => expect(hint).toHaveBeenLastCalledWith(true));
    expect(preview).not.toHaveBeenCalledWith(true);
    await act(async () => jest.advanceTimersByTime(4999));
    expect(hint).toHaveBeenLastCalledWith(true);
    await act(async () => jest.advanceTimersByTime(1));
    expect(hint).toHaveBeenLastCalledWith(false);
  } finally {
    jest.useRealTimers();
  }
});

test('측정 OFF는 열린 미리보기·도움말을 닫고 재활성화도 미리보기를 열지 않는다', async () => {
  const hint = jest.fn();
  const preview = jest.fn();
  const screen = await seenToggle({ onPlacementHintChange: hint, onPreviewChange: preview });
  await fireEvent.press(screen.getByRole('switch'));
  await waitFor(() => expect(hint).toHaveBeenLastCalledWith(true));
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(preview).toHaveBeenLastCalledWith(true));
  await fireEvent.press(screen.getByRole('switch'));
  expect(preview).toHaveBeenLastCalledWith(false);
  expect(hint).toHaveBeenLastCalledWith(false);
  expect(
    screen.getByRole('button', { name: '카메라 인증' }).props.accessibilityState.expanded,
  ).toBe(false);
  preview.mockClear();
  await fireEvent.press(screen.getByRole('switch'));
  await waitFor(() => expect(hint).toHaveBeenLastCalledWith(true));
  expect(preview).not.toHaveBeenCalledWith(true);
});

test('권한 거절은 도움말과 측정을 시작하지 않고 저장된 ON도 도움말을 반복하지 않는다', async () => {
  const hint = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  request.mockResolvedValue({ granted: false, canAskAgain: false });
  const screen = await seenToggle({ onPlacementHintChange: hint });
  await fireEvent.press(screen.getByRole('switch'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(hint).not.toHaveBeenCalledWith(true);
  expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(false);
  await screen.unmount();
  await seenToggle({ on: true, onPlacementHintChange: hint });
  expect(hint).not.toHaveBeenCalledWith(true);
});

test('미리보기 권한 조회 도중 외부에서 OFF 후 ON으로 바뀌어도 이전 응답은 영상을 열지 않는다', async () => {
  await saveAccountGuides('consent-test', { verificationIntroSeen: true });
  const preview = jest.fn();
  const onChange = jest.fn();
  const view = (on: boolean) => (
    <VerificationToggle on={on} onChange={onChange} onPreviewChange={preview} />
  );
  const screen = await render(view(true));
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  let resolve!: (value: { granted: boolean }) => void;
  getPermission.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await screen.rerender(view(false));
  await screen.rerender(view(true));
  await act(async () => resolve({ granted: true }));
  expect(preview).not.toHaveBeenCalledWith(true);
});

test('권한 조회 도중 화면이 닫히면 측정이나 도움말을 켜지 않는다', async () => {
  await saveAccountGuides('consent-test', { verificationIntroSeen: true });
  const onChange = jest.fn();
  const hint = jest.fn();
  const screen = await render(
    <VerificationToggle on onChange={onChange} onPlacementHintChange={hint} />,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  let resolve!: (value: { granted: boolean }) => void;
  getPermission.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await screen.unmount();
  await act(async () => resolve({ granted: true }));
  expect(onChange).not.toHaveBeenCalled();
  expect(hint).not.toHaveBeenCalledWith(true);
});
