import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import Animated, { SlideInUp } from 'react-native-reanimated';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

// iOS 알림 드롭 연출 — 화면 위 바깥에서 미끄러져 내려와 목표 지점을 살짝 지나쳤다
// 되돌아오며 안착(스프링 오버슛 = 바운스). 두 카드는 알림이 연달아 오듯 시차를 둔다.
const notificationDrop = (order: number) =>
  SlideInUp.springify()
    .damping(14)
    .stiffness(120)
    .mass(0.9)
    .delay(150 + order * 250);

// W3 · 문제 공감 — "이런 하루, 익숙하지 않으세요?" 공감 카드 2개(알림 드롭 등장).
export default function ProblemEmpathyStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      testID="onboarding.step.problem"
      center
      title={'이런 순간, \n익숙하지 않으세요?'}
      ctaLabel="공감돼요"
      onCta={onNext}
    >
      <View style={s.cards}>
        <Animated.View style={s.card} entering={notificationDrop(0)}>
          <View style={s.iconBox}>
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Rect
                x={6}
                y={2}
                width={12}
                height={20}
                rx={3}
                fill="none"
                stroke={T.accentAlt}
                strokeWidth={1.8}
              />
              <Path
                d="M9 2h6M10 19h4"
                stroke={T.accentAlt}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </Svg>
          </View>
          <Text style={s.cardText}>{'잠시 알림 확인하려고\n핸드폰 들었다가 훌쩍 지나간 시간'}</Text>
        </Animated.View>

        <Animated.View style={s.card} entering={notificationDrop(1)}>
          <View style={s.iconBox}>
            <Svg width={22} height={22} viewBox="0 0 24 24">
              <Path
                d="M5 20V10M12 20V4M19 20v-7"
                stroke={T.accentAlt}
                strokeWidth={1.9}
                fill="none"
                strokeLinecap="round"
              />
            </Svg>
          </View>
          <Text style={s.cardText}>{'내가 남들만큼 하는지\n비교할 방법이 없는 답답한 순간'}</Text>
        </Animated.View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  cards: { alignSelf: 'stretch', gap: T.space.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: T.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { ...T.text.label, color: T.ink, flex: 1, lineHeight: 20 },
});
