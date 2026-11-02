import { useState } from 'react';
import { VerificationSession } from './VerificationSession';
import * as sessionApi from '@/services/api/session';
import { readAccountGuides } from '@/services/accountGuides';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Linking } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import { VerificationSetup } from './VerificationSetup';
import { VerificationToggle } from './VerificationSpike';
import { componentTokens } from '@/design-system/tokens';
import { captureProductEvent } from '@/services/posthog';

jest.mock('@/services/posthog', () => ({ captureProductEvent: jest.fn() }));

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

test('측정 ON에서 미리보기만 열고 닫으며 측정 설정을 바꾸지 않는다', async () => {
  request.mockImplementation(async () => {
    allow();
    return permission;
  });
  const onChange = jest.fn();
  const onPreviewChange = jest.fn();
  const screen = await render(
    <VerificationToggle on onChange={onChange} onPreviewChange={onPreviewChange} />,
  );
  onPreviewChange.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(true));
  expect(request).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByTestId('verification-camera-card')).toBeNull();
  await screen.rerender(
    <VerificationToggle on onChange={onChange} onPreviewChange={onPreviewChange} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  expect(onPreviewChange).toHaveBeenLastCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
});

test.each([false, true])(
  '집중 중=%s: OFF에서는 안내만 보이고 사용자가 스위치를 켜야 미리보기를 열 수 있다',
  async (inSession) => {
    allow();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest
      .spyOn(sessionApi, 'getSession')
      .mockReturnValue({ userId: 'analytics-user' } as ReturnType<typeof sessionApi.getSession>);
    function Rig() {
      const [on, setOn] = useState(false);
      const [preview, setPreview] = useState(false);
      return (
        <>
          <VerificationSession
            sessionId={inSession ? 'preview-on' : undefined}
            enabled={on}
            previewVisible={preview}
            cameraPosition="front"
          />
          <VerificationToggle
            inSession={inSession}
            on={on}
            cameraPosition="front"
            onChange={setOn}
            onPreviewChange={setPreview}
          />
        </>
      );
    }
    const screen = await render(<Rig />);
    const previewButton = () => screen.getByRole('button', { name: '카메라 인증' });
    const measurementSwitch = () => screen.getByRole('switch', { name: '카메라 인증 사용' });
    expect(measurementSwitch()).not.toBeChecked();
    await fireEvent.press(previewButton());
    expect(alert).toHaveBeenCalledWith('측정을 켜주세요');
    expect(measurementSwitch()).not.toBeChecked();
    expect(screen.queryByTestId('verification-session-preview')).toBeNull();
    expect(getPermission).not.toHaveBeenCalled();
    expect(captureProductEvent).toHaveBeenCalledTimes(1);
    await fireEvent.press(measurementSwitch());
    await waitFor(() => expect(measurementSwitch()).toBeChecked());
    expect(screen.queryByTestId('verification-session-preview')).toBeNull();
    await fireEvent.press(previewButton());
    await waitFor(() => expect(screen.getByTestId('verification-session-preview')).toBeTruthy());
    expect(screen.getByTestId('verification-session-preview')).toBeTruthy();
    await fireEvent.press(measurementSwitch());
    expect(measurementSwitch()).not.toBeChecked();
    expect(screen.getByTestId('verification-camera-preview').props.measurementEnabled).toBe(false);
    // 측정을 끈 뒤 이미 열린 영상은 닫을 수 있지만 다시 열 때는 안내한다.
    await fireEvent.press(previewButton());
    expect(screen.queryByTestId('verification-session-preview')).toBeNull();
    expect(measurementSwitch()).not.toBeChecked();
    const eventsBeforeBlockedPreview = jest.mocked(captureProductEvent).mock.calls.length;
    await fireEvent.press(previewButton());
    expect(alert).toHaveBeenCalledTimes(2);
    expect(captureProductEvent).toHaveBeenCalledTimes(eventsBeforeBlockedPreview);
    await fireEvent.press(measurementSwitch());
    await waitFor(() => expect(measurementSwitch()).toBeChecked());
    await fireEvent.press(previewButton());
    await waitFor(() => expect(screen.getByTestId('verification-session-preview')).toBeTruthy());
    expect(screen.getByTestId('verification-session-preview')).toBeTruthy();
    expect(screen.getByTestId('verification-camera-preview').props).toMatchObject({
      measurementEnabled: true,
      position: 'front',
    });
    await fireEvent.press(previewButton());
    expect(screen.queryByTestId('verification-session-preview')).toBeNull();
    expect(measurementSwitch()).toBeChecked();
    expect(request).not.toHaveBeenCalled();
    expect(jest.mocked(captureProductEvent).mock.calls).toEqual(
      [
        ['off', 'closed', 'screen_opened', 0, 0],
        ['on', 'closed', 'state_changed', 1, 0],
        ['on', 'open', 'state_changed', 0, 1],
        ['off', 'open', 'state_changed', 1, 0],
        ['off', 'closed', 'state_changed', 0, 1],
        ['on', 'closed', 'state_changed', 1, 0],
        ['on', 'open', 'state_changed', 0, 1],
        ['on', 'closed', 'state_changed', 0, 1],
      ].map(([measurement, preview, reason, measurementChanged, previewChanged]) => [
        'focus_verification_state_observed',
        {
          analytics_schema_version: 1,
          focus_location: 'fishing_island',
          focus_phase: inSession ? 'focusing' : 'before_focus',
          measurement_state: measurement,
          preview_state: preview,
          measurement_changed: measurementChanged,
          preview_changed: previewChanged,
          observation_reason: reason,
        },
      ]),
    );
  },
);

test('아무 조작도 하지 않은 OFF 상태와 집중 화면 진입을 관측하고 일반 재렌더·카메라 방향 변경은 중복 전송하지 않는다', async () => {
  jest
    .spyOn(sessionApi, 'getSession')
    .mockReturnValue({ userId: 'analytics-user' } as ReturnType<typeof sessionApi.getSession>);
  const screen = await render(<VerificationToggle on={false} onChange={jest.fn()} />);
  expect(captureProductEvent).toHaveBeenCalledTimes(1);
  expect(captureProductEvent).toHaveBeenLastCalledWith('focus_verification_state_observed', {
    analytics_schema_version: 1,
    focus_location: 'fishing_island',
    focus_phase: 'before_focus',
    measurement_state: 'off',
    preview_state: 'closed',
    measurement_changed: 0,
    preview_changed: 0,
    observation_reason: 'screen_opened',
  });
  await screen.rerender(
    <VerificationToggle on={false} cameraPosition="front" onChange={jest.fn()} />,
  );
  expect(captureProductEvent).toHaveBeenCalledTimes(1);
  await screen.rerender(<VerificationToggle inSession on={false} onChange={jest.fn()} />);
  expect(captureProductEvent).toHaveBeenCalledTimes(2);
  expect(jest.mocked(captureProductEvent).mock.calls[1]![1]).toMatchObject({
    focus_phase: 'focusing',
    measurement_state: 'off',
    observation_reason: 'screen_opened',
  });
  expect(getPermission).not.toHaveBeenCalled();
});

test('측정 ON이어도 미리보기 권한 거절은 열림으로 계측하지 않는다', async () => {
  jest
    .spyOn(sessionApi, 'getSession')
    .mockReturnValue({ userId: 'analytics-user' } as ReturnType<typeof sessionApi.getSession>);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = await render(<VerificationToggle on onChange={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(captureProductEvent).toHaveBeenCalledTimes(1);
  expect(jest.mocked(captureProductEvent).mock.calls[0]![1]).toMatchObject({
    measurement_state: 'on',
    preview_state: 'closed',
  });
});

test('미리보기 권한 응답을 기다리는 중 측정이 OFF되면 늦은 허용 응답으로 영상을 열지 않는다', async () => {
  let resolvePermission!: (value: Permission) => void;
  getPermission.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePermission = resolve;
    }),
  );
  const onChange = jest.fn();
  const onPreviewChange = jest.fn();
  const screen = await render(
    <VerificationToggle on onChange={onChange} onPreviewChange={onPreviewChange} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await screen.rerender(
    <VerificationToggle on={false} onChange={onChange} onPreviewChange={onPreviewChange} />,
  );
  allow();
  await act(async () => resolvePermission(permission));
  expect(onPreviewChange).not.toHaveBeenCalledWith(true);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: '카메라 인증 사용' })).not.toBeChecked();
});

test('계정 전환에서는 이전 계정의 열린 영상을 새 계정의 미리보기 사용으로 전송하지 않는다', async () => {
  allow();
  let owner = 'account-a';
  jest
    .spyOn(sessionApi, 'getSession')
    .mockImplementation(() => ({ userId: owner }) as ReturnType<typeof sessionApi.getSession>);
  const screen = await render(<VerificationToggle on onChange={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(jest.mocked(captureProductEvent).mock.calls.at(-1)![1]).toMatchObject({
    measurement_state: 'on',
    preview_state: 'open',
  });
  jest.mocked(captureProductEvent).mockClear();
  owner = 'account-b';
  await screen.rerender(<VerificationToggle on={false} onChange={jest.fn()} />);
  expect(captureProductEvent).toHaveBeenCalledTimes(1);
  expect(jest.mocked(captureProductEvent).mock.calls[0]![1]).toEqual({
    analytics_schema_version: 1,
    focus_location: 'fishing_island',
    focus_phase: 'before_focus',
    measurement_state: 'off',
    preview_state: 'closed',
    measurement_changed: 0,
    preview_changed: 0,
    observation_reason: 'screen_opened',
  });
});

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

test('측정이 켜져 있어도 카메라 버튼은 영상 표시만 토글한다', async () => {
  allow();
  const onChange = jest.fn();
  const onPreviewChange = jest.fn();
  const screen = await render(
    <VerificationToggle on onChange={onChange} onPreviewChange={onPreviewChange} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(onPreviewChange).toHaveBeenLastCalledWith(true));
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  expect(onPreviewChange).toHaveBeenLastCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
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

test.each([false, true])(
  '집중 여부 %s와 관계없이 스위치로 즉시 끄고 다시 켜며 설정 모달을 열지 않는다',
  async (inSession) => {
    allow();
    const onChange = jest.fn();
    const screen = await render(
      <VerificationToggle inSession={inSession} on cameraPosition="front" onChange={onChange} />,
    );
    await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
    expect(onChange).toHaveBeenLastCalledWith(false, 'front');
    expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
    await screen.rerender(
      <VerificationToggle
        inSession={inSession}
        on={false}
        cameraPosition="front"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(true, 'front'));
    expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  },
);

test('스위치는 OS 권한을 승인해야 켜지고 거절하면 꺼진 상태와 설정 안내를 유지한다', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onChange = jest.fn();
  const screen = await render(<VerificationToggle inSession on={false} onChange={onChange} />);
  await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(request).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: '카메라 인증 사용' })).not.toBeChecked();
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
});

test('스위치 아래 AI집중측정은 검정 글씨만 표시한다', async () => {
  const screen = await render(<VerificationToggle on={false} onChange={jest.fn()} />);
  expect(screen.getByText('AI집중측정')).toHaveStyle({ color: '#000000' });
});

test('안내에는 닫기만 있고 닫은 뒤에도 촬영·권한·인증 설정을 건드리지 않는다', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onChange = jest.fn();
  const screen = await render(
    <VerificationToggle intro="automatic" on={false} onChange={onChange} />,
  );
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  expect(screen.queryByRole('button', { name: '카메라 켜보기' })).toBeNull();
  expect(screen.queryByRole('button', { name: '나중에' })).toBeNull();
  expect(screen.getByText('켜기 · 끄기')).toBeTruthy();
  expect(screen.getByText('미리보기를 꺼도,\n측정이 켜져 있으면 계속 측정해요.')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByTestId('verification-intro')).toBeNull();
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  // 미리보기는 OFF 안내만 띄우며 사용자가 스위치를 켜야 권한 요청으로 간다.
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  expect(alert).toHaveBeenCalledWith('측정을 켜주세요');
  expect(request).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
  await waitFor(() => expect(request).toHaveBeenCalled());
});

test('안내 확인 후 화면을 다시 열거나 재로그인해도 반복하지 않고 다른 계정은 별도로 안내한다', async () => {
  await AsyncStorage.clear();
  let owner = 'intro-alice';
  let generation = 1;
  jest
    .spyOn(sessionApi, 'getSession')
    .mockImplementation(() => ({ userId: owner }) as ReturnType<typeof sessionApi.getSession>);
  jest.spyOn(sessionApi, 'sessionGeneration').mockImplementation(() => generation);
  const onChange = jest.fn();
  const ui = () => <VerificationToggle intro="automatic" on={false} onChange={onChange} />;
  const first = await render(ui());
  await waitFor(() => expect(first.getByTestId('verification-intro')).toBeTruthy());
  await fireEvent.press(first.getByRole('button', { name: '닫기' }));
  expect((await readAccountGuides(owner)).verificationIntroSeen).toBe(true);
  await first.unmount();
  generation++;
  const next = await render(ui());
  await waitFor(() => expect(next.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(next.queryByTestId('verification-intro')).toBeNull();
  owner = 'intro-bob';
  generation++;
  await next.rerender(ui());
  await waitFor(() => expect(next.getByTestId('verification-intro')).toBeTruthy());
  expect((await readAccountGuides(owner)).verificationIntroSeen).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});

test('다른 안내로 표시가 보류돼도 열람으로 저장하지 않고 조건이 돌아오면 다시 안내한다', async () => {
  const owner = 'intro-deferred';
  jest
    .spyOn(sessionApi, 'getSession')
    .mockReturnValue({ userId: owner } as ReturnType<typeof sessionApi.getSession>);
  const onChange = jest.fn();
  const screen = await render(
    <VerificationToggle intro="automatic" on={false} onChange={onChange} />,
  );
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  await screen.rerender(<VerificationToggle on={false} onChange={onChange} />);
  expect(screen.queryByTestId('verification-intro')).toBeNull();
  expect((await readAccountGuides(owner)).verificationIntroSeen).toBeUndefined();
  await screen.rerender(<VerificationToggle intro="automatic" on={false} onChange={onChange} />);
  await waitFor(() => expect(screen.getByTestId('verification-intro')).toBeTruthy());
  expect(request).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});

test('집중 중 미리보기를 열고 닫아도 네이티브 카메라는 항상 하나만 마운트된다', async () => {
  allow();
  function Rig() {
    const [on, setOn] = useState(true);
    const [preview, setPreview] = useState(false);
    return (
      <>
        <VerificationSession sessionId="single-camera" enabled={on} previewVisible={preview} />
        <VerificationToggle inSession on={on} onChange={setOn} onPreviewChange={setPreview} />
      </>
    );
  }
  const screen = await render(<Rig />);
  expect(screen.getAllByTestId('verification-camera-preview')).toHaveLength(1);
  expect(screen.getByTestId('verification-camera-preview').props.previewVisible).toBe(false);
  const receive = screen.getByTestId('verification-camera-preview').props.onDetection;
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(screen.getByTestId('verification-session')).toBeTruthy();
  expect(screen.getByTestId('verification-camera-preview').props.onDetection).toBe(receive);
  expect(screen.getAllByTestId('verification-camera-preview')).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(screen.getByTestId('verification-session')).toBeTruthy();
  expect(screen.getByTestId('verification-camera-preview').props.onDetection).toBe(receive);
  expect(screen.getAllByTestId('verification-camera-preview')).toHaveLength(1);
  await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
});

test('처음 스위치를 켜도 안내만 먼저 보이고 닫기에서 권한·촬영으로 이어지지 않는다', async () => {
  request.mockImplementation(async () => {
    allow();
    return permission;
  });
  const onChange = jest.fn();
  const screen = await render(
    <VerificationToggle intro="onPress" on={false} onChange={onChange} />,
  );
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '카메라 인증 사용' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
  expect(screen.getByTestId('verification-intro')).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: '닫기' }));
  expect(onChange).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(true, 'back'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('verification-camera-preview')).toBeNull();
});

test('미리보기 권한을 거절하면 측정 설정을 바꾸지 않고 영상도 열지 않는다', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const onChange = jest.fn();
  const onPreviewChange = jest.fn();
  const screen = await render(
    <VerificationToggle on onChange={onChange} onPreviewChange={onPreviewChange} />,
  );
  onPreviewChange.mockClear();
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(onChange).not.toHaveBeenCalled();
  expect(onPreviewChange).not.toHaveBeenCalledWith(true);
});
