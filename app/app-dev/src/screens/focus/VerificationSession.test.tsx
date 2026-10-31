import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { componentTokens } from '@/design-system/tokens';
import { VerificationSession } from './VerificationSession';
import {
  clearVerificationResult,
  verificationResult,
} from '@/services/studyVerification/sessionResult';

jest.mock('./VerificationCamera', () => ({
  PREVIEW_STALE_MS: 2_000,
  VerificationCamera: ({ active, ...props }: { active: boolean }) =>
    active
      ? require('react').createElement(require('react-native').View, {
          ...props,
          testID: 'live-camera',
        })
      : null,
}));

beforeEach(() => {
  clearVerificationResult('session');
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function focusedSeconds(screen: Awaited<ReturnType<typeof render>>, seconds: number) {
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  for (let n = 0; n < seconds; n++) {
    await act(async () => jest.advanceTimersByTime(1000));
    await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  }
}

test('미리보기 없이도 측정 중 표시를 유지하고 손 미검출을 집중 판정 문구로 노출하지 않는다', async () => {
  const screen = await render(<VerificationSession sessionId="session" enabled />);
  expect(screen.getByText('측정 준비 중')).toBeTruthy();
  expect(screen.queryByText('측정 중')).toBeNull();
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'missingHand');
  expect(screen.getByText('측정 중')).toBeTruthy();
  expect(screen.getByTestId('verification-measurement-dot')).toHaveStyle({
    backgroundColor: componentTokens.verificationSetup.measurementColor,
  });
  expect(screen.queryByText('손이 보이지 않아요.')).toBeNull();
  expect(screen.queryByTestId('verification-session-preview')).toBeNull();
  await act(async () => jest.advanceTimersByTime(20_000));
  expect(screen.getByText('측정 중')).toBeTruthy();
  await screen.rerender(<VerificationSession sessionId="session" enabled previewVisible />);
  expect(screen.getByText('측정 중')).toBeTruthy();
  await screen.rerender(<VerificationSession sessionId="session" enabled />);
  expect(screen.getByText('측정 중')).toBeTruthy();
});

test('OFF·오류·백그라운드에서는 측정 중 표시를 없애고 준비·판정 불가는 빨간 점으로 표시하지 않는다', async () => {
  const screen = await render(<VerificationSession sessionId="session" enabled />);
  const listener = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  expect(screen.getByText('측정 중')).toBeTruthy();
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'unavailable');
  expect(screen.queryByText('측정 중')).toBeNull();
  expect(screen.getByTestId('verification-measurement-dot')).toHaveStyle({
    backgroundColor: componentTokens.verificationSetup.waitingColor,
  });
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await act(async () => listener('background'));
  expect(screen.queryByTestId('verification-measurement-indicator')).toBeNull();
  await act(async () => listener('active'));
  expect(screen.getByText('측정 준비 중')).toBeTruthy();
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'error', new Error('camera unavailable'));
  expect(screen.queryByTestId('verification-measurement-indicator')).toBeNull();
  await screen.rerender(<VerificationSession sessionId="session" enabled={false} previewVisible />);
  expect(screen.queryByTestId('verification-measurement-indicator')).toBeNull();
  expect(screen.queryByText('측정 중')).toBeNull();
});

test('20초 미만도 실제 확인된 초를 합산하고 껐다 켜도 꺼진 시간을 더하지 않는다', async () => {
  const screen = await render(<VerificationSession previewVisible sessionId="session" enabled />);
  await focusedSeconds(screen, 3);
  expect(verificationResult('session')).toBe(3);
  const lateDetection = screen.getByTestId('live-camera').props.onDetection;
  await screen.rerender(<VerificationSession sessionId="session" enabled={false} />);
  expect(screen.queryByTestId('live-camera')).toBeNull();
  await act(async () => {
    lateDetection('focused');
    jest.advanceTimersByTime(60_000);
  });
  expect(verificationResult('session')).toBe(3);
  await screen.rerender(<VerificationSession previewVisible sessionId="session" enabled />);
  expect(verificationResult('session')).toBe(3);
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await focusedSeconds(screen, 3);
  expect(verificationResult('session')).toBe(6);
});

test('휴식으로 화면이 해제돼도 같은 세션으로 돌아오면 누적 시간을 이어서 결과에 넘긴다', async () => {
  const screen = await render(<VerificationSession previewVisible sessionId="session" enabled />);
  await focusedSeconds(screen, 2);
  await screen.unmount();
  await act(async () => jest.advanceTimersByTime(60_000));
  const resumed = await render(<VerificationSession previewVisible sessionId="session" enabled />);
  expect(verificationResult('session')).toBe(2);
  await focusedSeconds(resumed, 2);
  expect(verificationResult('session', 64)).toBe(4);
  await resumed.unmount();
  expect(verificationResult('session', 64)).toBe(4);
});

test('준비 전·오래된 성공·실패 판정은 인증으로 세지 않는다', async () => {
  const screen = await render(<VerificationSession previewVisible sessionId="session" enabled />);
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await act(async () => jest.advanceTimersByTime(20_000));
  expect(verificationResult('session')).toBe(0);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await act(async () => jest.advanceTimersByTime(20_000));
  expect(verificationResult('session')).toBe(0);
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'missingHand');
  await act(async () => jest.advanceTimersByTime(20_000));
  expect(verificationResult('session')).toBe(0);
});

test('백그라운드에서는 촬영을 해제하고 복귀 후 새 판정을 기다린다', async () => {
  const screen = await render(
    <VerificationSession previewVisible sessionId="session" enabled cameraPosition="front" />,
  );
  const listener = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await act(async () => listener('background'));
  expect(screen.queryByTestId('live-camera')).toBeNull();
  await act(async () => jest.advanceTimersByTime(60_000));
  await act(async () => listener('active'));
  expect(screen.getByTestId('live-camera').props.position).toBe('front');
  expect(verificationResult('session')).toBe(0);
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
});

test('촬영 오류는 성공 표시와 캡처를 해제하며 인증에 더하지 않는다', async () => {
  const screen = await render(<VerificationSession previewVisible sessionId="session" enabled />);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await fireEvent(screen.getByTestId('live-camera'), 'error', new Error('unavailable'));
  expect(screen.queryByTestId('live-camera')).toBeNull();
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await act(async () => jest.advanceTimersByTime(20_000));
  expect(verificationResult('session')).toBe(0);
});

test('집중 전 미리보기는 손을 확인해도 인증 시간을 결과에 남기지 않는다', async () => {
  const screen = await render(<VerificationSession previewVisible enabled />);
  await focusedSeconds(screen, 3);
  expect(screen.getByText('집중 확인 완료')).toBeTruthy();
  expect(screen.queryByText(/인증 00:/)).toBeNull();
  expect(verificationResult('session')).toBeUndefined();
});

test('미리보기가 닫혀 있어도 측정 스위치가 켜져 있으면 인증 시간을 누적한다', async () => {
  const screen = await render(
    <VerificationSession sessionId="session" enabled previewVisible={false} />,
  );
  expect(screen.queryByTestId('verification-session-preview')).toBeNull();
  expect(screen.getByTestId('live-camera').props.previewVisible).toBe(false);
  await focusedSeconds(screen, 3);
  expect(verificationResult('session')).toBe(3);
});

test('미리보기를 열고 닫아도 같은 촬영과 연속 판정을 유지한다', async () => {
  const screen = await render(
    <VerificationSession sessionId="session" enabled previewVisible={false} />,
  );
  await focusedSeconds(screen, 2);
  const receive = screen.getByTestId('live-camera').props.onDetection;
  await screen.rerender(<VerificationSession sessionId="session" enabled previewVisible />);
  expect(screen.getByTestId('live-camera').props.onDetection).toBe(receive);
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await act(async () => jest.advanceTimersByTime(1000));
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await screen.rerender(<VerificationSession sessionId="session" enabled previewVisible={false} />);
  await act(async () => jest.advanceTimersByTime(1000));
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  expect(verificationResult('session')).toBe(4);
});

test('측정을 끄고 영상만 봐도 사용으로 기록하지 않고 다시 켜면 이후 프레임만 누적한다', async () => {
  const screen = await render(
    <VerificationSession sessionId="session" enabled={false} previewVisible />,
  );
  expect(screen.getByTestId('live-camera').props.measurementEnabled).toBe(false);
  await focusedSeconds(screen, 3);
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  expect(verificationResult('session')).toBeUndefined();
  await screen.rerender(<VerificationSession sessionId="session" enabled previewVisible />);
  expect(screen.getByTestId('live-camera').props.measurementEnabled).toBe(true);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await act(async () => jest.advanceTimersByTime(1000));
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  expect(verificationResult('session')).toBe(1);
  const lateReady = screen.getByTestId('live-camera').props.onReady;
  const lateDetection = screen.getByTestId('live-camera').props.onDetection;
  await screen.rerender(<VerificationSession sessionId="session" enabled={false} previewVisible />);
  expect(screen.getByTestId('live-camera').props.measurementEnabled).toBe(false);
  await act(async () => {
    lateReady();
    lateDetection('focused');
  });
  await act(async () => jest.advanceTimersByTime(1000));
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  expect(verificationResult('session')).toBe(1);
});

test('집중 전 측정을 끄면 영상은 남지만 판정 안내와 불빛은 숨긴다', async () => {
  const screen = await render(<VerificationSession enabled previewVisible />);
  await focusedSeconds(screen, 1);
  expect(screen.getByText('집중 확인 완료')).toBeTruthy();
  await screen.rerender(<VerificationSession enabled={false} previewVisible />);
  expect(screen.getByTestId('verification-session-preview')).toBeTruthy();
  expect(screen.getByTestId('live-camera').props.measurementEnabled).toBe(false);
  expect(screen.queryByTestId('verification-session-light')).toBeNull();
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  expect(screen.queryByText('집중 확인 중…')).toBeNull();
});

test.each([true, false])(
  '촬영 오류에서 같은 카메라로 재시도하고 기존 시간과 미리보기 선택을 보존한다: preview=%s',
  async (previewVisible) => {
    const screen = await render(
      <VerificationSession
        sessionId="session"
        enabled
        previewVisible={previewVisible}
        cameraPosition="front"
      />,
    );
    await focusedSeconds(screen, 3);
    const previous = screen.getByTestId('live-camera').props;
    await fireEvent(screen.getByTestId('live-camera'), 'error', new Error('camera unavailable'));
    expect(screen.queryByTestId('live-camera')).toBeNull();
    expect(screen.getByText('카메라를 사용할 수 없어요.')).toBeTruthy();
    await act(async () => {
      previous.onReady();
      previous.onDetection('focused');
      jest.advanceTimersByTime(60_000);
    });
    expect(verificationResult('session')).toBe(3);
    await fireEvent.press(screen.getByRole('button', { name: '카메라 다시 시도' }));
    expect(screen.queryByText('카메라를 사용할 수 없어요.')).toBeNull();
    expect(screen.getByTestId('live-camera').props).toMatchObject({
      position: 'front',
      previewVisible,
      measurementEnabled: true,
    });
    await act(async () => {
      previous.onReady();
      previous.onDetection('focused');
      previous.onError(new Error('late camera error'));
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('live-camera')).toBeTruthy();
    expect(verificationResult('session')).toBe(3);
    await focusedSeconds(screen, 2);
    expect(verificationResult('session')).toBe(5);
    expect(screen.queryByTestId('verification-session-light')).toBeNull();
  },
);

test('시작 전 오류 재시도는 새 판정을 기다리고 영상만 볼 때 재시도해도 측정을 켜지 않는다', async () => {
  const screen = await render(<VerificationSession enabled previewVisible />);
  await focusedSeconds(screen, 1);
  await fireEvent(screen.getByTestId('live-camera'), 'error', new Error('camera unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: '카메라 다시 시도' }));
  expect(screen.getByText('집중 확인 중…')).toBeTruthy();
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await focusedSeconds(screen, 1);
  expect(screen.getByText('집중 확인 완료')).toBeTruthy();
  await screen.rerender(<VerificationSession enabled={false} previewVisible />);
  await fireEvent(screen.getByTestId('live-camera'), 'error', new Error('camera unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: '카메라 다시 시도' }));
  expect(screen.getByTestId('live-camera').props.measurementEnabled).toBe(false);
  expect(screen.queryByTestId('verification-session-light')).toBeNull();
  expect(verificationResult('session')).toBeUndefined();
});

test('집중 전 영상 확인만 실시간이고 집중 중에는 영상 표시와 관계없이 정기 검사한다', async () => {
  const screen = await render(<VerificationSession enabled previewVisible />);
  expect(screen.getByTestId('live-camera').props.cadence).toBe('live');
  await screen.rerender(<VerificationSession enabled previewVisible={false} />);
  expect(screen.getByTestId('live-camera').props.cadence).toBe('periodic');
  await screen.rerender(<VerificationSession sessionId="session" enabled previewVisible />);
  expect(screen.getByTestId('live-camera').props.cadence).toBe('periodic');
  await screen.rerender(<VerificationSession sessionId="session" enabled previewVisible={false} />);
  expect(screen.getByTestId('live-camera').props.cadence).toBe('periodic');
});

test('정기 확인 뒤 검사 사이에도 시간을 세며 카메라가 쉬는 중 종료한 짧은 구간도 보존한다', async () => {
  const screen = await render(<VerificationSession sessionId="session" enabled previewVisible />);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  await act(async () => jest.advanceTimersByTime(7000));
  expect(verificationResult('session')).toBe(7);
  await screen.unmount();
  expect(verificationResult('session')).toBe(7);
  await act(async () => jest.advanceTimersByTime(30000));
  expect(verificationResult('session')).toBe(7);
});

test('집중 중 미리보기에는 판정 불빛·문구·인증 숫자를 표시하지 않고 측정은 계속한다', async () => {
  const screen = await render(<VerificationSession sessionId="session" enabled previewVisible />);
  await focusedSeconds(screen, 3);
  expect(screen.getByTestId('verification-session-preview')).toBeTruthy();
  expect(screen.queryByTestId('verification-session-light')).toBeNull();
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  expect(screen.queryByText('집중 확인 중…')).toBeNull();
  expect(screen.queryByText(/인증 00:/)).toBeNull();
  expect(verificationResult('session')).toBe(3);
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'missingHand');
  await act(async () => jest.advanceTimersByTime(5000));
  expect(verificationResult('session')).toBe(3);
  expect(screen.queryByTestId('verification-session-light')).toBeNull();
});

test('보조 물체는 시작 전 미리보기에만 표시하고 물체만으로 초록불을 켜지 않는다', async () => {
  const screen = await render(<VerificationSession previewVisible enabled />);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'missingHand');
  await fireEvent(screen.getByTestId('live-camera'), 'studyObjects', {
    book: true,
    laptop: false,
    keyboard: true,
  });
  expect(screen.getByText('책 · 키보드 감지')).toBeTruthy();
  expect(screen.queryByText('집중 확인 완료')).toBeNull();
  await screen.rerender(<VerificationSession previewVisible enabled sessionId="session" />);
  expect(screen.queryByText('책 · 키보드 감지')).toBeNull();
  expect(verificationResult('session')).toBe(0);
});

test('시작 전 안내는 손 → 공부 도구 → 완료 순서로 하나씩 바뀐다', async () => {
  const screen = await render(<VerificationSession previewVisible enabled />);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'missingHand');
  expect(screen.getByText('손이 보이지 않아요.')).toBeTruthy();
  expect(screen.queryByText('노트북/책이 보이지 않아요.')).toBeNull();
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'missingObject');
  expect(screen.queryByText('손이 보이지 않아요.')).toBeNull();
  expect(screen.getByText('노트북/책이 보이지 않아요.')).toBeTruthy();
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  expect(screen.queryByText('노트북/책이 보이지 않아요.')).toBeNull();
  expect(screen.getByText('집중 확인 완료')).toBeTruthy();
});

test.each(['missingHand', 'missingObject'])(
  '집중 중에는 구체적인 미검출 안내도 숨긴다: %s',
  async (detection) => {
    const screen = await render(<VerificationSession previewVisible enabled sessionId="session" />);
    await fireEvent(screen.getByTestId('live-camera'), 'ready');
    await fireEvent(screen.getByTestId('live-camera'), 'detection', detection);
    expect(screen.queryByText('손이 보이지 않아요.')).toBeNull();
    expect(screen.queryByText('노트북/책이 보이지 않아요.')).toBeNull();
    expect(verificationResult('session')).toBe(0);
  },
);

test('집중 확인 완료 아래에는 감지된 물체 문구를 표시하지 않는다', async () => {
  const screen = await render(<VerificationSession previewVisible enabled />);
  await fireEvent(screen.getByTestId('live-camera'), 'ready');
  await fireEvent(screen.getByTestId('live-camera'), 'studyObjects', {
    book: false,
    laptop: true,
    keyboard: false,
  });
  await fireEvent(screen.getByTestId('live-camera'), 'detection', 'focused');
  expect(screen.getByText('집중 확인 완료')).toBeTruthy();
  expect(screen.queryByText('노트북 감지')).toBeNull();
  await fireEvent(screen.getByTestId('live-camera'), 'studyObjects', {
    book: true,
    laptop: true,
    keyboard: true,
  });
  expect(screen.queryByText(/감지$/)).toBeNull();
});
