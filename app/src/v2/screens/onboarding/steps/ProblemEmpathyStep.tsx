import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W3 · 문제 공감 — "이런 하루, 익숙하지 않으세요?" 공감 카드 2개(정적).
export default function ProblemEmpathyStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      center
      title={'이런 하루, 익숙하지\n않으세요?'}
      ctaLabel="공감돼요"
      onCta={onNext}
    >
      <View style={s.cards}>
        <View style={s.card}>
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
          <Text style={s.cardText}>잠시 알림 확인하려고 핸드폰 들었다가 훌쩍 지나간 시간</Text>
        </View>

        <View style={s.card}>
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
          <Text style={s.cardText}>내가 남들만큼 하는지 비교할 방법이 없는 답답한 순간</Text>
        </View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  cards: { alignSelf: 'stretch', gap: 11 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
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
