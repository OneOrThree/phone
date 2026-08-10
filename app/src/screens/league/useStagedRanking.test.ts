// useStagedRanking — 서버가 새 순위 배열을 한 번에 갈아끼워도 **순서와 기록을 함께** 한 칸씩
// 재생한다는 계약. 정본 docs/prd/motion/low-level-design.md §6.
//
// 잠그는 규칙:
//   ① 여러 칸 상승은 중간 순서를 거쳐 간다 (한 번의 긴 이동이 아니다)
//   ② 자리가 바뀌기 **직전에** 기록이 먼저 자라고, 그 값은 그 순간 앞지르는 상대보다 위다
//   ③ 재생이 끝나면 순서·기록 모두 서버 최종값이다 (중간값이 남지 않는다)
//   ④ '동작 줄이기'면 중간 단계 없이 최종값으로 즉시 간다
//   ⑤ 재생 도중 또 갱신이 오면 큐가 쌓이지 않는다 — 지금 화면 상태에서 새 목표로 갈아탄다
//
// ⚠️ 애니메이션의 중간 프레임·이징은 단언하지 않는다(워클릿은 jest에서 목이다 — 정책 D14).
//    여기서 보는 것은 훅이 돌려주는 **배열의 순서와 숫자**뿐이다.
import { act, renderHook } from '@testing-library/react-native';
import { useStagedRanking } from './useStagedRanking';
import { SWAP_GAP_MS, SWAP_LEAD_MS } from './rankSwap';

let mockReduce = false;
let mockReady = true;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => mockReady,
  whenReduceMotionReady: () => Promise.resolve(),
}));

interface Row {
  userId: string;
  totalFocusSeconds: number;
}
const rows = (spec: [string, number][]): Row[] =>
  spec.map(([userId, totalFocusSeconds]) => ({ userId, totalFocusSeconds }));
const idsOf = (list: Row[]): string[] => list.map((r) => r.userId);
const secOf = (list: Row[], userId: string): number =>
  list.find((r) => r.userId === userId)!.totalFocusSeconds;

// a·b·c는 자리만 밀리고, me만 4위 → 1위. 기록은 30분에서 3시간으로 뛰었다.
const BEFORE: [string, number][] = [
  ['a', 9000],
  ['b', 7200],
  ['c', 5400],
  ['me', 1800],
];
const AFTER: [string, number][] = [
  ['me', 10800],
  ['a', 9000],
  ['b', 7200],
  ['c', 5400],
];

beforeEach(() => {
  jest.useFakeTimers();
  mockReduce = false;
  mockReady = true;
});
afterEach(() => {
  jest.useRealTimers();
});

async function mount(initial: Row[]) {
  return renderHook((props: Row[]) => useStagedRanking(props), { initialProps: initial });
}

describe('한 칸씩 재생 — 순서와 기록이 함께 간다', () => {
  test('4위→1위는 세 번의 인접 스왑을 거치고, 스왑마다 기록이 먼저 자란다', async () => {
    const before = rows(BEFORE);
    const { result, rerender } = await mount(before);
    expect(result.current).toBe(before);

    const after = rows(AFTER);
    await act(async () => {
      rerender(after);
    });

    // ① 자리는 아직 그대로인데 ② 기록은 이미 c(5400)를 앞질렀다 — 이게 다음 스왑의 이유다.
    //    최종값(10800)을 미리 보여 주지 않는다: 4위 자리에 1위 기록이 붙으면 순서와 숫자가
    //    서로 모순된다(codex 리뷰).
    expect(idsOf(result.current)).toEqual(['a', 'b', 'c', 'me']);
    expect(secOf(result.current, 'me')).toBeGreaterThan(5400);
    expect(secOf(result.current, 'me')).toBeLessThan(10800);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);

    // 다음 칸을 오르기 전에 b(7200)를 앞지른다
    await act(async () => {
      jest.advanceTimersByTime(SWAP_GAP_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);
    expect(secOf(result.current, 'me')).toBeGreaterThan(7200);
    expect(secOf(result.current, 'me')).toBeLessThan(10800);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'me', 'b', 'c']);

    // 마지막 칸 직전의 기록은 서버 최종값이다 — 중간값이 화면에 남지 않는다
    await act(async () => {
      jest.advanceTimersByTime(SWAP_GAP_MS);
    });
    expect(secOf(result.current, 'me')).toBe(10800);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(result.current).toBe(after);
  });

  test('밀려나는 행의 기록은 재생 내내 서버 값 그대로다', async () => {
    const { result, rerender } = await mount(rows(BEFORE));
    await act(async () => {
      rerender(rows(AFTER));
    });
    for (let t = 0; t < 4; t += 1) {
      expect(secOf(result.current, 'a')).toBe(9000);
      expect(secOf(result.current, 'b')).toBe(7200);
      expect(secOf(result.current, 'c')).toBe(5400);
      await act(async () => {
        jest.advanceTimersByTime(SWAP_LEAD_MS + SWAP_GAP_MS);
      });
    }
  });

  test('구성원이 바뀌는 갱신(첫 로드·리그 전환)은 곧장 최신 배열이다', async () => {
    const { result, rerender } = await mount([]);
    const loaded = rows(BEFORE);
    await act(async () => {
      rerender(loaded);
    });
    expect(result.current).toBe(loaded);
  });
});

describe("'동작 줄이기'", () => {
  test('reduce면 중간 단계 없이 최종 순서·최종 기록으로 즉시 간다', async () => {
    mockReduce = true;
    const { result, rerender } = await mount(rows(BEFORE));
    const after = rows(AFTER);
    await act(async () => {
      rerender(after);
    });
    expect(result.current).toBe(after);
  });

  test('아직 미확정(ready=false)이어도 낡은 순서·기록을 붙들지 않는다', async () => {
    // useReduceMotion은 확정 전을 보수적으로 true로 읽는다. 그 값으로 시퀀스를 시작할 수는
    // 없지만, 확정될 때까지 기다리면 낡은 순위가 화면에 남는다 — 즉시 반영을 택했다.
    mockReduce = true;
    mockReady = false;
    const { result, rerender } = await mount(rows(BEFORE));
    const after = rows(AFTER);
    await act(async () => {
      rerender(after);
    });
    expect(result.current).toBe(after);
  });

  test('재생 도중 reduce가 켜지면 남은 단계를 건너뛰고 최종값으로 간다', async () => {
    const { result, rerender } = await mount(rows(BEFORE));
    const after = rows(AFTER);
    await act(async () => {
      rerender(after);
    });
    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);

    mockReduce = true;
    await act(async () => {
      rerender(after);
    });
    expect(result.current).toBe(after);
    // 예약돼 있던 나머지 단계가 뒤늦게 순서·기록을 되돌리지 않는다
    await act(async () => {
      jest.advanceTimersByTime((SWAP_LEAD_MS + SWAP_GAP_MS) * 5);
    });
    expect(result.current).toBe(after);
  });
});

describe('재생 도중 재갱신', () => {
  test('큐가 쌓이지 않는다 — 지금 화면 상태에서 새 목표로 갈아탄다', async () => {
    const { result, rerender } = await mount(rows(BEFORE));
    await act(async () => {
      rerender(rows(AFTER));
    });
    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);

    // 아직 두 칸이 남았는데 새 응답 도착 — 이번엔 c가 크게 올라 1위가 된다.
    // ⚠️ 기록이 **줄지 않는** 갱신이어야 한다. 줄어드는 갱신은 주 경계로 보고 단계화를
    //    건너뛰므로(아래 별도 테스트) 이 시나리오를 못 본다.
    const next = rows([
      ['c', 20000],
      ['me', 10800],
      ['a', 9000],
      ['b', 7200],
    ]);
    await act(async () => {
      rerender(next);
    });
    // 버려진 계획의 다음 단계로 튀지 않는다 — 화면 순서 그대로에서 재출발
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);
  });

  // ⚠️ 주 경계(월요일 KST)·재집계면 같은 구성원이 **새 주 점수**로 재정렬된다. 이전 주 누적을
  //    하한으로 붙들면 새 순서와 옛 기록이 함께 표시되다 마지막에 급락한다(codex 리뷰).
  test('점수가 줄어든 갱신은 단계화하지 않고 곧장 최신 배열이다', async () => {
    const { result, rerender } = await mount(rows(AFTER));
    const resetWeek = rows([
      ['a', 300],
      ['b', 200],
      ['c', 100],
      ['me', 0],
    ]);
    await act(async () => {
      rerender(resetWeek);
    });
    expect(result.current).toBe(resetWeek);
  });
});
