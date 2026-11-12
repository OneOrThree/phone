import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import {
  NativePreviewView,
  useCamera,
  usePreviewOutput,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { useTensorflowModel, type ModelSource } from 'react-native-fast-tflite';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import {
  HAND_SCORE,
  PALM_INPUT,
  maxSigmoid,
  scoreTensorIndex,
} from '@/services/studyVerification/palmScore';
import {
  LIVE_SAMPLE_MS,
  LIVE_STALE_MS,
  MEASUREMENT_INTERVAL_MS,
  MEASUREMENT_BATCH_SIZE,
  MEASUREMENT_STALE_MS,
  MEASUREMENT_CAPTURE_TIMEOUT_MS,
  type VerificationCadence,
} from '@/services/studyVerification/cadence';
import {
  detectRotatedHand,
  detectRotatedStudyObjects,
  objectAttemptLimit,
  type RotationSearch,
} from '@/services/studyVerification/rotatedStudyObjects';
import type { VerificationCameraPosition } from '@/services/studyVerification/types';
import {
  OBJECT_INPUT,
  studyObjectModelReady,
  studyObjectScores,
  studyObjectPresence,
  type StudyObjectScores,
  type StudyObjectPresence,
} from '@/services/studyVerification/studyObjects';

import {
  focusDetection,
  type VerificationDetection,
} from '@/services/studyVerification/focusDetection';
export type { VerificationDetection } from '@/services/studyVerification/focusDetection';
export const PREVIEW_SAMPLE_MS = LIVE_SAMPLE_MS;
export const PREVIEW_STALE_MS = LIVE_STALE_MS;
const PREVIEW_RESOLUTION = { width: 640, height: 480 };
// 모델 require 는 카메라를 실제로 그릴 때만 평가한다 — 모듈 최상위에 두면 이 파일을 import 만 하는 화면·테스트도 .tflite 를 읽는다.
const palmModelModule = (): number => require('../../assets/ml/palm_detection_full.tflite');
const objectModelModule = (): number =>
  require('../../assets/ml/efficientdet_lite0_float16_study.tflite');
type ModelSources = { palm: ModelSource; object: ModelSource };
type Samples = {
  lastAt: number;
  scores: number[];
  objects: (StudyObjectScores | null)[];
  startedAt: number;
  complete: boolean;
};
const emptySamples = (): Samples => {
  'worklet';
  return { lastAt: 0, scores: [], objects: [], startedAt: 0, complete: false };
};

type Props = {
  position: VerificationCameraPosition;
  active: boolean;
  measurementEnabled?: boolean;
  previewVisible?: boolean;
  cadence?: VerificationCadence;
  onReady: () => void;
  onPaused: () => void;
  onDetection: (detection: VerificationDetection) => void;
  onStudyObjects?: (objects: StudyObjectPresence | null) => void;
  onError: (error: unknown) => void;
};

/** 같은 촬영 세션의 미리보기와 프레임을 함께 판정한다. 사진·영상 파일은 만들지 않는다. */
export function VerificationCamera({ active, measurementEnabled = true, ...props }: Props) {
  if (!active) return null;
  if (!measurementEnabled)
    return props.previewVisible === false ? null : <PreviewCamera {...props} />;
  return <LiveVerificationCamera {...props} />;
}

/** 측정 OFF에서는 모델·리사이저·분석용 프레임 출력을 생성하지 않는다. */
function PreviewCamera({ position, onError }: Pick<Props, 'position' | 'onError'>) {
  const previewOutput = usePreviewOutput();
  const outputs = useMemo(() => [previewOutput], [previewOutput]);
  useCamera({ device: position, isActive: true, outputs, onError });
  return <CameraPreview output={previewOutput} />;
}

function CameraPreview({ output }: { output: ReturnType<typeof usePreviewOutput> }) {
  return (
    <View testID="verification-camera-preview" style={StyleSheet.absoluteFill}>
      <NativePreviewView
        style={StyleSheet.absoluteFill}
        previewOutput={output}
        resizeMode="contain"
      />
    </View>
  );
}

/**
 * Android 릴리스 번들의 require(..) 는 스킴 없는 raw 리소스 이름이라 fast-tflite 가 URL 로 읽지 못한다(티켓 2751).
 * Android 에서만 expo-asset 으로 캐시 파일에 복사해 file:// 주소를 넘긴다. iOS 는 require 값을 그대로 넘긴다.
 */
function useModelSources(): ModelSources | null {
  const [sources, setSources] = useState<ModelSources | null>(() =>
    Platform.OS === 'android' ? null : { palm: palmModelModule(), object: objectModelModule() },
  );
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    // 복사에 실패하면 원래 값을 넘겨 기존 모델 로딩 실패(판정 불가) 경로로 보낸다.
    const toFile = (module: number): Promise<ModelSource> =>
      Asset.fromModule(module)
        .downloadAsync()
        .then(
          ({ localUri }) => (localUri ? { url: localUri } : module),
          () => module,
        );
    Promise.all([toFile(palmModelModule()), toFile(objectModelModule())]).then(([palm, object]) => {
      if (alive) setSources({ palm, object });
    });
    return () => {
      alive = false;
    };
  }, []);
  return sources;
}

function LiveVerificationCamera(props: Omit<Props, 'active'>) {
  const models = useModelSources();
  if (!models) return null;
  return <ModelVerificationCamera {...props} models={models} />;
}

function ModelVerificationCamera({
  models,
  position,
  previewVisible = true,
  cadence = 'live',
  onReady,
  onPaused,
  onDetection,
  onStudyObjects,
  onError,
}: Omit<Props, 'active'> & { models: ModelSources }) {
  const model = useTensorflowModel(models.palm, []);
  // 손 모델 입력은 float32 RGB 0~1 이다. 리사이저가 GPU 에서 바로 그 형식으로 내보내 JS 변환을 하지 않는다(티켓 2737).
  const resize = useResizer({
    width: PALM_INPUT,
    height: PALM_INPUT,
    channelOrder: 'rgb',
    dataType: 'float32',
    scaleMode: 'contain',
    pixelLayout: 'interleaved',
  });
  const objectModel = useTensorflowModel(models.object, []);
  const objectResize = useResizer({
    width: OBJECT_INPUT,
    height: OBJECT_INPUT,
    channelOrder: 'rgb',
    dataType: 'uint8',
    scaleMode: 'contain',
    pixelLayout: 'interleaved',
  });
  const objectTflite = objectModel.state === 'loaded' ? objectModel.model : undefined;
  const objectReady = objectTflite
    ? studyObjectModelReady(objectTflite.inputs, objectTflite.outputs)
    : false;
  const objectResizer = objectResize.resizer;
  const tflite = model.state === 'loaded' ? model.model : undefined;
  const scoreIdx = tflite ? scoreTensorIndex(tflite.outputs) : -1;
  const resizer = resize.resizer;
  const objectRotation = useMemo(
    () => createSynchronizable<RotationSearch>({ preferred: 0, next: 1 }),
    [],
  );
  const handRotation = useMemo(
    () => createSynchronizable<RotationSearch>({ preferred: 0, next: 1 }),
    [],
  );
  // 주기 검사에서 같은 3장 묶음이 쓴 도구 추론 횟수. 묶음의 첫 장에서 0으로 다시 센다.
  const objectBudget = useMemo(() => createSynchronizable(0), []);
  const samples = useMemo(() => createSynchronizable<Samples>(emptySamples()), []);
  const captureEpoch = useMemo(() => createSynchronizable(0), []);
  const interrupted = useMemo(() => createSynchronizable(false), []);
  const mounted = useRef(true);
  const lastResult = useRef(0);
  const lastDetection = useRef<VerificationDetection>('checking');
  const lastError = useRef('');
  const lastObjects = useRef('');
  const objectsCallback = useRef(onStudyObjects);
  objectsCallback.current = onStudyObjects;
  const reportObjects = useCallback((presence: StudyObjectPresence | null) => {
    objectsCallback.current?.(presence);
  }, []);
  const frameReady = useRef(false);
  const periodic = cadence === 'periodic';
  const staleMs = periodic ? MEASUREMENT_STALE_MS : PREVIEW_STALE_MS;
  const [sampling, setSampling] = useState(true);
  const samplingRef = useRef(true);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
    samples.setBlocking(emptySamples());
    samplingRef.current = true;
    setSampling(true);
    lastResult.current = 0;
    onDetection('checking');
    reportObjects(null);
    return () => {
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
    };
  }, [periodic, samples, captureEpoch, onDetection, reportObjects]);

  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(
      () => {
        if (lastResult.current && Date.now() - lastResult.current >= staleMs) {
          lastResult.current = 0;
          onDetection('checking');
          reportObjects(null);
        }
      },
      periodic ? 1000 : PREVIEW_SAMPLE_MS,
    );
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [onDetection, reportObjects, staleMs, periodic]);

  useEffect(() => {
    if (
      model.state === 'error' ||
      resize.state === 'error' ||
      (tflite && scoreIdx < 0) ||
      objectModel.state === 'error' ||
      objectResize.state === 'error' ||
      (objectTflite && !objectReady)
    ) {
      onDetection('unavailable');
    }
  }, [
    model.state,
    resize.state,
    tflite,
    scoreIdx,
    objectModel.state,
    objectResize.state,
    objectTflite,
    objectReady,
    onDetection,
  ]);

  const receiveScores = useCallback(
    (
      epoch: number,
      scores: number[] | null,
      error = '',
      startedAt = Date.now(),
      objects: (StudyObjectScores | null)[] = [],
    ) => {
      if (
        !mounted.current ||
        epoch !== captureEpoch.getBlocking() ||
        (interrupted.getBlocking() && scores !== null) ||
        (periodic && !samplingRef.current)
      )
        return;
      if (scores && !frameReady.current) {
        frameReady.current = true;
        onReady();
        if (__DEV__) console.log('[verification-camera] measurement frames started');
      }
      lastResult.current = scores ? Date.now() : 0;
      const detection = focusDetection(scores, objects);
      if (__DEV__ && error && error !== lastError.current) {
        console.warn('[verification-camera] inference failed', error);
      }
      if (__DEV__ && detection !== lastDetection.current) {
        console.log('[verification-camera] detection', detection);
      }
      lastError.current = error;
      lastDetection.current = detection;
      onDetection(detection);
      reportObjects(studyObjectPresence(objects));
      if (__DEV__ && objects.length === MEASUREMENT_BATCH_SIZE) {
        const evidence = JSON.stringify(studyObjectPresence(objects));
        if (evidence !== lastObjects.current)
          console.log('[verification-objects] evidence', evidence);
        lastObjects.current = evidence;
      }
      if (periodic) {
        // 검사 사이에는 추론을 중단하고, 미리보기가 없으면 실제 촬영도 멈춘다.
        samplingRef.current = false;
        setSampling(false);
        if (wakeTimer.current) clearTimeout(wakeTimer.current);
        wakeTimer.current = setTimeout(
          () => {
            captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
            interrupted.setBlocking(false);
            samples.setBlocking(emptySamples());
            samplingRef.current = true;
            setSampling(true);
          },
          Math.max(0, MEASUREMENT_INTERVAL_MS - (Date.now() - startedAt)),
        );
      }
    },
    [onDetection, reportObjects, onReady, periodic, samples, captureEpoch, interrupted],
  );

  const onFrame = useCallback(
    (frame: Frame) => {
      'worklet';
      const epoch = captureEpoch.getBlocking();
      try {
        if (interrupted.getBlocking()) return;
        if (!tflite || !resizer || scoreIdx < 0) return;
        const previous = samples.getBlocking();
        const now = Date.now();
        if (periodic && previous.complete) return;
        if (now - previous.lastAt < PREVIEW_SAMPLE_MS) return;
        samples.setBlocking({ ...previous, lastAt: now });
        const resized = resizer.resize(frame);
        let score: number;
        try {
          // 버퍼가 살아 있을 때 그대로 넣는다. 판정마다 192×192×3 값을 JS 로 나누던 변환은 하지 않는다.
          // 손이 안 보이면 다른 방향으로 한 번만 더 본다(최대 2회).
          const hand = detectRotatedHand(
            resized.getPixelBuffer(),
            handRotation.getBlocking(),
            (input) => {
              'worklet';
              return maxSigmoid(new Float32Array(tflite.runSync([input])[scoreIdx]!));
            },
          );
          score = hand.score;
          handRotation.setBlocking(hand.search);
        } finally {
          resized.dispose();
        }
        const recent = now - previous.lastAt >= PREVIEW_STALE_MS ? [] : previous.scores;
        const scores = [...recent, score].slice(-MEASUREMENT_BATCH_SIZE);
        const startedAt = recent.length ? previous.startedAt : now;
        const complete = periodic && scores.length === MEASUREMENT_BATCH_SIZE;
        // 같은 프레임의 손·물체 결과를 짝지어 유지한다. 물체 실패를 손만으로 통과시키지 않는다.
        let objectScore: StudyObjectScores | null = null;
        if (objectTflite && objectResizer && objectReady) {
          // 주기 검사는 3장 묶음의 도구 추론을 합쳐 6회 이내로 나눠 쓴다. 미리보기 검사는 장마다 최대 4방향.
          let used = 0;
          let limit = 4;
          try {
            used = recent.length ? objectBudget.getBlocking() : 0;
            limit = periodic ? objectAttemptLimit(recent.length, used) : 4;
            const objectFrame = objectResizer.resize(frame);
            try {
              // 모델 입력은 uint8 RGB다. 정규화는 모델 안에서 하므로 버퍼가 살아 있을 때 그대로 넣는다.
              const result = detectRotatedStudyObjects(
                objectFrame.getPixelBuffer(),
                objectRotation.getBlocking(),
                score >= HAND_SCORE,
                (input) => {
                  'worklet';
                  return studyObjectScores(objectTflite.runSync([input]));
                },
                limit,
              );
              if (periodic) objectBudget.setBlocking(used + result.attempts);
              objectScore = result.scores;
              objectRotation.setBlocking(result.search);
            } finally {
              objectFrame.dispose();
            }
          } catch {
            // null을 같은 프레임 자리에 남겨 오류를 다른 장의 손과 섞지 않는다.
            // 오류 전에 쓴 추론이 있을 수 있으므로 그 장의 한도를 다 쓴 것으로 센다.
            if (periodic) objectBudget.setBlocking(used + limit);
          }
        }
        const objects = [...(recent.length ? previous.objects : []), objectScore].slice(
          -MEASUREMENT_BATCH_SIZE,
        );
        if (epoch !== captureEpoch.getBlocking() || interrupted.getBlocking()) return;
        samples.setBlocking({ lastAt: now, scores, objects, startedAt, complete });
        // 주기 검사는 세 장이 모일 때만 결과를 갱신한다. 중간 두 장은 이전 판정을 지우지 않는다.
        if (!periodic || complete)
          scheduleOnRN(receiveScores, epoch, scores, '', startedAt, objects);
      } catch (error) {
        if (epoch !== captureEpoch.getBlocking() || interrupted.getBlocking()) return;
        samples.setBlocking({ ...emptySamples(), lastAt: Date.now(), complete: periodic });
        scheduleOnRN(receiveScores, epoch, null, String(error));
      } finally {
        frame.dispose();
      }
    },
    [
      tflite,
      resizer,
      scoreIdx,
      samples,
      captureEpoch,
      interrupted,
      receiveScores,
      periodic,
      objectRotation,
      handRotation,
      objectBudget,
      objectTflite,
      objectResizer,
      objectReady,
    ],
  );

  // iOS 리사이저는 FullRange(420f) 입력만 받는다. native 기본값은 VideoRange(420v)일 수 있다.
  const frameOutput = useFrameOutput({
    onFrame,
    targetResolution: PREVIEW_RESOLUTION,
    pixelFormat: 'yuv',
    // iOS 26+에서 미리보기를 기다리며 프레임 출력을 지연하면 화면 없는 검사에 프레임이 오지 않는다.
    allowDeferredStart: false,
  });
  // 미리보기 출력은 유지하고 화면만 붙였다 뗀다. 열고 닫아도 측정 세션은 재구성하지 않는다.
  const previewOutput = usePreviewOutput();
  const outputs = useMemo(() => [frameOutput, previewOutput], [frameOutput, previewOutput]);
  useCamera({
    device: position,
    isActive: previewVisible || sampling,
    outputs,
    onStarted: () => {
      if (__DEV__ && mounted.current) console.log('[verification-camera] capture started', cadence);
    },
    onStopped: () => {
      if (!mounted.current) return;
      captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
      frameReady.current = false;
      if (__DEV__)
        console.log(
          '[verification-camera] capture stopped',
          periodic && !samplingRef.current ? 'between checks' : 'paused',
        );
      if (!periodic || samplingRef.current) onPaused();
    },
    onInterruptionStarted: () => {
      if (!mounted.current) return;
      captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
      interrupted.setBlocking(true);
      frameReady.current = false;
      lastResult.current = 0;
      samples.setBlocking(emptySamples());
      onDetection('checking');
      reportObjects(null);
      onPaused();
    },
    onInterruptionEnded: () => {
      if (!mounted.current) return;
      captureEpoch.setBlocking(captureEpoch.getBlocking() + 1);
      samples.setBlocking(emptySamples());
      interrupted.setBlocking(false);
    },
    onError,
  });
  useEffect(() => {
    if (!periodic || !sampling) return;
    // 프레임이 오지 않아도 카메라가 계속 켜져 있지 않게 검사 시간을 제한한다.
    const timeout = setTimeout(
      () => receiveScores(captureEpoch.getBlocking(), null, 'measurement frames timed out'),
      MEASUREMENT_CAPTURE_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [periodic, sampling, receiveScores, captureEpoch]);
  useEffect(() => {
    if (__DEV__) console.log('[verification-camera] preview visible', previewVisible);
  }, [previewVisible]);
  if (!previewVisible) return null;
  return <CameraPreview output={previewOutput} />;
}
