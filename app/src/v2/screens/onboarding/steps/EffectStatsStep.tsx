import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Path, Rect } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W2 · 효과(집중↑·폰↓) — "이렇게 달라져요" 베타 지표 2개(정적 설득).
export default function EffectStatsStep({ onNext, onBack, onSkipToLogin }: StepProps) {
  return (
    <StepScaffold
      center
      title="이렇게 달라져요"
      ctaLabel="다음"
      onCta={onNext}
      secondaryLabel="이미 계정이 있어요"
      onSecondary={onSkipToLogin}
      onBack={onBack}
    >
      <View style={s.cards}>
        <View style={[s.card, s.cardUp]}>
          <Svg width={60} height={40} viewBox="0 0 150 84">
            <Polyline
              points="8,72 40,58 72,60 104,32 140,12"
              fill="none"
              stroke={T.accent}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 7"
            />
            <Path
              d="M132 10 L140 12 L138 20"
              fill="none"
              stroke={T.accent}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <View style={s.cardText}>
            <Text style={s.cardTitle}>
              집중이 <Text style={s.emph}>+1.8시간</Text>
            </Text>
            <Text style={s.cardSub}>하루 공부 시간이 늘어요</Text>
          </View>
        </View>

        <View style={[s.card, s.cardDown]}>
          <Svg width={40} height={44} viewBox="0 0 46 68">
            <Rect
              x={3}
              y={3}
              width={40}
              height={62}
              rx={7}
              fill="none"
              stroke={T.accentAlt}
              strokeWidth={3.5}
            />
            <Path
              d="M15 34 L23 42 L31 30"
              stroke={T.accentAlt}
              strokeWidth={3.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <View style={s.cardText}>
            <Text style={s.cardTitle}>
              폰 사용 <Text style={s.emphBlue}>−32%</Text>
            </Text>
            <Text style={s.cardSub}>딴짓하는 시간은 줄어요</Text>
          </View>
        </View>
      </View>
      <Text style={s.foot}>* 베타 사용자 평균</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  cards: { alignSelf: 'stretch', gap: 13 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: T.white,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  cardUp: { borderColor: T.accent, transform: [{ rotate: '-1.5deg' }] },
  cardDown: { borderColor: T.accentAlt, transform: [{ rotate: '1.5deg' }] },
  cardText: { flex: 1 },
  cardTitle: { ...T.text.subtitle, fontWeight: '800', color: T.ink },
  emph: { color: T.accentAlt },
  emphBlue: { color: T.blue }, // 폰 사용 −32% 강조(파란색)
  cardSub: { ...T.text.caption, fontWeight: '500', color: T.link, marginTop: 2 },
  foot: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: 16,
  },
});
