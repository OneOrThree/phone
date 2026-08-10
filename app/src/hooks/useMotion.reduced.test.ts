// useMotion — '동작 줄이기'가 **켜진** 경우. 세 가지 애니메이션 시스템을 각각 어떻게 끄는지가
// 이 훅의 전부라, 경로별로 하나씩 잠근다.
import { renderHook } from '@testing-library/react-native';
import { useMotion } from './useMotion';

jest.mock('./useReduceMotion', () => ({
  useReduceMotion: () => true,
  useReduceMotionReady: () => true,
}));

describe('useMotion (reduce=true)', () => {
  it('css는 undefined를 돌려준다 — 스타일 배열에서 사라진다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.reduce).toBe(true);
    expect(result.current.css({ animationName: { from: { opacity: 0 } } })).toBeUndefined();
    // layout 애니메이션 prop도 같은 경로로 끈다
    expect(result.current.css('LinearTransition')).toBeUndefined();
  });

  it('timing·spring은 목표값을 그대로 돌려준다 — 즉시 대입', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.timing(1)).toBe(1);
    expect(result.current.timing(0.96, { duration: 110 })).toBe(0.96);
    expect(result.current.spring(0)).toBe(0);
  });

  it('stagger는 0이다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.stagger(0)).toBe(0);
    expect(result.current.stagger(5)).toBe(0);
  });

  // ⚠️ 이 단언이 reduce-motion 확산에서 가장 중요한 회귀 방어다.
  //    delay를 0으로 만들 뿐 타이머를 없애지 않기 때문에 단계 시퀀스(리그 결과 화면 등)가
  //    끝까지 진행된다. 여기서 undefined/null을 돌려주면 setTimeout이 깨지면서 화면이
  //    중간 단계에 멈춘다.
  it('delay는 0이다 — 단계 시퀀스는 지연만 없애고 완주시킨다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.delay(1100)).toBe(0);
    expect(result.current.delay(0)).toBe(0);
  });
});
