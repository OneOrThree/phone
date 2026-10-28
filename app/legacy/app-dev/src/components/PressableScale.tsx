import type { ReactNode, Ref } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { M } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { hapticLight, hapticMedium, hapticSelect } from '@/utils/haptics';
import { playTapSound } from '@/utils/sound';

// 눌림 피드백 공용 버튼 — 스케일 축소 + 스프링 복귀 + (선택) 햅틱 + (선택) 탭 효과음.
// 화면마다 activeOpacity/애니메이션을 따로 구현하지 않도록 이 컴포넌트 하나로 통일한다.
// TouchableOpacity 자리에 그대로 끼울 수 있게 style/레이아웃 계약은 Pressable과 동일하다
// (transform만 얹으므로 부모의 flex·absolute 배치가 그대로 유지된다).
//
// 톤 기준(활기 있되 캐주얼하지 않게): 눌림 M.dur.press(110ms)로 즉각 반응하고,
// 복귀는 얕은 오버슛 스프링(이동량의 16% 초과 · 안착 ≈367ms @2% 허용대)으로 탄력을 준다.
// ⚠️ 안착 수치는 허용대를 밝히지 않으면 의미가 없다 — 같은 스프링이 5% 허용대면 ≈242ms다.
// 그 이상 튀는 연출(M.spring.bouncy)은 축하 표면에서만 쓴다.
// ⚠️ 오버슛 상한은 배율이 아니라 **이동량 대비 비율**이다. 화면에 보이는 최대 배율은 scaleTo에
//    비례한다 — 기본 0.96이면 1.006이지만 작은 아이콘 버튼(scaleTo 0.90)은 1.016까지 튄다.
//    0.90보다 깊게 주지 말 것.
// ⚠️ 눌림은 110ms에서 올리지 않는다 — 눌림이 늦으면 "활기"가 아니라 "렉"으로 읽힌다.
//    활기는 복귀에서 만든다.
// 값은 M.spring.press가 정본 — 앱 전역 버튼이 여기를 지나므로 이 값이 곧 앱의 모션 톤이다.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticKind = 'light' | 'medium' | 'select';

// children은 Pressable의 함수형(state => ReactNode) 형태를 제외한다 —
// 렌더가 {children} 직접이라 함수를 넘기면 깨진다(style을 함수형에서 제외한 것과 같은 이유).
export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  /** 눌렸을 때 줄어드는 배율. 작은 아이콘 버튼은 0.96이 잘 안 보여 0.90~0.94를 준다. */
  scaleTo?: number;
  /** 택틸 피드백 종류. 기본은 없음 — 주요 CTA에서만 켠다(과용 금지). */
  haptic?: HapticKind | false;
  /** 탭 효과음. 이 컴포넌트를 붙이는 지점 자체가 선별돼 있어 기본 on. */
  sound?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** 호스트 뷰 ref — measureInWindow 등 레이아웃 측정용(팝오버·드로어 앵커). */
  ref?: Ref<View>;
}

function fireHaptic(kind: HapticKind): void {
  if (kind === 'light') hapticLight();
  else if (kind === 'medium') hapticMedium();
  else hapticSelect();
}

export function PressableScale({
  scaleTo = 0.96,
  haptic = false,
  sound = true,
  // 앱의 주요 버튼이 전부 이 컴포넌트를 지나므로 VoiceOver가 "버튼"으로 읽도록 기본값을 준다.
  // 탭바처럼 다른 역할이 맞는 곳은 호출부에서 덮어쓴다(예: accessibilityRole="tab").
  accessibilityRole = 'button',
  style,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  // 시스템 '동작 줄이기'(HIG)가 켜져 있으면 스케일은 생략하고 햅틱·사운드만 남긴다.
  // ⚠️ m.timing / m.spring은 JS 스레드 전용이다. 아래 두 곳은 이벤트 핸들러(JS 스레드)라 안전하다.
  const m = useMotion();

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      accessibilityRole={accessibilityRole}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        // ⚠️ 여기서 m.timing을 쓰면 안 된다 — reduce일 때 scaleTo가 즉시 대입되어 오히려
        //    축소가 '순간이동'으로 보인다. reduce면 press-in 자체를 생략한다.
        if (!m.reduce) {
          scale.value = m.timing(scaleTo, { duration: M.dur.press, easing: M.curve.out.fn });
        }
        // 피드백은 눌리는 순간에 — press-out까지 기다리면 반응이 늦게 느껴진다.
        if (haptic) fireHaptic(haptic);
        if (sound) playTapSound();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        // '동작 줄이기'가 눌린 도중에 켜져도 축소된 채로 굳지 않게 항상 원복한다(즉시 대입).
        // m.spring은 reduce면 1을 그대로 돌려주므로 이 한 줄이 두 경로를 모두 만족한다.
        scale.value = m.spring(1, M.spring.press);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
