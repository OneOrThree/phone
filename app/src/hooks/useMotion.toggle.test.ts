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

  // 반대 방향은 얼리지 않는다 — 얼리면 접근성 설정을 어긴다.
  it('연출 확정 뒤 설정을 켜면 그때부터 진입을 생략한다', async () => {
    mockReduce = false;
    const { result, rerender } = await renderHook(() => useMotion());
    const style = enterUp(0);
    expect(result.current.enter(style)).toBe(style);

    mockReduce = true; // 사용자가 '동작 줄이기'를 켰다
    await rerender({});
    expect(result.current.enter(style)).toBeUndefined();
  });
});
