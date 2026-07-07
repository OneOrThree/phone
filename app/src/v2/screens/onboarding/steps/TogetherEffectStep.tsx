import { View, Text, Image, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W1 · 함께 효과(오프닝) — "같이 앉으면 더 오래 가요". 정적 설득 화면(오프닝).
// 일러스트는 3마리가 함께 공부하는 군집 에셋(characters_study.png).
export default function TogetherEffectStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      center
      header={
        <View style={s.illust}>
          <Image
            source={require('../../../../assets/characters_study.png')}
            style={s.groupImage}
            resizeMode="contain"
          />
          <View style={s.badge}>
            <Text style={s.badgeText}>함께 = 1.9배 오래</Text>
          </View>
        </View>
      }
      title={'같이 앉으면\n더 오래 가요'}
      ctaLabel="다음"
      onCta={onNext}
    >
      <Text style={s.sub}>
        혼자일 때보다 평균 <Text style={s.emph}>1.9배</Text> 더 오래 집중해요.
      </Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  illust: { alignItems: 'center' },
  groupImage: { width: 280, height: 184 },
  badge: {
    marginTop: 8,
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
