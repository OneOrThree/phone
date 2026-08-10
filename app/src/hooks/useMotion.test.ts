// useMotion — '동작 줄이기'가 **꺼진** 경우. 켜진 경우는 useMotion.reduced.test.ts 로 분리했다
// (모듈 목이 파일 스코프라 한 파일에 두 값을 섞을 수 없다).
import { renderHook } from '@testing-library/react-native';
import { M, enterUp } from '@/constants/motion';
import { useMotion } from './useMotion';

jest.mock('./useReduceMotion', () => ({
  useReduceMotion: () => false,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

describe('useMotion (reduce=false)', () => {
  it('css는 스타일을 그대로 통과시킨다', async () => {
    const { result } = await renderHook(() => useMotion());
    const style = { animationName: { from: { opacity: 0 } } };
    expect(result.current.reduce).toBe(false);
    expect(result.current.css(style)).toBe(style);
  });

  it('delay·stagger를 유지한다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.delay(1100)).toBe(1100);
    expect(result.current.stagger(3)).toBe(180);
    expect(result.current.stagger(2, M.stagger.tight)).toBe(80);
    // 상한은 reduce 여부와 무관하게 적용된다
    expect(result.current.stagger(19)).toBe(360);
  });

  it('timing·spring은 애니메이션을 건다 — 목표값을 그대로 돌려주지 않는다', async () => {
    const { result } = await renderHook(() => useMotion());
    // 워클릿이 목이라 반환값의 내용은 단언하지 않는다. "즉시 대입이 아니다"만 잠근다.
    expect(result.current.timing(1)).not.toBe(1);
    expect(result.current.spring(1)).not.toBe(1);
  });

  it('reduce가 바뀌지 않으면 같은 객체를 돌려준다 (useMemo)', async () => {
    const { result, rerender } = await renderHook(() => useMotion());
    const first = result.current;
    await rerender({});
    expect(result.current).toBe(first);
  });

  it('enter는 확정됐고 reduce가 아니면 스타일을 그대로 통과시킨다', async () => {
    const { result } = await renderHook(() => useMotion());
    const style = enterUp(0);
    expect(result.current.enter(style)).toBe(style);
  });
});
