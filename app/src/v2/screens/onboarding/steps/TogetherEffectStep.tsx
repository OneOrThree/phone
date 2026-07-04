import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W1 · 함께 효과(오프닝) — "같이 앉으면 더 오래 가요". 정적 설득 화면(오프닝).
// 디자인은 마스코트 군집 일러스트 — 단일 정적 캐릭터로 근사(가운데 크게 + 양옆). TODO: 전용 군집 에셋.
export default function TogetherEffectStep({ onNext, onSkipToLogin }: StepProps) {
  return (
    <StepScaffold
      center
      header={
        <View style={s.illust}>
          <View style={s.table} />
          <View style={s.cluster}>
            <CharacterImage size={56} />
            <CharacterImage size={78} />
            <CharacterImage size={56} />
          </View>
          <View style={s.badge}>
            <Text style={s.badgeText}>함께 = 1.9배 오래</Text>
          </View>
        </View>
      }
      title={'같이 앉으면\n더 오래 가요'}
      ctaLabel="다음"
      onCta={onNext}
      secondaryLabel="이미 계정이 있어요"
      onSecondary={onSkipToLogin}
    >
      <Text style={s.sub}>
        혼자일 때보다 평균 <Text style={s.emph}>1.9배</Text> 더 오래 집중해요.
      </Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  illust: { alignItems: 'center', justifyContent: 'flex-end', height: 200 },
  table: {
    position: 'absolute',
    bottom: 26,
    width: 196,
    height: 62,
    borderRadius: 100,
    backgroundColor: T.sand,
    opacity: 0.6,
  },
  cluster: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  badge: {
    marginTop: 10,
    backgroundColor: T.green,
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 14,
    transform: [{ rotate: '-2deg' }],
  },
  badgeText: { ...T.text.caption, fontWeight: '800', color: T.white },
  sub: { ...T.text.body, color: T.link, textAlign: 'center' },
  emph: { fontWeight: '800', color: T.accentAlt },
});
