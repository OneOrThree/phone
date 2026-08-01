import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { hapticLight, hapticMedium, hapticSelect } from '@/utils/haptics';
import { playTapSound } from '@/utils/sound';

// 눌림 피드백 공용 버튼 — 스케일 축소 + 스프링 복귀 + (선택) 햅틱 + (선택) 탭 효과음.
// 화면마다 activeOpacity/애니메이션을 따로 구현하지 않도록 이 컴포넌트 하나로 통일한다.
// TouchableOpacity 자리에 그대로 끼울 수 있게 style/레이아웃 계약은 Pressable과 동일하다
// (transform만 얹으므로 부모의 flex·absolute 배치가 그대로 유지된다).
//
// 톤 기준(차분한 포커스 앱): 눌림 110ms, 복귀 스프링은 오버슛이 거의 없는 값 —
// 통통 튀는 연출은 일부러 피했다.

const PRESS_IN_MS = 110;
// damping/stiffness/mass 조합상 약 150ms에 안착. 오버슛 거의 없음.
const SPRING_BACK = { damping: 18, stiffness: 320, mass: 0.6 } as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type HapticKind = 'light' | 'medium' | 'select';

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /** 눌렸을 때 줄어드는 배율. 작은 아이콘 버튼은 0.97이 잘 안 보여 0.90~0.94를 준다. */
  scaleTo?: number;
  /** 택틸 피드백 종류. 기본은 없음 — 주요 CTA에서만 켠다(과용 금지). */
  haptic?: HapticKind | false;
  /** 탭 효과음. 이 컴포넌트를 붙이는 지점 자체가 선별돼 있어 기본 on. */
  sound?: boolean;
  style?: StyleProp<ViewStyle>;
}

function fireHaptic(kind: HapticKind): void {
  if (kind === 'light') hapticLight();
  else if (kind === 'medium') hapticMedium();
  else hapticSelect();
}

export function PressableScale({
  scaleTo = 0.97,
  haptic = false,
  sound = true,
  style,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  // 시스템 '동작 줄이기'(HIG)가 켜져 있으면 스케일은 생략하고 햅틱·사운드만 남긴다.
  const reduceMotion = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        if (!reduceMotion) {
          scale.value = withTiming(scaleTo, {
            duration: PRESS_IN_MS,
            easing: Easing.out(Easing.quad),
          });
        }
        // 피드백은 눌리는 순간에 — press-out까지 기다리면 반응이 늦게 느껴진다.
        if (haptic) fireHaptic(haptic);
        if (sound) playTapSound();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduceMotion) scale.value = withSpring(1, SPRING_BACK);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
