// 순위 재정렬 재생 계획 — 정본 docs/prd/motion/low-level-design.md §6.
//
//   "맨 아래에서 맨 위까지 **한 칸씩** 4단계. 여러 칸을 한 번에 뛰면 결과만 남고 과정이 사라진다."
//   "자리가 바뀌기 직전에 **내 기록과 막대가 먼저 자란다**. 바로 위 사람을 앞지르는 값이라야
//    상승이 납득된다."  (시안 ui.html의 `CLIMB` = 한 칸마다 갱신되는 내 기록)
//
// 서버가 8위→4위처럼 여러 칸을 한 번에 갈아끼워도 **순서와 기록이 함께** 단계적으로 가야 한다는
// 계약을 잠근다.
//
// ⚠️ 애니메이션의 중간 프레임·타이밍·이징은 단언하지 않는다(워클릿은 jest에서 목이라 실행되지
//    않는다 — 정책 D14). 여기서 보는 것은 **순수 로직이 만들어내는 순서·기록**뿐이다.
import { rankSwapFrames, SWAP_GAP_MS, SWAP_LEAD_MS, SWAP_MAX_STEPS } from './rankSwap';

/** 두 순서가 '인접한 두 칸을 맞바꾼 관계'인지 — 한 칸씩 재생한다는 계약의 실질 */
function isSingleAdjacentSwap(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return false;
  const diff: number[] = [];
  for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) diff.push(i);
  if (diff.length !== 2) return false;
  const [i, j] = diff;
  return j === i + 1 && before[i] === after[j] && before[j] === after[i];
}

const secs = (entries: [string, number][]): Map<string, number> => new Map(entries);
/** 프레임이 실제로 그릴 기록 — 덮어쓰기가 없으면 서버 최종값 */
const shownAt = (
  frame: { seconds: Map<string, number> },
  key: string,
  final: Map<string, number>,
): number => frame.seconds.get(key) ?? final.get(key)!;

describe('rankSwapFrames — 한 칸씩', () => {
  const from = ['a', 'b', 'c', 'me'];
  const to = ['me', 'a', 'b', 'c'];
  // a·b·c는 그대로, me만 4위→1위. 기록은 30분(1800s)에서 3시간(10800s)으로 뛰었다.
  const final = secs([
    ['me', 10800],
    ['a', 9000],
    ['b', 7200],
    ['c', 5400],
  ]);
  const start = secs([
    ['me', 1800],
    ['a', 9000],
    ['b', 7200],
    ['c', 5400],
  ]);

  test('세 번의 인접 스왑을 거치고, 스왑마다 기록이 먼저 자란다', () => {
    const frames = rankSwapFrames(from, to, final, start);

    // 이동 3회 × (기록 프레임 + 자리 프레임)
    expect(frames).toHaveLength(6);
    expect(frames.map((f) => f.at)).toEqual([
      0,
      SWAP_LEAD_MS,
      SWAP_LEAD_MS + SWAP_GAP_MS,
      2 * SWAP_LEAD_MS + SWAP_GAP_MS,
      2 * (SWAP_LEAD_MS + SWAP_GAP_MS),
      3 * SWAP_LEAD_MS + 2 * SWAP_GAP_MS,
    ]);

    // 기록 프레임은 순서를 바꾸지 않는다 — 자리는 LEAD 뒤에 바뀐다
    expect(frames[0].order).toEqual(from);
    expect(frames[1].order).toEqual(['a', 'b', 'me', 'c']);
    expect(frames[2].order).toEqual(frames[1].order);
    expect(frames[3].order).toEqual(['a', 'me', 'b', 'c']);
    expect(frames[4].order).toEqual(frames[3].order);
    expect(frames[5].order).toEqual(to);

    // 자리 이동은 매번 인접 한 칸
    expect(isSingleAdjacentSwap(frames[0].order, frames[1].order)).toBe(true);
    expect(isSingleAdjacentSwap(frames[1].order, frames[3].order)).toBe(true);
    expect(isSingleAdjacentSwap(frames[3].order, frames[5].order)).toBe(true);
  });

  test('각 단계의 기록은 그 순간 앞지르는 상대보다 위다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    // 1단계: c(5400)를 앞지른다 / 2단계: b(7200) / 3단계: a(9000)
    expect(shownAt(frames[0], 'me', final)).toBeGreaterThan(5400);
    expect(shownAt(frames[2], 'me', final)).toBeGreaterThan(7200);
    expect(shownAt(frames[4], 'me', final)).toBeGreaterThan(9000);
  });

  test('기록은 직전 표시값과 서버 최종값 사이에서 단조 증가한다 — 지어낸 값이 아니다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    const mine = frames.map((f) => shownAt(f, 'me', final));
    for (let i = 1; i < mine.length; i += 1) expect(mine[i]).toBeGreaterThanOrEqual(mine[i - 1]);
    expect(Math.min(...mine)).toBeGreaterThanOrEqual(1800);
    expect(Math.max(...mine)).toBeLessThanOrEqual(10800);
  });

  test('마지막 프레임은 예외 없이 서버 최종값이다 — 중간값이 화면에 남지 않는다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    expect(frames[frames.length - 1].seconds.size).toBe(0);
    expect(shownAt(frames[frames.length - 1], 'me', final)).toBe(10800);
  });

  test('밀려나는 행의 기록은 손대지 않는다 — 기록은 줄지 않는다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    for (const f of frames) {
      expect(f.seconds.has('a')).toBe(false);
      expect(f.seconds.has('b')).toBe(false);
      expect(f.seconds.has('c')).toBe(false);
    }
  });
});

describe('rankSwapFrames — 재생할 것이 없는 경우', () => {
  const anySecs = secs([
    ['a', 3],
    ['b', 2],
    ['c', 1],
  ]);

  test('순서가 그대로면 빈 계획', () => {
    expect(rankSwapFrames(['a', 'b', 'c'], ['a', 'b', 'c'], anySecs, anySecs)).toEqual([]);
  });

  test('구성원이 바뀌면(진입·이탈) 빈 계획 — 행 노드 동일성 전제가 깨진다(정본 §6)', () => {
    expect(rankSwapFrames(['a', 'b', 'c'], ['a', 'b', 'z'], anySecs, anySecs)).toEqual([]);
    expect(rankSwapFrames(['a', 'b'], ['a', 'b', 'c'], anySecs, anySecs)).toEqual([]);
    expect(rankSwapFrames([], ['a', 'b'], anySecs, anySecs)).toEqual([]);
  });

  test('키에 중복이 있으면 빈 계획 — 어느 행이 어느 자리인지 정할 수 없다', () => {
    expect(rankSwapFrames(['a', 'a', 'b'], ['b', 'a', 'a'], anySecs, anySecs)).toEqual([]);
  });
});

describe('rankSwapFrames — 상한', () => {
  // 20위→1위를 한 칸씩 다 재생하면 19단계 × 390ms ≈ 7.4초 동안 목록이 계속 움직인다.
  // 초과분은 **버리지 않고 첫 한 단계로 묶어** 시차 상한(M.staggerMaxSteps)과 같은 규율을 쓴다.
  const from = Array.from({ length: 20 }, (_, i) => `u${i}`);
  const to = ['u19', ...from.slice(0, 19)];
  // u0이 가장 높고 u19가 가장 낮았다가, u19가 전부를 앞질러 1위가 된다.
  const final = new Map(from.map((key, i) => [key, (20 - i) * 600]));
  final.set('u19', 20 * 600 + 600);
  const start = new Map(final);
  start.set('u19', 600);

  test('자리 이동은 상한(SWAP_MAX_STEPS)까지만 한다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    expect(frames).toHaveLength(SWAP_MAX_STEPS * 2);
    expect(frames[0].order).toEqual(from);
    expect(frames[frames.length - 1].order).toEqual(to);
    // 첫 이동만 여러 칸을 한 번에 묶고(초과분), 나머지는 한 칸씩 — 도착은 그대로 읽힌다
    expect(isSingleAdjacentSwap(frames[0].order, frames[1].order)).toBe(false);
    for (let i = 3; i < frames.length; i += 2) {
      expect(isSingleAdjacentSwap(frames[i - 2].order, frames[i].order)).toBe(true);
    }
  });

  test('묶인 첫 단계의 기록은 건너뛴 상대까지 전부 앞지른 값이다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    // 묶음이 끝난 순서에서 바로 아래에 있는 행(=이번 묶음에서 마지막으로 앞지른 상대)
    const landedAt = frames[1].order.indexOf('u19');
    const passed = frames[1].order[landedAt + 1];
    expect(shownAt(frames[0], 'u19', final)).toBeGreaterThan(final.get(passed)!);
  });

  test('상한이 1이면 한 번에 최종 순서·최종 기록으로 간다', () => {
    const frames = rankSwapFrames(from, to, final, start, 1);
    expect(frames).toHaveLength(2);
    expect(frames[0].order).toEqual(from);
    expect(frames[1].order).toEqual(to);
    expect(frames[1].seconds.size).toBe(0);
  });

  // ⚠️ 스냅샷을 필요한 구간만 만들도록 2패스로 바꿨다(렌더 중 4,950개 배열 할당 제거).
  //    최적화 전후로 **출력이 완전히 같아야** 한다. 무작위 대신 고정 케이스로 잠근다.
  test('큰 역전에서도 재생 구간이 상한을 지키고 마지막은 최종 순서다', () => {
    const bigFrom = Array.from({ length: 40 }, (_, i) => `u${i}`);
    const bigTo = [...bigFrom].reverse(); // 완전 역순 = 역전 780번
    const finalSeconds = new Map(bigFrom.map((k, i) => [k, 1000 + i * 10]));
    const startSeconds = new Map(bigFrom.map((k) => [k, 500]));
    const frames = rankSwapFrames(bigFrom, bigTo, finalSeconds, startSeconds);

    // 리드 프레임 + 자리이동 프레임이 쌍으로 나오므로 프레임 수는 2 × 재생 단계 수다.
    expect(frames.length).toBe(2 * SWAP_MAX_STEPS);
    expect(frames[frames.length - 1].order).toEqual(bigTo);
    // 마지막 프레임은 덮어쓰기가 없다 = 서버 최종값 그대로.
    expect(frames[frames.length - 1].seconds.size).toBe(0);
  });

  test('상한 이하의 역전은 스냅샷 축소와 무관하게 전부 재생된다', () => {
    const smallFrom = ['a', 'b', 'c', 'd', 'e'];
    const smallTo = ['c', 'a', 'b', 'd', 'e']; // 역전 2번
    const finalSeconds = new Map(smallTo.map((k, i) => [k, 900 - i * 10]));
    const startSeconds = new Map(smallFrom.map((k) => [k, 800]));
    const frames = rankSwapFrames(smallFrom, smallTo, finalSeconds, startSeconds);
    expect(frames.length).toBe(4);
    expect(frames[frames.length - 1].order).toEqual(smallTo);
  });
});
