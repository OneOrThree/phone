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
//
// GROMO-1475 이후, 아래 규칙들은 전부 **두 불변식이 동시에 성립하는 입력**에서의 계약이다.
// 성립하지 않는 입력(점수 감소 · 최종값이 최종 순서와 어긋남 · 아래 행의 출발값이 위 행의
// 최종값 초과)에서는 계획 자체가 만들어지지 않는다(빈 배열 = 최신 배열로 즉시). 결정 로그 N01.
import {
  rankSwapFrames,
  SWAP_GAP_MS,
  SWAP_LEAD_MS,
  SWAP_MAX_STEPS,
  type RankSwapFrame,
} from './rankSwap';

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

/**
 * **불변식 ① — 프레임 정합**을 계획 전체에 대해 단언한다 (GROMO-1475).
 *
 * 각 프레임의 표시 기록은 그 프레임의 순서를 따라 비증가다. 예외는 하나뿐이고 그건 버그가
 * 아니라 연출이다 — **바로 다음 프레임에서 자리를 맞바꾸는 쌍**은 역전해도 된다. 리드 프레임이
 * 일부러 "바로 위 사람을 앞지른 값"을 먼저 보여 주는 게 자리 이동의 원인이기 때문이다(정본 §6).
 * 그 역전은 LEAD(90ms) 뒤 자리 이동으로 곧바로 해소된다.
 *
 * ⚠️ **한 프레임만 보는 단언으로는 부족하다.** 티켓이 지목한 결함은 "어떤 프레임에서" 아래 행이
 *    위 행보다 큰 기록을 300ms 보이는 것이라, 계획 전부를 훑어야 잡힌다.
 */
function expectFramesOrdered(frames: RankSwapFrame[], final: Map<string, number>): void {
  const bad: string[] = [];
  frames.forEach((frame, fi) => {
    const next = frames[fi + 1];
    const nextRank = next === undefined ? null : new Map(next.order.map((k, i) => [k, i]));
    for (let i = 0; i + 1 < frame.order.length; i += 1) {
      const upper = frame.order[i];
      const lower = frame.order[i + 1];
      // 다음 프레임에서 아래 행이 위 행을 앞지른다 = 지금의 역전이 그 이동의 '원인'이다
      if (nextRank !== null && nextRank.get(lower)! < nextRank.get(upper)!) continue;
      const u = shownAt(frame, upper, final);
      const l = shownAt(frame, lower, final);
      if (u < l) bad.push(`frame ${fi}: ${upper}(${u}) < ${lower}(${l})`);
    }
  });
  expect(bad).toEqual([]);
}

/**
 * **불변식 ② — 기록 불감소**를 계획 전체에 대해 단언한다.
 * 각 행의 값은 `[직전 표시값, 서버 최종값]` 안이고, 프레임을 지나며 줄지 않는다.
 */
function expectRecordsInRange(
  frames: RankSwapFrame[],
  start: Map<string, number>,
  final: Map<string, number>,
): void {
  const bad: string[] = [];
  const keys = frames.length === 0 ? [] : frames[0].order;
  for (const key of keys) {
    const floor = start.get(key) ?? final.get(key)!;
    let prev = floor;
    frames.forEach((frame, fi) => {
      const v = shownAt(frame, key, final);
      if (v < prev) bad.push(`frame ${fi}: ${key} ${prev} → ${v} (줄었다)`);
      if (v > final.get(key)!) bad.push(`frame ${fi}: ${key}=${v} > 최종 ${final.get(key)}`);
      prev = v;
    });
  }
  expect(bad).toEqual([]);
}

/**
 * **아무도 앞지르지 않는 행(순수 밀려남)의 기록은 한 프레임도 덮어쓰지 않는다.**
 *
 * 시나리오에 기댄 사실이 아니라 배정 방식에서 따라 나오는 법칙이다: 어떤 프레임에서 x가 r 위에
 * 있으면 x는 `from`에서든 `to`에서든 이미 r 위였고(인접 스왑은 역전을 만들지 않는다), r이
 * 아무도 앞지르지 않았다면 그 x는 `to`에서도 r 위 = 최종값이 r 이상이다. 즉 r의 천장을 누를
 * 수 있는 행이 없다.
 */
function expectFallersUntouched(frames: RankSwapFrame[], from: string[], to: string[]): void {
  const fromIdx = new Map(from.map((k, i) => [k, i]));
  const toIdx = new Map(to.map((k, i) => [k, i]));
  const bad: string[] = [];
  for (const key of from) {
    const rises = from.some(
      (x) => fromIdx.get(x)! < fromIdx.get(key)! && toIdx.get(x)! > toIdx.get(key)!,
    );
    if (rises) continue;
    frames.forEach((f, fi) => {
      if (f.seconds.has(key)) bad.push(`frame ${fi}: ${key}=${f.seconds.get(key)} (덮어썼다)`);
    });
  }
  expect(bad).toEqual([]);
}

/** 두 불변식 + 도착 보장을 한 번에 — 계획이 비어 있지 않은 모든 시나리오의 공통 계약 */
function expectSoundPlan(
  frames: RankSwapFrame[],
  from: string[],
  to: string[],
  start: Map<string, number>,
  final: Map<string, number>,
): void {
  expect(frames.length).toBeGreaterThan(0);
  expect(frames[0].order).toEqual(from);
  expect(frames[frames.length - 1].order).toEqual(to);
  expect(frames[frames.length - 1].seconds.size).toBe(0);
  expectFramesOrdered(frames, final);
  expectRecordsInRange(frames, start, final);
  expectFallersUntouched(frames, from, to);
}

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

  // ⚠️ 리드 프레임의 이 역전이 **불변식 ①의 유일한 예외**다(expectFramesOrdered 참고).
  //    자리 이동의 '원인'을 먼저 보여 주는 것이라, 없애면 연출 자체가 사라진다.
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
    // me 한 행만이 아니라 **모든 행**이 그렇다 — 프레임 전체를 훑어 확인한다.
    expectRecordsInRange(frames, start, final);
  });

  test('마지막 프레임은 예외 없이 서버 최종값이다 — 중간값이 화면에 남지 않는다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    expect(frames[frames.length - 1].seconds.size).toBe(0);
    expect(shownAt(frames[frames.length - 1], 'me', final)).toBe(10800);
  });

  // ⚠️ 재진술(GROMO-1475): 값이 프레임 전체로 배정되도록 바뀌었어도 이 규칙은 그대로다 —
  //    그리고 이제 **시나리오가 아니라 법칙**이다. 아무도 앞지르지 않는 행 위에는 최종값이 그보다
  //    큰 행만 올 수 있어서 천장이 그 행을 누를 수 없다(expectFallersUntouched 참고).
  //    올라가는 행은 반대로 눌릴 수 있는데, 그게 곧 단계화다 — 다만 **직전 표시값 아래로는
  //    절대 안 간다**(expectRecordsInRange).
  test('밀려나는 행의 기록은 손대지 않는다 — 기록은 줄지 않는다', () => {
    const frames = rankSwapFrames(from, to, final, start);
    for (const f of frames) {
      expect(f.seconds.has('a')).toBe(false);
      expect(f.seconds.has('b')).toBe(false);
      expect(f.seconds.has('c')).toBe(false);
    }
    expectFallersUntouched(frames, from, to);
    expectRecordsInRange(frames, start, final);
  });

  test('계획 전체가 두 불변식을 지킨다', () => {
    expectSoundPlan(rankSwapFrames(from, to, final, start), from, to, start, final);
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
    expectSoundPlan(frames, from, to, start, final);
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

  // ⚠️ 중간 기록이 **아직 넘지 않은 상대**를 앞지르면, 행은 아직 아래인데 숫자는 위인 모순이
  //    다음 단계까지 남는다 — 단계별 기록으로 상승을 설명하려던 연출이 뒤집힌다(codex 리뷰).
  //    ⚠️ **리드 프레임은 예외다.** 거기서는 일부러 바로 위 사람을 넘어선 값을 먼저 보여 준다
  //       — 그게 자리가 뒤따르는 '원인'이다(정본 §6). 자리가 반영된 프레임만 본다.
  //    ⚠️ 재진술(GROMO-1475): 비교는 **`<=`** 다. 위 사람과 **같은 값**까지는 올라가도 된다 —
  //       서버도 동점이면 userId 오름차순으로 순위를 가르므로(LeagueRankingQueryRepository)
  //       "같은 기록인데 아래 자리"는 모순이 아니다. 억지로 1초를 깎으면 그 사용자가 실제로
  //       가진 적 없는 값을 지어내게 된다(옛 구현의 `ceiling - 1`이 그랬다).
  test('자리가 반영된 프레임에서는 표시 기록이 순서와 모순되지 않는다', () => {
    // climbFrom의 c가 3위 → 1위로 오른다. 중간값이 위 두 명을 넘어설 수 있는 배치.
    const climbFrom = ['a', 'b', 'c'];
    const climbTo = ['c', 'a', 'b'];
    const finalSeconds = new Map<string, number>([
      ['c', 5000],
      ['a', 1000],
      ['b', 900],
    ]);
    const startSeconds = new Map<string, number>([['c', 100]]);
    const frames = rankSwapFrames(climbFrom, climbTo, finalSeconds, startSeconds);

    // 프레임은 (리드, 자리이동) 쌍이라 홀수 인덱스가 '자리가 반영된' 프레임이다.
    frames.forEach((f, fi) => {
      if (fi % 2 === 0) return;
      const shownOf = (k: string) => f.seconds.get(k) ?? (finalSeconds.get(k) as number);
      const idx = f.order.indexOf('c');
      for (let i = 0; i < idx; i += 1) {
        expect(shownOf('c')).toBeLessThanOrEqual(shownOf(f.order[i]));
      }
    });
    // 자리 프레임만이 아니라 계획 전체가 정합해야 한다(리드 프레임의 의도된 역전만 예외).
    expectSoundPlan(frames, climbFrom, climbTo, startSeconds, finalSeconds);
  });

  // ⚠️ 재진술(GROMO-1475): 옛 구현은 "방금 넘은 상대보다 크고 다음 상대보다 작은 정수"가 없으면
  //    그 스왑의 프레임을 통째로 건너뛰었다(동점 블록 묶기). 지금은 프레임 전체를 보고 값을
  //    배정하므로 **묶어서 건너뛸 이유가 없다** — 동점 상대와 같은 값에 머무르면 그만이고,
  //    자리 이동은 한 칸씩 그대로 재생된다. 잠그는 것은 그때도 순서와 숫자가 어긋나지 않는다는
  //    사실이다(없는 1초를 지어내지 않는다).
  test('동점 블록도 한 칸씩 지나가되 순서와 숫자가 어긋나지 않는다', () => {
    const tieFrom = ['a', 'b', 'c'];
    const tieTo = ['c', 'a', 'b'];
    const finalSeconds = new Map<string, number>([
      ['c', 200],
      ['a', 100],
      ['b', 100],
    ]);
    const startSeconds = new Map<string, number>([['c', 0]]);
    const frames = rankSwapFrames(tieFrom, tieTo, finalSeconds, startSeconds);

    // 자리가 반영된 프레임(홀수 인덱스)마다 순서와 숫자가 모순되지 않아야 한다.
    frames.forEach((f, fi) => {
      if (fi % 2 === 0) return;
      const shownOf = (k: string) => f.seconds.get(k) ?? (finalSeconds.get(k) as number);
      const idx = f.order.indexOf('c');
      for (let i = 0; i < idx; i += 1) {
        expect(shownOf('c')).toBeLessThanOrEqual(shownOf(f.order[i]));
      }
    });
    // 스왑 2회가 그대로 재생된다(프레임 4장) — 동점이라고 단계를 삼키지 않는다.
    expect(frames).toHaveLength(4);
    // 동점 구간에서 c가 보여 주는 값은 상대와 같은 100까지다 — 101 같은 숫자를 지어내지 않는다.
    expect(shownAt(frames[0], 'c', finalSeconds)).toBe(100);
    expectSoundPlan(frames, tieFrom, tieTo, startSeconds, finalSeconds);
  });
});

describe('rankSwapFrames — 프레임 전체 정합 (GROMO-1475)', () => {
  // ⚠️ 티켓이 지목한 그 상황이다. b·c·d의 기록이 **한 응답에서 함께** 올랐다.
  //    옛 배정은 '상승 행 하나'만 제약해서, 스왑에 참여하지 않는 d가 곧장 서버 최종값(800)으로
  //    뛰는 동안 아직 자기 차례가 오지 않은 c는 출발값(0)에 머물렀다 — 3위 c(0)가 4위 d(800)보다
  //    작은 프레임이 390ms 표시됐다(codex 리뷰, PR #561).
  test('여러 사용자의 기록이 함께 오른 응답에서도 모든 프레임이 순서와 맞는다', () => {
    const from = ['a', 'b', 'c', 'd'];
    const to = ['b', 'c', 'a', 'd'];
    const final = secs([
      ['b', 5700],
      ['c', 4400],
      ['a', 4300],
      ['d', 800],
    ]);
    const start = secs([
      ['a', 2000],
      ['b', 200],
      ['c', 0],
      ['d', 0],
    ]);
    const frames = rankSwapFrames(from, to, final, start);

    // 스왑 2회(b가 a를, c가 a를 앞지른다) = 프레임 4장
    expect(frames).toHaveLength(4);
    // 옛 구현이 깨진 바로 그 자리 — c는 한 프레임도 d 아래로 내려가지 않는다
    for (const f of frames) {
      expect(shownAt(f, 'c', final)).toBeGreaterThanOrEqual(shownAt(f, 'd', final));
    }
    expectSoundPlan(frames, from, to, start, final);
  });

  // ⚠️ 결정 로그 N01 — 두 불변식이 동시에 성립할 수 없으면 **단계화를 통째로 생략**한다.
  //    점수 감소 갱신에 이미 쓰던 처방이다. 기록을 깎아 보이지도, 깨진 프레임을 보이지도 않는다.
  test('모순 입력에서는 빈 계획 — 아래 행의 출발값이 위 행의 최종값을 넘는 배치', () => {
    // 리드 프레임(자리 이동 90ms 전)이 화면에 있는 동안 새 응답이 도착한 상황이다:
    // 화면 순서는 아직 [a, me]인데 표시 기록은 me가 이미 a를 앞질러 있다(그게 리드 프레임이다).
    // ①을 지키려면 me를 5400 이하로 눌러야 하고, 그 순간 ②(기록 불감소)가 깨진다.
    const from = ['a', 'me'];
    const to = ['me', 'a'];
    const final = secs([
      ['me', 7200],
      ['a', 5400],
    ]);
    const start = secs([
      ['a', 5400],
      ['me', 7200],
    ]);
    expect(rankSwapFrames(from, to, final, start)).toEqual([]);
  });

  test('최종값이 최종 순서와 어긋나는 응답도 빈 계획 — 마지막 프레임을 우리가 고칠 수 없다', () => {
    // 서버는 totalFocusSeconds 내림차순으로 순위를 준다. 그게 어긋난 응답(재집계 중간 상태 등)은
    // 마지막 프레임(=서버 최종값 그대로)부터 이미 순서와 모순이라, 중간 단계로 메울 수 없다.
    const from = ['a', 'b', 'c'];
    const to = ['c', 'a', 'b'];
    const final = secs([
      ['c', 100],
      ['a', 900],
      ['b', 800],
    ]);
    expect(rankSwapFrames(from, to, final, secs([['c', 50]]))).toEqual([]);
  });

  // ⚠️ 마지막 프레임 정규화(`frames[frames.length - 1]`)가 무가드였다 — 재생 프레임이 하나도
  //    나오지 않는 입력이 생기면 TypeError로 리그 화면이 통째로 날아간다(GROMO-1475 #2).
  //    프레임 수가 최소가 되는 입력들을 훑어 "던지지 않는다 + 빈 계획이거나 최종값으로 끝난다"를
  //    잠근다.
  test('재생 단계가 최소인 입력들에서도 던지지 않는다', () => {
    const zeroToOne = secs([
      ['b', 0],
      ['a', 0],
    ]);
    const cases = [
      // 전원 동점 — 옛 구현이라면 모든 스왑이 '동점 묶음'으로 걸러져 프레임 0개가 된다
      { from: ['a', 'b'], to: ['b', 'a'], final: zeroToOne, start: zeroToOne, maxSteps: 6 },
      // 상한 1 = 모든 스왑이 한 단계로 묶인다
      {
        from: ['a', 'b', 'c'],
        to: ['c', 'b', 'a'],
        final: secs([
          ['c', 3],
          ['b', 2],
          ['a', 1],
        ]),
        start: new Map<string, number>(),
        maxSteps: 1,
      },
      // 스왑 1회 · 출발값 없음(전부 최종값에서 출발)
      {
        from: ['a', 'b'],
        to: ['b', 'a'],
        final: secs([
          ['b', 10],
          ['a', 5],
        ]),
        start: new Map<string, number>(),
        maxSteps: SWAP_MAX_STEPS,
      },
      // 기록이 하나도 없는 갱신(전부 0으로 읽힌다)
      {
        from: ['a', 'b'],
        to: ['b', 'a'],
        final: new Map<string, number>(),
        start: new Map<string, number>(),
        maxSteps: SWAP_MAX_STEPS,
      },
    ];
    for (const { from, to, final, start, maxSteps } of cases) {
      const frames = rankSwapFrames(from, to, final, start, maxSteps);
      if (frames.length === 0) continue;
      expect(frames[frames.length - 1].order).toEqual(to);
      expect(frames[frames.length - 1].seconds.size).toBe(0);
      expectFramesOrdered(frames, final);
    }
  });

  // ⚠️ 고정 케이스만으로는 "어떤 갱신에서도"를 말할 수 없다. 결정적 난수로 갱신을 대량 생성해
  //    **던지지 않는다 + 계획이 나왔다면 두 불변식을 지킨다**를 한 번에 훑는다.
  //    (무작위 기대값을 단언하지 않는다 — 단언하는 건 불변식뿐이라 재현성이 유지된다.)
  test('무작위 갱신 600건에서도 두 불변식이 깨지지 않는다', () => {
    let seed = 20260811;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const ri = (n: number): number => Math.floor(rnd() * n);

    let planned = 0;
    let skipped = 0;
    for (let t = 0; t < 600; t += 1) {
      const n = 2 + ri(6);
      const from = Array.from({ length: n }, (_, i) => `u${i}`);
      // 출발값: 대개는 화면 순서대로 내림차순이지만, 다섯 번에 한 번은 뒤섞어 **모순 입력**도 낸다
      const jumbled = t % 5 === 0;
      const start = new Map<string, number>();
      let v = 600 + ri(60) * 10;
      for (const key of from) {
        start.set(key, jumbled ? ri(120) * 10 : v);
        v = Math.max(0, v - ri(40) * 10);
      }
      // 도착값: 각자 0 이상 증가(누적 집중 시간은 줄지 않는다) → 내림차순 정렬이 곧 새 순위
      const final = new Map<string, number>();
      for (const key of from) final.set(key, start.get(key)! + ri(70) * 10);
      const to = [...from].sort((a, b) => final.get(b)! - final.get(a)! || (a < b ? -1 : 1));

      const frames = rankSwapFrames(from, to, final, start);
      if (frames.length === 0) {
        // ⚠️ **멀쩡한 갱신에서 연출이 꺼지면 안 된다.** 모순 판정이 과하면 단계화가 조용히
        //    사라지고 아무 테스트도 빨개지지 않는다 — 뒤섞지 않은 입력은 순서가 그대로일
        //    때(재생할 것이 없다)만 빈 계획이어야 한다.
        if (!jumbled) expect(from).toEqual(to);
        skipped += 1;
        continue;
      }
      planned += 1;
      expectSoundPlan(frames, from, to, start, final);
    }
    // 훑기가 실제로 계획을 만들고 있었는지(전부 빈 계획이면 아무것도 검증하지 못한 것이다)
    expect(planned).toBeGreaterThan(100);
    expect(skipped).toBeGreaterThan(0);
  });
});
