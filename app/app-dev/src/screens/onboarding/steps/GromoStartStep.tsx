import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import type { StepProps } from '@/screens/onboarding/types';

// W14 · 그로모 시작 — 온보딩 마무리 히어로. CTA → 마지막 W15 로그인.
export default function GromoStartStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      center
      header={
        <View style={s.hero}>
          <CharacterImage size={150} />
        </View>
      }
      title={t('onboarding.gromoStart.title')}
      ctaLabel={t('onboarding.gromoStart.cta')}
      onCta={onNext}
    >
      <Text style={s.sub}>{t('onboarding.gromoStart.sub')}</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', justifyContent: 'center', height: 162 },
  sub: { ...T.text.body, color: T.link, textAlign: 'center', lineHeight: 26 },
});
