import type { ReactNode } from 'react';
import Animated from 'react-native-reanimated';
import type { CSSAnimationProperties } from 'react-native-reanimated';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import { useRef } from 'react';
import { startFrameOf } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';

// 진입 연출 하나를 감싸는 최소 래퍼 (GROMO-1381).
//
// ⚠️ **뷰를 새로 끼우는 컴포넌트가 아니다.** 원래 있던 `Animated.View`를 그대로 대신한다 —
//    렌더 트리 깊이도 testID 경로도 바뀌지 않으므로 Maestro 셀렉터 계약(결정 D-04)이 유지된다.
//
// 왜 필요한가 — `m.enter`의 진입 여부 결정은 `useMotion()`을 호출한 **컴포넌트 인스턴스 단위**로
// 얼린다(그래야 이미 보이던 노드에 스타일이 뒤늦게 붙는 사고가 없다). 그런데 화면 컴포넌트는
// 오래 살아 있고, 그 안에서 **나중에 나타나는 요소**(비동기 응답으로 늘어난 차트 막대, visible로
// 열리는 모달 안의 팝, 재조회로 추가된 리스트 행)는 화면의 옛 결정에 묶인다. 그러면 사용자가
// '동작 줄이기'를 켠 뒤에도 새 요소가 애니메이션되거나, 끈 뒤에도 연출을 못 받는다(codex 리뷰).
//
// 이 컴포넌트는 **요소와 함께 마운트되며 자기 useMotion을 호출**한다 — 결정 경계가 곧 요소다.
// 늦게 나타나는 요소·키로 remount되는 요소는 전부 이걸 쓴다.
export function Enter({
  preset,
  style,
  active = true,
  children,
  ...rest
}: {
  /** 진입 프리셋(enterUp·fadeIn·pop·growUp). 참조가 캐싱된 값이어야 한다. */
  preset: CSSAnimationProperties;
  style?: StyleProp<ViewStyle>;
  /**
   * 진입할 준비가 됐는가. `false`면 프리셋을 붙이지 않고 `style`만 적용한다 —
   * 호출부가 "아직 기다리는 중"의 모습(대개 시작 프레임)을 직접 주는 경우에 쓴다.
   * (예: 그림이 아직 안 올라왔다 · 데이터가 아직 안 왔다)
   */
  active?: boolean;
  children?: ReactNode;
} & Omit<ViewProps, 'style'>) {
  const m = useMotion();
  // ⚠️ 진입 여부는 **`active`가 처음 true가 되는 시점**에 정한다. 마운트 시점에 정하면,
  //    그림·데이터를 기다리는 사이 사용자가 설정을 바꿨을 때 과거 결정으로 재생하거나
  //    생략한다(codex 리뷰). `useMotion`의 인스턴스 단위 고정만으로는 이 창을 못 덮는다 —
  //    그쪽은 "마운트 시점", 여기서 필요한 건 "연출이 실제로 시작될 수 있게 된 시점"이다.
  //    ⚠️ 하위 트리를 remount하지 않는다(key 교체). 자식이 이미지라면 onLoad가 다시 돌아
  //       active를 만드는 신호가 순환한다.
  const decided = useRef<boolean | null>(null);
  if (decided.current === null && active && m.ready) decided.current = !m.reduce;

  const enterStyle =
    !active || decided.current === false
      ? undefined
      : decided.current
        ? preset
        : // 아직 확정 전 — 시작 프레임에서 기다린다.
          startFrameOf(preset);

  return (
    <Animated.View style={[style, enterStyle]} {...rest}>
      {children}
    </Animated.View>
  );
}
