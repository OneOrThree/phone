import { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermissions } from 'expo-camera';
import { saveAccountGuides, readAccountGuides } from '@/services/accountGuides';
import * as sessionApi from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
import { VerificationControls } from './VerificationControls';
import { VerificationSession } from './VerificationSession';

jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-camera', () => ({ useCameraPermissions: jest.fn() }));
jest.mock('./VerificationCamera', () => ({
  VerificationCamera: (props: object) =>
    require('react').createElement(require('react-native').View, {
      ...props,
      testID: 'native-verification-camera',
    }),
}));

type Permission = NonNullable<ReturnType<typeof useCameraPermissions>[0]>;
const getPermission = jest.fn<Promise<Permission>, []>();
const requestPermission = jest.fn<Promise<Permission>, []>();
let permission: Permission;
let owner: string;
let generation: number;
let listeners: Set<(state: AppStateStatus) => void>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  owner = 'automatic-user';
  generation = 1;
  jest
    .spyOn(sessionApi, 'getSession')
    .mockImplementation(() => ({ userId: owner }) as ReturnType<typeof sessionApi.getSession>);
  jest.spyOn(sessionApi, 'sessionGeneration').mockImplementation(() => generation);
  AppState.currentState = 'active';
  listeners = new Set();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  permission = {
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  } as Permission;
  getPermission.mockImplementation(async () => permission);
  requestPermission.mockImplementation(async () => {
    permission = { ...permission, status: 'denied' as Permission['status'], canAskAgain: false };
    return permission;
  });
  jest
    .mocked(useCameraPermissions)
    .mockImplementation(() => [permission, requestPermission, getPermission]);
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
async function seen() {
  await saveAccountGuides(owner, { verificationIntroSeen: true });
}
async function background(state: 'active' | 'background' | 'inactive') {
  await act(async () => {
    AppState.currentState = state;
    listeners.forEach((listener) => listener(state));
  });
}
function Rig({ inSession = true, intro = true }: { inSession?: boolean; intro?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [preview, setPreview] = useState(false);
  return (
    <>
      <VerificationControls
        inSession={inSession}
        intro={intro ? 'automatic' : undefined}
        onMeasurementChange={setEnabled}
        onPreviewChange={setPreview}
      />
      <VerificationSession
        sessionId={inSession ? 'automatic-focus' : undefined}
        enabled={enabled}
        previewVisible={preview}
      />
    </>
  );
}

test.each([false, true])(
  '집중 중=%s: 안내 이력과 권한이 있으면 스위치 없이 미리보기를 닫은 채 자동 측정한다',
  async (inSession) => {
    allow();
    await seen();
    const screen = await render(<Rig inSession={inSession} />);
    await waitFor(() => expect(screen.getByTestId('native-verification-camera')).toBeTruthy());
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByTestId('native-verification-camera').props.measurementEnabled).toBe(true);
    expect(screen.getByTestId('native-verification-camera').props.previewVisible).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.getByText('측정 준비 중')).toBeTruthy();
  },
);

test('첫 안내를 보는 동안 촬영하지 않고 닫은 뒤 OS 권한을 허용하면 미리보기 없이 측정한다', async () => {
  requestPermission.mockImplementation(async () => {
    allow();
    return permission;
  });
  const screen = await render(<Rig />);
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  expect(screen.getByText('손과 책 혹은 노트북을 감지해요.')).toBeTruthy();
  expect(screen.queryByText('켜기 · 끄기')).toBeNull();
  expect(screen.queryByTestId('native-verification-camera')).toBeNull();
  expect(getPermission).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  await waitFor(() => expect(screen.getByTestId('native-verification-camera')).toBeTruthy());
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect((await readAccountGuides(owner)).verificationIntroSeen).toBe(true);
  expect(screen.queryByTestId('verification-session-preview')).toBeNull();
});

test('미리보기를 열고 닫아도 측정과 하나의 네이티브 카메라 세션을 유지한다', async () => {
  allow();
  await seen();
  const screen = await render(<Rig />);
  const camera = () => screen.getByTestId('native-verification-camera');
  await waitFor(() => expect(camera()).toBeTruthy());
  const receive = camera().props.onDetection;
  const button = () => screen.getByRole('button', { name: '카메라 미리보기' });
  await fireEvent.press(button());
  expect(screen.getByTestId('verification-session-preview')).toBeTruthy();
  expect(camera().props.onDetection).toBe(receive);
  await fireEvent.press(button());
  expect(screen.queryByTestId('verification-session-preview')).toBeNull();
  expect(camera().props.onDetection).toBe(receive);
  expect(camera().props.measurementEnabled).toBe(true);
  expect(screen.getAllByTestId('native-verification-camera')).toHaveLength(1);
});

test('권한을 거절하면 촬영하지 않으며 미리보기에서 설정 안내로 복구할 수 있다', async () => {
  await seen();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = await render(<Rig />);
  await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  const button = () => screen.getByRole('button', { name: '카메라 미리보기' });
  await waitFor(() => expect(button()).toBeEnabled());
  expect(screen.queryByTestId('native-verification-camera')).toBeNull();
  await fireEvent.press(button());
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      '설정에서 카메라를 허용해 주세요',
      undefined,
      expect.any(Array),
    ),
  );
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('native-verification-camera')).toBeNull();
  await background('background');
  allow();
  await background('active');
  await waitFor(() => expect(screen.getByTestId('native-verification-camera')).toBeTruthy());
});

test('설정에서 권한을 철회하고 돌아오면 촬영과 미리보기를 해제한다', async () => {
  allow();
  await seen();
  const screen = await render(<Rig />);
  await waitFor(() => expect(screen.getByTestId('native-verification-camera')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: '카메라 미리보기' }));
  await background('background');
  permission = { ...permission, granted: false, status: 'denied' as Permission['status'] };
  await background('active');
  await waitFor(() => expect(screen.queryByTestId('native-verification-camera')).toBeNull());
  expect(screen.queryByTestId('verification-session-preview')).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
});

test('권한 대화상자의 inactive와 복귀가 겹쳐도 요청을 중복 호출하지 않는다', async () => {
  await seen();
  let resolve!: (result: Permission) => void;
  requestPermission.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const screen = await render(<Rig />);
  await waitFor(() => expect(requestPermission).toHaveBeenCalledTimes(1));
  await background('inactive');
  await background('active');
  await waitFor(() => expect(getPermission).toHaveBeenCalledTimes(2));
  allow();
  await act(async () => resolve(permission));
  await waitFor(() => expect(screen.getByTestId('native-verification-camera')).toBeTruthy());
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

test('새 계정의 안내 확인 전에는 이전 계정의 늦은 권한 응답으로 측정하지 않는다', async () => {
  await seen();
  let resolve!: (result: Permission) => void;
  getPermission.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const onMeasurementChange = jest.fn();
  const onPreviewChange = jest.fn();
  const ui = () => (
    <VerificationControls
      intro="automatic"
      onMeasurementChange={onMeasurementChange}
      onPreviewChange={onPreviewChange}
    />
  );
  const screen = await render(ui());
  await waitFor(() => expect(getPermission).toHaveBeenCalledTimes(1));
  owner = 'new-account';
  generation++;
  await screen.rerender(ui());
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  allow();
  await act(async () => resolve(permission));
  expect(onMeasurementChange).not.toHaveBeenCalledWith(true);
  expect(onPreviewChange).not.toHaveBeenCalledWith(true);
  expect(getPermission).toHaveBeenCalledTimes(1);
});

test('화면을 떠난 뒤 도착한 권한 응답은 촬영을 켜지 않는다', async () => {
  await seen();
  let resolve!: (result: Permission) => void;
  getPermission.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const onMeasurementChange = jest.fn();
  const onPreviewChange = jest.fn();
  const screen = await render(
    <VerificationControls
      onMeasurementChange={onMeasurementChange}
      onPreviewChange={onPreviewChange}
    />,
  );
  await waitFor(() => expect(getPermission).toHaveBeenCalled());
  await screen.unmount();
  allow();
  await act(async () => resolve(permission));
  expect(onMeasurementChange).not.toHaveBeenCalledWith(true);
  expect(onPreviewChange).not.toHaveBeenCalledWith(true);
});

test('다른 안내가 표시 중이면 최초 안내와 권한 요청을 보류하고 다시 표시한다', async () => {
  const screen = await render(<Rig intro={false} />);
  expect(screen.queryByTestId('verification-intro')).toBeNull();
  expect(getPermission).not.toHaveBeenCalled();
  await screen.rerender(<Rig intro />);
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  expect(getPermission).not.toHaveBeenCalled();
});

test('사용 계측은 자동 측정임을 구분하고 미리보기만 닫아도 ON을 유지한다', async () => {
  allow();
  await seen();
  const screen = await render(<Rig />);
  await waitFor(() => expect(screen.getByTestId('native-verification-camera')).toBeTruthy());
  const button = () => screen.getByRole('button', { name: '카메라 미리보기' });
  await fireEvent.press(button());
  await fireEvent.press(button());
  const last = jest.mocked(captureProductEvent).mock.calls.at(-1)!;
  expect(last).toEqual([
    'focus_verification_state_observed',
    expect.objectContaining({
      measurement_mode: 'automatic',
      measurement_state: 'on',
      preview_state: 'closed',
      measurement_changed: 0,
      preview_changed: 1,
    }),
  ]);
  expect(JSON.stringify(last)).not.toMatch(/verifiedSeconds|verifiedMs|frame|detection/);
});
