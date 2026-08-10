// 순위 재정렬 큐 — 정본 docs/prd/motion/low-level-design.md §6.
//
//   "맨 아래에서 맨 위까지 **한 칸씩** 4단계. 여러 칸을 한 번에 뛰면 결과만 남고 과정이 사라진다."
//
// 서버가 8위→4위처럼 여러 칸을 한 번에 갈아끼워도 중간 순서를 거쳐 가야 한다는 계약을 잠근다.
//
// ⚠️ 애니메이션의 중간 프레임·타이밍·이징은 단언하지 않는다(워클릿은 jest에서 목이라 실행되지
//    않는다 — 정책 D14). 여기서 보는 것은 **순수 로직이 만들어내는 중간 배열**뿐이다.
import { rankSwapQueue, SWAP_MAX_STEPS } from './rankSwap';

/** 두 순서가 '인접한 두 칸을 맞바꾼 관계'인지 — 한 칸씩 재생한다는 계약의 실질 */
function isSingleAdjacentSwap(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return false;
  const diff: number[] = [];
  for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) diff.push(i);
  if (diff.length !== 2) return false;
  const [i, j] = diff;
  return j === i + 1 && before[i] === after[j] && before[j] === after[i];
}

const seq = (n: number): string[] => Array.from({ length: n }, (_, i) => `u${i}`);

describe('rankSwapQueue — 한 칸씩', () => {
  test('8위→4위는 인접 스왑 4단계로 쪼개진다(리드 프레임 + 4)', () => {
    const from = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'me'];
    const to = ['a', 'b', 'c', 'me', 'd', 'e', 'f', 'g'];

    const queue = rankSwapQueue(from, to);

    // [0]은 리드 프레임 — 자리는 그대로다(값만 먼저 갱신되는 구간)
    expect(queue[0]).toEqual(from);
    expect(queue).toHaveLength(5);
    for (let i = 1; i < queue.length; i += 1) {
      expect(isSingleAdjacentSwap(queue[i - 1], queue[i])).toBe(true);
    }
    // 마지막은 반드시 최종 순서
    expect(queue[queue.length - 1]).toEqual(to);
    // 실제로 거쳐 가는 중간 순서까지 못 박는다 — 한 칸씩 올라간다
    expect(queue).toEqual([
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'me'],
      ['a', 'b', 'c', 'd', 'e', 'f', 'me', 'g'],
      ['a', 'b', 'c', 'd', 'e', 'me', 'f', 'g'],
      ['a', 'b', 'c', 'd', 'me', 'e', 'f', 'g'],
      ['a', 'b', 'c', 'me', 'd', 'e', 'f', 'g'],
    ]);
  });

  test('밀려나는 행도 함께 한 칸씩 움직인다 — 두 행이 교대로 자리를 맞바꾼다', () => {
    // c가 두 칸 올라가면 a·b가 각각 한 칸씩 밀린다
    const queue = rankSwapQueue(['a', 'b', 'c'], ['c', 'a', 'b']);
    expect(queue).toEqual([
      ['a', 'b', 'c'],
      ['a', 'c', 'b'],
      ['c', 'a', 'b'],
    ]);
  });

  test('순서가 그대로면 재생할 단계가 없다', () => {
    const order = ['a', 'b', 'c'];
    expect(rankSwapQueue(order, order)).toEqual([order]);
  });

  test('구성원이 바뀌면(진입·이탈) 단계를 만들지 않고 최종 배열로 간다', () => {
    // 인접 스왑 연출은 행 노드의 동일성을 전제한다(정본 §6) — 전제가 깨지면 과정이 무의미하다
    expect(rankSwapQueue(['a', 'b', 'c'], ['a', 'b', 'z'])).toEqual([['a', 'b', 'z']]);
    expect(rankSwapQueue(['a', 'b'], ['a', 'b', 'c'])).toEqual([['a', 'b', 'c']]);
    expect(rankSwapQueue([], ['a', 'b'])).toEqual([['a', 'b']]);
  });

  test('키에 중복이 있으면 큐를 만들지 않는다 — 어느 행이 어느 자리인지 정할 수 없다', () => {
    expect(rankSwapQueue(['a', 'a', 'b'], ['b', 'a', 'a'])).toEqual([['b', 'a', 'a']]);
  });
});

describe('rankSwapQueue — 상한', () => {
  // 20위→1위를 한 칸씩 다 재생하면 19단계 × 300ms = 5.7초 동안 목록이 계속 움직인다.
  // 초과분은 **버리지 않고 첫 한 단계로 묶어** 시차 상한(M.staggerMaxSteps)과 같은 규율을 쓴다.
  test('19칸 상승도 자리 이동은 상한(SWAP_MAX_STEPS)까지만 한다', () => {
    const from = seq(20);
    const to = ['u19', ...seq(19)];

    const queue = rankSwapQueue(from, to);

    expect(queue[0]).toEqual(from); // 리드 프레임은 언제나 현재 순서
    expect(queue).toHaveLength(SWAP_MAX_STEPS + 1); // 리드 + 자리 이동 SWAP_MAX_STEPS회
    expect(queue[queue.length - 1]).toEqual(to);
    // 첫 이동만 여러 칸을 한 번에 묶고(초과분), 나머지는 한 칸씩 — 도착은 그대로 읽힌다
    expect(isSingleAdjacentSwap(queue[0], queue[1])).toBe(false);
    for (let i = 2; i < queue.length; i += 1) {
      expect(isSingleAdjacentSwap(queue[i - 1], queue[i])).toBe(true);
    }
  });

  test('상한이 1이면 곧장 최종 순서로 간다', () => {
    const queue = rankSwapQueue(['a', 'b', 'c'], ['c', 'a', 'b'], 1);
    expect(queue).toEqual([
      ['a', 'b', 'c'],
      ['c', 'a', 'b'],
    ]);
  });
});
