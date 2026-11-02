/** EfficientDet-Lite0 int8 v1의 내장 COCO labels.txt 기준(빈 라벨 포함 90개). */
export const OBJECT_INPUT = 320;
export const OBJECT_CLASSES = 90;
export const OBJECT_SCORE = 0.5;
const LABELS = { laptop: 72, keyboard: 75, book: 83 } as const;
export type StudyObject = keyof typeof LABELS;
export type StudyObjectScores = Record<StudyObject, number>;
export type StudyObjectPresence = Record<StudyObject, boolean>;

/** 이 모델은 후처리 전 앵커별 확률을 출력한다. sigmoid를 다시 적용하지 않는다. */
export function objectScoreIndex(
  inputs: readonly { shape: readonly number[]; dataType: string }[],
  outputs: readonly { shape: readonly number[]; dataType: string }[],
): number {
  'worklet';
  const input = inputs[0];
  if (
    inputs.length !== 1 ||
    input?.dataType !== 'uint8' ||
    input.shape.length !== 4 ||
    input.shape[0] !== 1 ||
    input.shape[1] !== OBJECT_INPUT ||
    input.shape[2] !== OBJECT_INPUT ||
    input.shape[3] !== 3
  )
    return -1;
  return outputs.findIndex(
    (tensor) =>
      tensor.dataType === 'float32' &&
      tensor.shape.length === 3 &&
      tensor.shape[0] === 1 &&
      tensor.shape[1]! > 0 &&
      tensor.shape[2] === OBJECT_CLASSES,
  );
}

/** 존재 확인만 하므로 박스 디코드·NMS 없이 대상 클래스별 최대 확률을 사용한다. */
export function studyObjectScores(raw: Float32Array): StudyObjectScores {
  'worklet';
  if (!raw.length || raw.length % OBJECT_CLASSES !== 0)
    throw new Error('Invalid object score tensor');
  // 비정상 확률을 정상 미검출이나 다른 앵커의 성공으로 바꾸지 않는다. 호출부는 오류를 null로 보존한다.
  for (let i = 0; i < raw.length; i++) {
    const score = raw[i]!;
    if (!Number.isFinite(score) || score < 0 || score > 1)
      throw new Error('Invalid object score probability');
  }
  const result: StudyObjectScores = { laptop: 0, keyboard: 0, book: 0 };
  for (let offset = 0; offset < raw.length; offset += OBJECT_CLASSES) {
    for (const key of ['laptop', 'keyboard', 'book'] as const) {
      const score = raw[offset + LABELS[key]]!;
      if (score > result[key]) result[key] = score;
    }
  }
  return result;
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
