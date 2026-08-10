// useMotion — '동작 줄이기'가 **아직 확정되지 않은** 구간(ready=false). 이 배치에서 서로 다른
// 파일에서 8번 나온 사고의 뿌리라 별도 파일로 잠근다(결정 D-30).
import { renderHook } from '@testing-library/react-native';
import { enterUp, fadeIn, pop, pulse } from '@/constants/motion';
import { useMotion } from './useMotion';

jest.mock('./useReduceMotion', () => ({
  // 미확정 구간에서 useReduceMotion이 돌려주는 보수적 값
  useReduceMotion: () => true,
  useReduceMotionReady: () => false,
}));

describe('useMotion (ready=false)', () => {
  it('ready는 false, reduce는 보수적으로 true다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.ready).toBe(false);
    expect(result.current.reduce).toBe(true);
  });

  // ⚠️ 이게 D-30의 핵심이다. enter가 undefined를 돌려주면 요소가 최종 상태로 먼저 노출되고,
  //    이후 reduce=false로 확정될 때 같은 노드에 애니메이션이 붙으며 시작 상태로 사라졌다가
  //    다시 나타난다. 시작 프레임을 돌려줘야 어느 쪽으로 확정되든 그림이 이어진다.
  it('enter는 진입의 시작 프레임을 돌려준다 — 최종 상태로 먼저 노출하지 않는다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.enter(enterUp(0))).toEqual({
      opacity: 0,
      transform: [{ translateY: 12 }],
    });
    expect(result.current.enter(fadeIn())).toEqual({ opacity: 0 });
    expect(result.current.enter(pop())).toEqual({ transform: [{ scale: 0 }] });
  });

  it('키프레임이 없으면 undefined다 — 붙들 시작 상태가 없다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.enter({ animationName: 'none' })).toBeUndefined();
  });

  // ⚠️ enter는 **진입 전용**이다. pulse처럼 from이 있어도 진입이 아닌 프리셋에 쓰면 확정 전까지
  //    그 값(opacity 0.45)에 붙들린다 — 무한 루프 장식은 css()로 통과시켜야 한다.
  //    이 단언은 그 경계를 문서화한다(pulse에 from이 있다는 사실 자체를 잠근다).
  it('pulse는 진입용이 아니다 — from이 있어도 css()로 다뤄야 한다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.css(pulse)).toBeUndefined();
  });

  // css는 종전 그대로다 — 진입이 아닌 곳(전환·루프)까지 시작 프레임으로 붙들면 안 된다.
  it('css는 종전대로 undefined다 — enter와 역할이 다르다', async () => {
    const { result } = await renderHook(() => useMotion());
    expect(result.current.css(enterUp(0))).toBeUndefined();
  });
});
