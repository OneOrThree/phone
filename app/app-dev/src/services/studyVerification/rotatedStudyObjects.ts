import { HAND_SCORE, PALM_INPUT } from './palmScore';
import { OBJECT_INPUT, OBJECT_SCORE, type StudyObjectScores } from './studyObjects';

export type RotationSearch = { preferred: number; next: number };

/** 리사이저의 기기 방향 보정 뒤, 책 자체의 방향을 검사하기 위한 정사각 RGB 회전. */
export function rotateSquareRgb(buffer: ArrayBuffer, size: number, turns: number): ArrayBuffer {
  'worklet';
  if (turns === 0) return buffer;
  if (![1, 2, 3].includes(turns) || buffer.byteLength !== size * size * 3)
    throw new Error('Invalid RGB rotation input');
  const source = new Uint8Array(buffer);
  const output = new Uint8Array(source.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = turns === 1 ? size - 1 - y : turns === 2 ? size - 1 - x : y;
      const dy = turns === 1 ? x : turns === 2 ? size - 1 - y : size - 1 - x;
      const from = (y * size + x) * 3;
      const to = (dy * size + dx) * 3;
      output[to] = source[from]!;
      output[to + 1] = source[from + 1]!;
      output[to + 2] = source[from + 2]!;
    }
  }
  return output.buffer;
}

/** 손 모델의 float32 RGB 입력을 값 변환 없이 비트 그대로 회전한다. */
export function rotatePalmRgb(buffer: ArrayBuffer, turns: number): ArrayBuffer {
  'worklet';
  if (buffer.byteLength !== PALM_INPUT * PALM_INPUT * 3 * 4 || ![0, 1, 2, 3].includes(turns))
    throw new Error('Invalid palm input');
  if (turns === 0) return buffer;
  const source = new Uint32Array(buffer);
  const output = new Uint32Array(source.length);
  for (let y = 0; y < PALM_INPUT; y++) {
    for (let x = 0; x < PALM_INPUT; x++) {
      const dx = turns === 1 ? PALM_INPUT - 1 - y : turns === 2 ? PALM_INPUT - 1 - x : y;
      const dy = turns === 1 ? x : turns === 2 ? PALM_INPUT - 1 - y : PALM_INPUT - 1 - x;
      const from = (y * PALM_INPUT + x) * 3;
      const to = (dy * PALM_INPUT + dx) * 3;
      output[to] = source[from]!;
      output[to + 1] = source[from + 1]!;
      output[to + 2] = source[from + 2]!;
    }
  }
  return output.buffer;
}

const validScore = (score: number) => {
  'worklet';
  return Number.isFinite(score) && score >= 0 && score <= 1;
};

/** 손이 안 보이면 다른 방향으로 한 번만 더 본다. 성공한 방향은 다음 프레임에 먼저 쓴다. */
export function detectRotatedHand(
  buffer: ArrayBuffer,
  search: RotationSearch,
  infer: (input: ArrayBuffer) => number,
): { score: number; search: RotationSearch; attempts: number } {
  'worklet';
  const first = infer(rotatePalmRgb(buffer, search.preferred));
  if (!validScore(first)) throw new Error('Invalid palm score');
  if (first >= HAND_SCORE) return { score: first, search, attempts: 1 };
  const next = search.next === search.preferred ? (search.next + 1) % 4 : search.next;
  const retry = infer(rotatePalmRgb(buffer, next));
  if (!validScore(retry)) throw new Error('Invalid palm score');
  return {
    score: Math.max(first, retry),
    search: { preferred: retry >= HAND_SCORE ? next : search.preferred, next: (next + 1) % 4 },
    attempts: 2,
  };
}

/** 3장 묶음의 도구 추론은 합쳐서 6회 이내. 뒤에 남은 장마다 최소 한 번은 남겨 둔다. */
export function objectAttemptLimit(frameIndex: number, used: number): number {
  'worklet';
  if (
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex > 2 ||
    !Number.isInteger(used) ||
    used < 0 ||
    used > 5
  )
    throw new Error('Invalid inference budget');
  return Math.max(1, Math.min(4, 6 - used - (2 - frameIndex)));
}

/**
 * 손이 보인 프레임에서만 도구를 최대 limit(≤4) 방향으로 검사한다. 성공한 방향을 기억해 다음 프레임에 먼저 쓴다.
 * 한 프레임의 회전 결과는 그 프레임 하나의 점수로만 쓰고, 다른 프레임 점수는 재사용하지 않는다.
 */
export function detectRotatedStudyObjects(
  buffer: ArrayBuffer,
  search: RotationSearch,
  handPresent: boolean,
  infer: (input: ArrayBuffer) => StudyObjectScores,
  limit = 4,
): { scores: StudyObjectScores; search: RotationSearch; attempts: number } {
  'worklet';
  const order = [search.preferred];
  for (let offset = 0; offset < 4; offset++) {
    const turn = (search.next + offset) % 4;
    if (!order.includes(turn)) order.push(turn);
  }
  let best: StudyObjectScores | undefined;
  let bestScore = -1;
  const count = handPresent ? Math.max(1, Math.min(4, limit)) : 1;
  for (let attempt = 0; attempt < count; attempt++) {
    const turn = order[attempt]!;
    const scores = infer(rotateSquareRgb(buffer, OBJECT_INPUT, turn));
    const max = Math.max(scores.book, scores.laptop, scores.keyboard);
    if (!validScore(max)) throw new Error('Invalid object score');
    if (max > bestScore) {
      best = scores;
      bestScore = max;
    }
    if (max >= OBJECT_SCORE)
      return { scores, search: { preferred: turn, next: (turn + 1) % 4 }, attempts: attempt + 1 };
  }
  // 한 방향만 본 장(손이 없거나 남은 횟수가 1)은 다음에 볼 방향 순서를 건드리지 않는다.
  return {
    scores: best!,
    search: {
      preferred: search.preferred,
      next: count === 1 ? search.next : (order[count - 1]! + 1) % 4,
    },
    attempts: count,
  };
}
