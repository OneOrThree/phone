// useStagedRanking — 서버가 새 순위 배열을 한 번에 갈아끼워도 **한 칸씩** 재생한다는 계약.
// 정본 docs/prd/motion/low-level-design.md §6 (스왑 간격 300ms · 기록 갱신 후 스왑까지 90ms).
//
// 잠그는 규칙 셋:
//   ① 여러 칸 상승은 중간 순서를 거쳐 간다 (한 번의 긴 이동이 아니다)
//   ② '동작 줄이기'면 중간 단계 없이 최종 배열로 즉시 간다
//   ③ 재생 도중 또 갱신이 오면 큐가 쌓이지 않는다 — 지금 화면 순서에서 새 목표로 갈아탄다
//
// ⚠️ 애니메이션의 중간 프레임·이징은 단언하지 않는다(워클릿은 jest에서 목이다 — 정책 D14).
//    여기서 보는 것은 훅이 돌려주는 **배열의 순서**뿐이다.
import { act, renderHook } from '@testing-library/react-native';
import { useStagedRanking } from './useStagedRanking';
import { SWAP_GAP_MS, SWAP_LEAD_MS } from './rankSwap';

let mockReduce = false;
let mockReady = true;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => mockReady,
}));

interface Row {
  userId: string;
  seconds: number;
}
const rows = (ids: string[], seconds = 0): Row[] => ids.map((userId) => ({ userId, seconds }));
const idsOf = (list: Row[]): string[] => list.map((r) => r.userId);

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

describe('한 칸씩 재생', () => {
  test('4위→1위 갱신은 세 번의 인접 스왑을 거쳐 도착한다', async () => {
    const before = rows(['a', 'b', 'c', 'me']);
    const { result, rerender } = await mount(before);
    expect(idsOf(result.current)).toEqual(['a', 'b', 'c', 'me']);

    // 서버가 새 순위 배열을 통째로 교체 — 나는 4위에서 1위가 됐다
    const after = rows(['me', 'a', 'b', 'c'], 999);
    await act(async () => {
      rerender(after);
    });

    // 리드 프레임: 자리는 그대로인데 **값은 이미 최신**이다
    //   (정본 "자리가 바뀌기 직전에 내 기록과 막대가 먼저 자란다")
    expect(idsOf(result.current)).toEqual(['a', 'b', 'c', 'me']);
    expect(result.current.every((r) => r.seconds === 999)).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_GAP_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'me', 'b', 'c']);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_GAP_MS);
    });
    expect(idsOf(result.current)).toEqual(['me', 'a', 'b', 'c']);
  });

  test('구성원이 바뀌는 갱신(첫 로드·리그 전환)은 곧장 최신 배열이다', async () => {
    const { result, rerender } = await mount([]);
    const loaded = rows(['a', 'b', 'c']);
    await act(async () => {
      rerender(loaded);
    });
    expect(result.current).toBe(loaded);
  });
});

describe("'동작 줄이기'", () => {
  test('reduce면 중간 단계 없이 최종 배열로 즉시 간다', async () => {
    mockReduce = true;
    const { result, rerender } = await mount(rows(['a', 'b', 'c', 'me']));
    const after = rows(['me', 'a', 'b', 'c']);
    await act(async () => {
      rerender(after);
    });
    expect(result.current).toBe(after);
  });

  test('아직 미확정(ready=false)이어도 낡은 순서를 붙들지 않는다', async () => {
    // useReduceMotion은 확정 전을 보수적으로 true로 읽는다. 그 값으로 시퀀스를 시작할 수는
    // 없지만, 확정될 때까지 기다리면 낡은 순위가 화면에 남는다 — 즉시 반영을 택했다.
    mockReduce = true;
    mockReady = false;
    const { result, rerender } = await mount(rows(['a', 'b', 'c', 'me']));
    const after = rows(['me', 'a', 'b', 'c']);
    await act(async () => {
      rerender(after);
    });
    expect(result.current).toBe(after);
  });

  test('재생 도중 reduce가 켜지면 남은 단계를 건너뛰고 최종 배열로 간다', async () => {
    const { result, rerender } = await mount(rows(['a', 'b', 'c', 'me']));
    const after = rows(['me', 'a', 'b', 'c']);
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
    // 예약돼 있던 나머지 단계가 뒤늦게 순서를 되돌리지 않는다
    await act(async () => {
      jest.advanceTimersByTime(SWAP_GAP_MS * 5);
    });
    expect(result.current).toBe(after);
  });
});

describe('재생 도중 재갱신', () => {
  test('큐가 쌓이지 않는다 — 지금 화면 순서에서 새 목표로 갈아탄다', async () => {
    const { result, rerender } = await mount(rows(['a', 'b', 'c', 'me']));
    await act(async () => {
      rerender(rows(['me', 'a', 'b', 'c']));
    });
    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);

    // 아직 두 단계가 남아 있는데 새 응답이 도착 — 이번엔 내가 다시 밀려 원래 자리로 간다
    const reverted = rows(['a', 'b', 'c', 'me']);
    await act(async () => {
      rerender(reverted);
    });
    // 버려진 큐의 다음 단계(['a','me','b','c'])로 튀지 않는다 — 화면 순서 그대로에서 다시 출발
    expect(idsOf(result.current)).toEqual(['a', 'b', 'me', 'c']);

    await act(async () => {
      jest.advanceTimersByTime(SWAP_LEAD_MS);
    });
    expect(result.current).toBe(reverted);

    // 살아 있는 시퀀스는 하나뿐이라, 시간이 더 흘러도 순서가 다시 흔들리지 않는다
    await act(async () => {
      jest.advanceTimersByTime(SWAP_GAP_MS * 5);
    });
    expect(result.current).toBe(reverted);
  });
});
