import { useMemo } from 'react';
import {
  withSpring,
  withTiming,
  type AnimatableValue,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { staggerDelay } from '@/constants/motion';
import { useReduceMotion } from '@/hooks/useReduceMotion';

// '동작 줄이기'(손쉬운 사용 › 동작) 단일 게이트 (GROMO-1381 / 설계 §3).
//
// 이 앱은 애니메이션 시스템을 세 가지 쓴다. 끄는 법이 각각 다르다:
//   imperative(withTiming/withSpring) → 애니메이션 대신 **즉시 대입**
//   CSS(animationName/transitionProperty) → **스타일 객체 자체를 undefined로 드롭**
//   layout(entering=/LinearTransition)   → prop을 undefined로
// 셋 중 하나만 덮으면 나머지가 접근성 설정을 무시한다. 그래서 한 훅에 모아 둔다.
//
// ⚠️ reanimated 내장 ReduceMotion.System은 쓰지 않는다 (정책 D6). 그쪽은 모듈 로드 시 1회
//    계산한 정적 플래그라 설정을 바꿔도 앱 재시작 전까지 반영되지 않는다. 앱 안에 '동작 줄이기'
//    진실이 두 개 생기면 안 되므로 전부 이 훅을 통과시킨다.
//
// ⚠️ 축하 연출도 예외가 아니다 (정책 D7). 다만 **파티클만 생략**하고 모달·햅틱·문구는 남긴다 —
//    축하가 사라지는 게 아니라 44조각이 도는 것만 사라진다.

export type Motion = {
  /** 시스템 '동작 줄이기'가 켜져 있는가. 확정 전(비동기 조회 중)에는 보수적으로 true. */
  reduce: boolean;
  /**
   * reduce면 애니메이션 없이 목표값을 그대로 돌려준다.
   * ⚠️ JS 스레드 전용 — useAnimatedStyle·useAnimatedReaction·runOnUI 안에서 호출 금지.
   *    (훅 반환값은 JS 클로저다. 워클릿 안에서 분기해야 하면 `reduce`를 shared value로 옮겨 읽을 것)
   */
  timing<V extends AnimatableValue>(to: V, cfg?: WithTimingConfig): V;
  /** ⚠️ timing과 동일 — 워클릿 안에서 호출 금지 */
  spring<V extends AnimatableValue>(to: V, cfg?: WithSpringConfig): V;
  /**
   * CSS 애니메이션 스타일·layout 애니메이션 prop을 reduce면 통째로 끈다.
   * RN이 스타일 배열의 undefined를 무시하므로 호출부에 조건문이 필요 없다:
   *   `style={[s.card, m.css(enterUp(i))]}`
   */
  css<S>(style: S): S | undefined;
  /** reduce면 0. 단계 시퀀스는 지연만 없애고 **반드시 완주시킨다** — 아래 주석 참고. */
  delay(ms: number): number;
  /** reduce면 0. 아니면 staggerMaxSteps 상한을 적용한 시차. */
  stagger(index: number, step?: number): number;
};

/**
 * ⚠️ `delay()`가 왜 필요한가 — reduce-motion 확산에서 가장 흔한 버그.
 *    LeagueResultScreen처럼 setTimeout 단계 시퀀스로 연출을 진행하는 화면은, 애니메이션만 끄고
 *    타이머를 없애면 **단계가 진행되지 않아 화면이 멈춘다.** delay를 0으로 만들면 시퀀스는
 *    완주하고 시각 효과만 사라진다. 타이머 자체를 걷어내지 말 것.
 *
 * ⚠️ 재생 도중 설정이 켜졌을 때 중간 상태로 굳지 않게 하려면, imperative 애니메이션을 거는
 *    useEffect의 의존성 배열에 `m.reduce`를 반드시 포함시킨다. CSS 경로는 스타일이 사라지면서
 *    기본 스타일로 되돌아가므로 별도 처리가 필요 없다.
 */
export function useMotion(): Motion {
  const reduce = useReduceMotion();

  return useMemo<Motion>(
    () => ({
      reduce,
      timing: (to, cfg) => (reduce ? to : withTiming(to, cfg)),
      spring: (to, cfg) => (reduce ? to : withSpring(to, cfg)),
      css: (style) => (reduce ? undefined : style),
      delay: (ms) => (reduce ? 0 : ms),
      stagger: (index, step) => (reduce ? 0 : staggerDelay(index, step)),
    }),
    [reduce],
  );
}
