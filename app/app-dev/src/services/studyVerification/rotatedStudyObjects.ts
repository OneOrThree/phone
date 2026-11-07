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

const detected = (scores: StudyObjectScores) => {
  'worklet';
  return Math.max(scores.book, scores.laptop, scores.keyboard) >= OBJECT_SCORE;
};

/** 한 프레임에서 최대 두 번만 추론한다. 다른 프레임의 점수는 재사용하지 않는다. */
export function detectRotatedStudyObjects(
  buffer: ArrayBuffer,
  search: RotationSearch,
  allowRetry: boolean,
  infer: (input: ArrayBuffer) => StudyObjectScores,
): { scores: StudyObjectScores; search: RotationSearch } {
  'worklet';
  const scores = infer(rotateSquareRgb(buffer, OBJECT_INPUT, search.preferred));
  if (detected(scores) || !allowRetry) return { scores, search };
  const next = search.next === search.preferred ? (search.next + 1) % 4 : search.next;
  const retry = infer(rotateSquareRgb(buffer, OBJECT_INPUT, next));
  return {
    scores: detected(retry) ? retry : scores,
    search: { preferred: detected(retry) ? next : search.preferred, next: (next + 1) % 4 },
  };
}
