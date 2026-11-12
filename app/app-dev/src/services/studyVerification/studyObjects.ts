/**
 * EfficientDet-Lite0 float16 출력 요약 모델(efficientdet_lite0_float16_study.tflite) 입출력.
 * 원본 90클래스 확률에서 노트북·키보드·책의 최대 확률 3개와 전체 확률 유효성만 모델 안에서 계산해 돌려준다.
 */
export const OBJECT_INPUT = 320;
/** 도구 커트라인. 측정용 앱 실측(GROMO-2879)에서 float16 모델에 맞춰 0.4로 정했다. */
export const OBJECT_SCORE = 0.4;
const SCORE_ORDER = ['laptop', 'keyboard', 'book'] as const;
export type StudyObject = (typeof SCORE_ORDER)[number];
export type StudyObjectScores = Record<StudyObject, number>;
export type StudyObjectPresence = Record<StudyObject, boolean>;

type TensorMeta = { shape: readonly number[]; dataType: string };
const sameShape = (shape: readonly number[], expected: readonly number[]) =>
  shape.length === expected.length && shape.every((d, i) => d === expected[i]);

/** 입력 uint8 [1,320,320,3], 출력 float32 점수 [1,3] + bool 유효성 [1]인지 확인한다. 아니면 판정을 열지 않는다. */
export function studyObjectModelReady(
  inputs: readonly TensorMeta[],
  outputs: readonly TensorMeta[],
): boolean {
  'worklet';
  const input = inputs[0];
  return (
    inputs.length === 1 &&
    input?.dataType === 'uint8' &&
    input.shape.length === 4 &&
    input.shape[0] === 1 &&
    input.shape[1] === OBJECT_INPUT &&
    input.shape[2] === OBJECT_INPUT &&
    input.shape[3] === 3 &&
    outputs.length === 2 &&
    outputs[0]!.dataType === 'float32' &&
    sameShape(outputs[0]!.shape, [1, SCORE_ORDER.length]) &&
    outputs[1]!.dataType === 'bool' &&
    sameShape(outputs[1]!.shape, [1])
  );
}

/** 모델이 낸 3개 확률을 읽는다. 원본 확률 중 하나라도 비정상이면 정상 미검출로 바꾸지 않고 오류로 보존한다. */
export function studyObjectScores(outputs: readonly ArrayBuffer[]): StudyObjectScores {
  'worklet';
  if (outputs.length !== 2 || outputs[0]?.byteLength !== 12 || outputs[1]?.byteLength !== 1)
    throw new Error('Invalid object score tensors');
  const values = new Float32Array(outputs[0]);
  if (
    new Uint8Array(outputs[1])[0] !== 1 ||
    values.some((x) => !Number.isFinite(x) || x < 0 || x > 1)
  )
    throw new Error('Invalid object score probability');
  return { laptop: values[0]!, keyboard: values[1]!, book: values[2]! };
}

/** 미리보기용 물체별 표시. 실제 집중 판정은 focusDetection에서 같은 프레임의 손과 결합한다. */
export function studyObjectPresence(
  samples: readonly (StudyObjectScores | null)[],
): StudyObjectPresence | null {
  'worklet';
  if (samples.length !== 3 || samples.every((s) => s == null)) return null;
  return {
    laptop: samples.filter((s) => (s?.laptop ?? 0) >= OBJECT_SCORE).length >= 2,
    keyboard: samples.filter((s) => (s?.keyboard ?? 0) >= OBJECT_SCORE).length >= 2,
    book: samples.filter((s) => (s?.book ?? 0) >= OBJECT_SCORE).length >= 2,
  };
}
