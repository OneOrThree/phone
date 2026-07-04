import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W14 · 그로모 시작 — 온보딩 마무리 히어로. CTA → 마지막 W15 로그인.
export default function GromoStartStep({ onNext, onBack }: StepProps) {
  return (
    <StepScaffold
      center
      header={
        <View style={s.hero}>
          <CharacterImage size={150} />
        </View>
      }
      title={'이제,\n그로모와 함께'}
      ctaLabel="그로모 시작하기"
      onCta={onNext}
      onBack={onBack}
    >
      <Text style={s.sub}>덜 쓴 시간을 다시 내 것으로.{'\n'}오늘부터 한 걸음씩 알차게 채워봐요.</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', justifyContent: 'center', height: 162 },
  sub: { ...T.text.body, color: T.link, textAlign: 'center', lineHeight: 26 },
});
