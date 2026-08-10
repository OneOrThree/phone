// useMotion — 확정된 **뒤에** 사용자가 '동작 줄이기'를 토글하는 경우.
// 초기 미확정 구간(useMotion.pending.test.ts)과는 다른 사고다: 이미 화면에 떠 있는 노드에
// 진입 스타일이 뒤늦게 붙어 요소가 사라졌다가 다시 나타난다(codex 리뷰).
import { renderHook } from '@testing-library/react-native';
import { enterUp } from '@/constants/motion';
import { useMotion } from './useMotion';

let mockReduce = true;
jest.mock('./useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

describe('useMotion — 확정 후 설정 토글', () => {
  // ⚠️ 이게 핵심이다. 생략하기로 확정한 컴포넌트에 나중에 스타일을 붙이면, 이미 보이던
  //    요소가 fillMode:'backwards'의 시작 상태로 사라졌다가 다시 나타난다.
  it('생략 확정 뒤 설정을 꺼도 진입을 다시 붙이지 않는다', async () => {
    mockReduce = true;
    const { result, rerender } = await renderHook(() => useMotion());
    expect(result.current.enter(enterUp(0))).toBeUndefined();

    mockReduce = false; // 사용자가 '동작 줄이기'를 껐다
    await rerender({});
    expect(result.current.enter(enterUp(0))).toBeUndefined();
  });

  // ⚠️ 반대 방향도 얼린다. 한쪽만 얼리면 켬→끔 왕복에서 같은 사고가 난다 —
  //    이미 진입을 마친 노드에 스타일이 다시 붙어 시작 상태로 사라졌다 나타난다.
  //    켜져 있는 동안 스타일이 남아도 참조가 그대로라 재생되지 않는다.
  it('연출 확정 뒤에는 설정을 켜도 끄도 결정이 흔들리지 않는다', async () => {
    mockReduce = false;
    const { result, rerender } = await renderHook(() => useMotion());
    const style = enterUp(0);
    expect(result.current.enter(style)).toBe(style);

    mockReduce = true; // 켰다
    await rerender({});
    expect(result.current.enter(style)).toBe(style);

    mockReduce = false; // 다시 껐다 — 붙었다 떨어지는 왕복이 없어야 한다
    await rerender({});
    expect(result.current.enter(style)).toBe(style);
  });

  // 새로 마운트되는 요소는 **그 시점** 설정을 따른다 — 결정 경계가 컴포넌트 마운트이기 때문.
  it('설정을 켠 뒤 새로 마운트되면 진입을 생략한다', async () => {
    mockReduce = false;
    const first = await renderHook(() => useMotion());
    expect(first.result.current.enter(enterUp(0))).toBeDefined();

    mockReduce = true;
    const second = await renderHook(() => useMotion()); // 새 인스턴스 = 새 결정
    expect(second.result.current.enter(enterUp(0))).toBeUndefined();
  });
});
