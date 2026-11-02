/**
 * 손바닥 탐지기(MediaPipe palm_detection_lite) 입출력 도우미.
 * 순수 함수라 카메라 워클릿 스레드와 JS 양쪽에서 쓴다 — 그래서 전부 'worklet' 표시.
 * 스파이크 단계: 손 있음/없음만 보므로 박스 디코드·NMS 없이 점수 텐서 최대값만 쓴다.
 */

/** 모델 입력 한 변(픽셀). 192×192 RGB. */
export const PALM_INPUT = 192;

/** 손 점수 커트라인. 이 값 이상이면 그 프레임에 손이 있다고 본다. */
export const HAND_SCORE = 0.5;

/** 리사이저가 준 RGB uint8(0~255)을 모델이 먹는 float32(0~1)로 바꾼다. */
export function rgbToFloat(rgb: Uint8Array): ArrayBuffer {
  'worklet';
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) out[i] = rgb[i]! / 255;
  return out.buffer;
}

/** 출력 텐서 중 점수 텐서([1, 2016, 1])의 인덱스. 없으면 -1. */
export function scoreTensorIndex(outputs: readonly { shape: number[] }[]): number {
  'worklet';
  for (let i = 0; i < outputs.length; i++) {
    const shape = outputs[i]!.shape;
    if (shape[shape.length - 1] === 1) return i;
  }
  return -1;
}

/** 앵커별 날 점수 중 최대값에 sigmoid(±100 클램프) — MediaPipe 그래프와 같은 식. */
export function maxSigmoid(raw: Float32Array): number {
  'worklet';
  if (!raw.length) return NaN;
  let m = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const score = raw[i]!;
    if (!Number.isFinite(score)) return NaN;
    if (score > m) m = score;
  }
  const x = Math.max(-100, Math.min(100, m));
  return 1 / (1 + Math.exp(-x));
}

/** 프레임 점수들 중 `need`장 이상이 커트라인을 넘으면 그 구간은 인증. */
export function majorityPass(scores: readonly number[], threshold = HAND_SCORE, need = 2): boolean {
  'worklet';
  let hit = 0;
  for (const s of scores) if (Number.isFinite(s) && s >= threshold) hit++;
  return hit >= need;
}
