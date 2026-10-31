import { act, render } from '@testing-library/react-native';
import { useCamera, useFrameOutput, type Frame } from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { scheduleOnRN } from 'react-native-worklets';
import {
  MEASUREMENT_INTERVAL_MS,
  MEASUREMENT_STALE_MS,
} from '@/services/studyVerification/cadence';
import { PREVIEW_SAMPLE_MS, PREVIEW_STALE_MS, VerificationCamera } from './VerificationCamera';

jest.mock('../../assets/ml/palm_detection_lite.tflite', () => 1);
jest.mock('../../assets/ml/efficientdet_lite0_int8.tflite', () => 2);
jest.mock('react-native-vision-camera', () => ({
  useCamera: jest.fn(),
  usePreviewOutput: jest.fn(() => ({})),
  NativePreviewView: (props: object) =>
    require('react').createElement(require('react-native').View, {
      ...props,
      testID: 'native-camera',
    }),
  useFrameOutput: jest.fn(() => ({})),
}));

const runSync = jest.fn();
const objectRunSync = jest.fn();
const objectDispose = jest.fn();
const objectResized = {
  getPixelBuffer: jest.fn(() => new Uint8Array([255, 0, 127]).buffer),
  dispose: objectDispose,
};
const objectResize = jest.fn(() => objectResized);
const resizedDispose = jest.fn();
const resized = {
  getPixelBuffer: jest.fn(() => new Uint8Array([255, 0, 127]).buffer),
  dispose: resizedDispose,
};
const resize = jest.fn(() => resized);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-30T00:00:00Z'));
  jest.clearAllMocks();
  resized.getPixelBuffer.mockImplementation(() => new Uint8Array([255, 0, 127]).buffer);
  resize.mockImplementation(() => resized);
  objectResize.mockImplementation(() => objectResized);
  const objectScores = new Float32Array(180);
  objectScores[83] = 0.9;
  objectRunSync.mockImplementation(() => [objectScores.buffer, new Float32Array(8).buffer]);
  jest.mocked(useResizer).mockImplementation(
    (options) =>
      ({
        state: 'ready',
        resizer: { resize: options.width === 320 ? objectResize : resize },
        error: undefined,
      }) as unknown as ReturnType<typeof useResizer>,
  );
  jest.mocked(useTensorflowModel).mockReturnValue({
    state: 'loaded',
    model: {
      inputs: [{ shape: [1, 192, 192, 3], dataType: 'float32' }],
      outputs: [{ shape: [1, 2016, 18] }, { shape: [1, 2016, 1] }],
      runSync,
    },
  } as unknown as ReturnType<typeof useTensorflowModel>);
  enableObjects(objectRunSync);
});
afterEach(() => jest.useRealTimers());

async function setup(
  previewVisible = true,
  cadence: 'live' | 'periodic' = 'live',
  measurementEnabled = true,
) {
  const onReady = jest.fn();
  const onPaused = jest.fn();
  const onDetection = jest.fn();
  const onError = jest.fn();
  const onStudyObjects = jest.fn();
  const screen = await render(
    <VerificationCamera
      position="back"
      active
      measurementEnabled={measurementEnabled}
      previewVisible={previewVisible}
      cadence={cadence}
      onReady={onReady}
      onPaused={onPaused}
      onDetection={onDetection}
      onError={onError}
      onStudyObjects={onStudyObjects}
    />,
  );
  return { ...screen, onReady, onPaused, onDetection, onError, onStudyObjects };
}

test('측정 OFF에서는 미리보기 출력만 연결하고 모델·리사이저·프레임 출력·검사 타이머를 만들지 않는다', async () => {
  const screen = await setup(true, 'periodic', false);
  expect(screen.getByTestId('native-camera')).toBeTruthy();
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0]).toMatchObject({
    isActive: true,
    device: 'back',
    outputs: [{}],
  });
  expect(useTensorflowModel).not.toHaveBeenCalled();
  expect(useResizer).not.toHaveBeenCalled();
  expect(useFrameOutput).not.toHaveBeenCalled();
  const cameraCalls = jest.mocked(useCamera).mock.calls.length;
  await act(async () => jest.advanceTimersByTime(60_000));
  expect(runSync).not.toHaveBeenCalled();
  expect(objectRunSync).not.toHaveBeenCalled();
  expect(screen.onDetection).not.toHaveBeenCalled();
  expect(useCamera).toHaveBeenCalledTimes(cameraCalls);
  const error = new Error('preview unavailable');
  await act(async () => jest.mocked(useCamera).mock.calls.at(-1)![0].onError!(error));
  expect(screen.onError).toHaveBeenCalledWith(error);
});

test('측정과 미리보기가 모두 OFF이면 카메라도 구성하지 않는다', async () => {
  const screen = await setup(false, 'periodic', false);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(useCamera).not.toHaveBeenCalled();
  expect(useTensorflowModel).not.toHaveBeenCalled();
  expect(useFrameOutput).not.toHaveBeenCalled();
});

test('영상이 열린 상태에서 측정을 끄면 검사 타이머와 늦은 결과를 버리고 다시 켜면 새 3장으로 시작한다', async () => {
  const screen = await setup(true, 'periodic');
  let deliver: (() => void) | undefined;
  jest.mocked(scheduleOnRN).mockImplementationOnce(((
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => {
    deliver = () => fn(...args);
  }) as typeof scheduleOnRN);
  await sample(4);
  await sample(4);
  await sample(4);
  const props = {
    position: 'back' as const,
    active: true,
    previewVisible: true,
    cadence: 'periodic' as const,
    onReady: screen.onReady,
    onPaused: screen.onPaused,
    onDetection: screen.onDetection,
    onError: screen.onError,
  };
  await screen.rerender(<VerificationCamera {...props} measurementEnabled={false} />);
  screen.onDetection.mockClear();
  const cameraCalls = jest.mocked(useCamera).mock.calls.length;
  await act(async () => {
    deliver!();
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId('native-camera')).toBeTruthy();
  expect(runSync).toHaveBeenCalledTimes(3);
  expect(objectRunSync).toHaveBeenCalledTimes(3);
  expect(screen.onDetection).not.toHaveBeenCalled();
  expect(useCamera).toHaveBeenCalledTimes(cameraCalls);
  await screen.rerender(<VerificationCamera {...props} measurementEnabled />);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).not.toHaveBeenCalledWith('focused');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
});

async function sample(rawScore: number, elapsed = PREVIEW_SAMPLE_MS) {
  await act(async () => jest.advanceTimersByTime(elapsed));
  runSync.mockReturnValue([new Float32Array(18).buffer, new Float32Array([rawScore]).buffer]);
  const dispose = jest.fn();
  const onFrame = jest.mocked(useFrameOutput).mock.calls.at(-1)![0].onFrame!;
  await act(async () => onFrame({ dispose } as unknown as Frame));
  expect(dispose).toHaveBeenCalledTimes(1);
}

test('카메라 첫 프레임과 실제 3장 판정은 별개이며 2장 이상 손과 공부 도구가 함께 보일 때만 성공한다', async () => {
  const screen = await setup();
  expect(screen.onReady).not.toHaveBeenCalled();
  expect(screen.onDetection).not.toHaveBeenCalledWith('focused');
  await sample(-4);
  expect(screen.onReady).toHaveBeenCalledTimes(1);
  await sample(-4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await sample(-4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  expect(resizedDispose).toHaveBeenCalledTimes(7);
});

test('추론 간격을 지켜도 건너뛴 원본 프레임을 해제한다', async () => {
  await setup();
  expect(jest.mocked(useFrameOutput).mock.calls.at(-1)![0]).toMatchObject({
    pixelFormat: 'yuv',
    allowDeferredStart: false,
  });
  await sample(4);
  await sample(4, 1);
  expect(runSync).toHaveBeenCalledTimes(1);
  expect(resizedDispose).toHaveBeenCalledTimes(1);
});

test('프레임이 끊기면 성공을 지우고 과거 점수를 재사용하지 않는다', async () => {
  const screen = await setup();
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await act(async () => jest.advanceTimersByTime(PREVIEW_STALE_MS + PREVIEW_SAMPLE_MS));
  expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
});

test('변환 실패도 원본과 중간 버퍼를 해제하고 성공으로 취급하지 않는다', async () => {
  const screen = await setup();
  resized.getPixelBuffer.mockImplementationOnce(() => {
    throw new Error('buffer unavailable');
  });
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(resizedDispose).toHaveBeenCalledTimes(1);
  expect(runSync).not.toHaveBeenCalled();
});

test('모델 로딩 실패는 카메라 준비와 구분해 판정 불가로 표시한다', async () => {
  jest
    .mocked(useTensorflowModel)
    .mockReturnValue({ state: 'error', model: undefined, error: new Error('model unavailable') });
  const screen = await setup();
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  await sample(4);
  expect(runSync).not.toHaveBeenCalled();
});

test('닫힌 미리보기의 늦은 추론 결과는 화면으로 보내지 않는다', async () => {
  const screen = await setup();
  screen.onDetection.mockClear();
  let deliver: (() => void) | undefined;
  jest.mocked(scheduleOnRN).mockImplementationOnce(((
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => {
    deliver = () => fn(...args);
  }) as typeof scheduleOnRN);
  await sample(4);
  await screen.unmount();
  deliver!();
  expect(screen.onDetection).not.toHaveBeenCalled();
});

test('미리보기 뷰 없이도 프레임 출력을 켜고 실제 프레임으로 준비와 집중을 판정한다', async () => {
  const screen = await setup(false);
  expect(screen.queryByTestId('native-camera')).toBeNull();
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0]).toMatchObject({
    isActive: true,
    device: 'back',
  });
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onReady).toHaveBeenCalledTimes(1);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(screen.onPaused).not.toHaveBeenCalled();
});

test('집중 중에는 20초마다 독립적인 3장만 판정하고 영상이 없으면 촬영도 쉰다', async () => {
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  expect(screen.onDetection).not.toHaveBeenCalledWith('focused');
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(runSync).toHaveBeenCalledTimes(3);
  let camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
  expect(camera.isActive).toBe(false);
  await act(async () => camera.onStopped!());
  expect(screen.onPaused).not.toHaveBeenCalled();
  await sample(-4, 1000);
  expect(runSync).toHaveBeenCalledTimes(3);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  // 첫 묶음의 시작(300ms)으로부터 20초. 그 전에는 2초 stale 규칙도 적용하지 않는다.
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_INTERVAL_MS - 1600));
  camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
  expect(camera.isActive).toBe(true);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await sample(-4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  await sample(-4);
  expect(runSync).toHaveBeenCalledTimes(6);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
});

test('집중 중 영상이 보이면 촬영은 유지하되 추론은 세 장 뒤에 쉰다', async () => {
  const screen = await setup(true, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(true);
  await sample(4, 1000);
  expect(runSync).toHaveBeenCalledTimes(3);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
});

test('다음 정기 검사에서 프레임이 오지 않으면 이전 성공을 무한 유지하지 않는다', async () => {
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_STALE_MS + 1000));
  expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
});

test('첫 검사도 프레임이 5초 동안 오지 않으면 촬영을 멈추고 다음 주기에 재시도한다', async () => {
  const screen = await setup(false, 'periodic');
  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  const calls = jest.mocked(useCamera).mock.calls.length;
  const detections = screen.onDetection.mock.calls.length;
  await screen.unmount();
  await act(async () => jest.advanceTimersByTime(60000));
  expect(jest.mocked(useCamera).mock.calls).toHaveLength(calls);
  expect(screen.onDetection.mock.calls).toHaveLength(detections);
});

test('검사 사이 영상 표시만 바꿔도 검사 주기를 당기거나 판정을 지우지 않는다', async () => {
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  await screen.rerender(
    <VerificationCamera
      position="back"
      active
      previewVisible
      cadence="periodic"
      onReady={screen.onReady}
      onPaused={screen.onPaused}
      onDetection={screen.onDetection}
      onError={screen.onError}
    />,
  );
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(true);
  await sample(-4, 1000);
  expect(runSync).toHaveBeenCalledTimes(3);
  await screen.rerender(
    <VerificationCamera
      position="back"
      active
      previewVisible={false}
      cadence="periodic"
      onReady={screen.onReady}
      onPaused={screen.onPaused}
      onDetection={screen.onDetection}
      onError={screen.onError}
    />,
  );
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(screen.onPaused).not.toHaveBeenCalled();
});

function enableObjects(runObjects: jest.Mock) {
  const palm = jest.mocked(useTensorflowModel).getMockImplementation()!;
  jest.mocked(useTensorflowModel).mockImplementation((source, delegates) => {
    if (source !== 2) return palm(source, delegates);
    return {
      state: 'loaded',
      model: {
        inputs: [{ shape: [1, 320, 320, 3], dataType: 'uint8' }],
        outputs: [
          { shape: [1, 2, 90], dataType: 'float32' },
          { shape: [1, 2, 4], dataType: 'float32' },
        ],
        runSync: runObjects,
      },
    } as unknown as ReturnType<typeof useTensorflowModel>;
  });
}

test('물체만 있고 손이 없으면 집중이 아니며 추가 촬영하지 않는다', async () => {
  const raw = new Float32Array(180);
  raw[83] = 0.9;
  const runObjects = jest.fn(() => [raw.buffer, new Float32Array(8).buffer]);
  enableObjects(runObjects);
  const screen = await setup(false, 'periodic');
  await sample(-4);
  await sample(-4);
  await sample(-4);
  expect(screen.onStudyObjects).toHaveBeenLastCalledWith({
    book: true,
    keyboard: false,
    laptop: false,
  });
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingHand');
  expect(runObjects).toHaveBeenCalledTimes(3);
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  await sample(4, 1000);
  expect(runObjects).toHaveBeenCalledTimes(3);
  expect(resizedDispose).toHaveBeenCalledTimes(3);
  expect(objectDispose).toHaveBeenCalledTimes(3);
});

test('물체 모델 오류는 손만으로 성공시키지 않고 버퍼 해제와 다음 20초 검사를 유지한다', async () => {
  const runObjects = jest.fn(() => {
    throw new Error('object inference failed');
  });
  enableObjects(runObjects);
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onStudyObjects).toHaveBeenLastCalledWith(null);
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(resizedDispose).toHaveBeenCalledTimes(3);
  expect(objectDispose).toHaveBeenCalledTimes(3);
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_INTERVAL_MS));
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(true);
});

test('손만 보이고 공부 도구가 없으면 시작 전에도 집중 중에도 통과하지 않는다', async () => {
  objectRunSync.mockReturnValue([new Float32Array(180).buffer, new Float32Array(8).buffer]);
  const screen = await setup();
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingObject');
});

test('손과 물체가 각각 2장이어도 같은 장에서 함께 보인 것이 1장이면 실패한다', async () => {
  const none = new Float32Array(180);
  const book = new Float32Array(180);
  book[83] = 0.9;
  objectRunSync
    .mockReturnValueOnce([none.buffer])
    .mockReturnValueOnce([book.buffer])
    .mockReturnValueOnce([book.buffer]);
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(-4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('missingObject');
});

test('물체 추론이 한 장 실패해도 나머지 두 장이 같은 프레임에서 함께 확인되면 성공한다', async () => {
  objectRunSync.mockImplementationOnce(() => {
    throw new Error('temporary object error');
  });
  const screen = await setup(false, 'periodic');
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
  expect(objectDispose).toHaveBeenCalledTimes(3);
});

test.each(['live', 'periodic'] as const)(
  '%s 촬영 중단 전에 예약된 추론은 버리고 재개 후 새 세 장으로 확인한다',
  async (cadence) => {
    const screen = await setup(false, cadence);
    await sample(4);
    await sample(4);
    let pending: (() => void) | undefined;
    jest.mocked(scheduleOnRN).mockImplementationOnce(((
      fn: (...args: unknown[]) => void,
      ...args: unknown[]
    ) => {
      pending = () => fn(...args);
    }) as typeof scheduleOnRN);
    await sample(4);
    const camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
    await act(async () => camera.onInterruptionStarted!('video-device-in-use-by-another-client'));
    const readyCalls = screen.onReady.mock.calls.length;
    await act(async () => pending!());
    expect(screen.onDetection).toHaveBeenLastCalledWith('checking');
    expect(screen.onReady).toHaveBeenCalledTimes(readyCalls);
    expect(screen.onStudyObjects).toHaveBeenLastCalledWith(null);
    await sample(4);
    expect(screen.onReady).toHaveBeenCalledTimes(readyCalls);
    await act(async () => camera.onInterruptionEnded!());
    await sample(4);
    await sample(4);
    await sample(4);
    expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
    expect(screen.onReady).toHaveBeenCalledTimes(readyCalls + 1);
  },
);

test('정기 촬영이 중단돼도 5초 제한으로 카메라를 쉬고 다음 검사에서 새로 시도한다', async () => {
  const screen = await setup(false, 'periodic');
  const camera = jest.mocked(useCamera).mock.calls.at(-1)![0];
  await act(async () => camera.onInterruptionStarted!('video-device-in-use-by-another-client'));
  await act(async () => jest.advanceTimersByTime(5000));
  expect(screen.onDetection).toHaveBeenLastCalledWith('unavailable');
  expect(jest.mocked(useCamera).mock.calls.at(-1)![0].isActive).toBe(false);
  await act(async () => jest.advanceTimersByTime(MEASUREMENT_INTERVAL_MS));
  await sample(4);
  await sample(4);
  await sample(4);
  expect(screen.onDetection).toHaveBeenLastCalledWith('focused');
});
