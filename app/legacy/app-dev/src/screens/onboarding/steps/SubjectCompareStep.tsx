import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import type { StepProps } from '@/screens/onboarding/types';

const MILESTONES = [
  {
    icon: 'flame' as const,
    labelKey: 'onboarding.subjectCompare.streakLabel',
    valueKey: 'onboarding.subjectCompare.streakValue',
    color: T.flame,
    bg: T.dangerBg,
  },
  {
    icon: 'trophy' as const,
    labelKey: 'onboarding.subjectCompare.rankLabel',
    valueKey: 'onboarding.subjectCompare.rankValue',
    color: T.medal.gold,
    bg: T.paperAlt,
  },
  {
    icon: 'diamond' as const,
    labelKey: 'onboarding.subjectCompare.shardLabel',
    valueKey: 'onboarding.subjectCompare.shardValue',
    color: T.accent,
    bg: T.accentBg,
  },
];

// 세 번째 가치 제안 — 집중이 끝난 뒤 실제로 남는 연속 공부·리그·시간조각을 한 장에 묶는다.
// 허구의 과목 비교 목업 대신 현재 제품의 피드백 루프를 보여줘 로그인 직전 기대를 완성한다.
export default function SubjectCompareStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      testID="onboarding.step.subjectCompare"
      center
      scrollable
      title={t('onboarding.subjectCompare.title')}
      ctaLabel={t('onboarding.subjectCompare.cta')}
      onCta={onNext}
    >
      <View style={s.resultCard}>
        <View style={s.resultTop}>
          <View style={s.characterBox}>
            <CharacterImage size={72} variant="happy" />
          </View>
          <View style={s.resultCopy}>
            <Text style={s.eyebrow}>{t('onboarding.subjectCompare.eyebrow')}</Text>
            <Text style={s.focusValue}>{t('onboarding.subjectCompare.focusValue')}</Text>
            <Text style={s.focusSub}>{t('onboarding.subjectCompare.focusSub')}</Text>
          </View>
        </View>

        <View style={s.milestones}>
          {MILESTONES.map((item, index) => (
            <View
              key={item.labelKey}
              style={[s.milestone, index < MILESTONES.length - 1 ? s.milestoneDivider : null]}
            >
              <View style={[s.iconBox, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={17} color={item.color} />
              </View>
              <View style={s.milestoneCopy}>
                <Text style={s.milestoneLabel}>{t(item.labelKey)}</Text>
                <Text style={s.milestoneValue}>{t(item.valueKey)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <Text style={s.caption}>{t('onboarding.subjectCompare.caption')}</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  resultCard: {
    alignSelf: 'stretch',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 22,
    padding: T.space.lg,
    shadowColor: T.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  resultTop: { flexDirection: 'row', alignItems: 'center', gap: T.space.lg },
  characterBox: {
    width: 86,
    height: 86,
    borderRadius: 24,
    backgroundColor: T.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCopy: { flex: 1 },
  eyebrow: { ...T.text.caption, color: T.accent, marginBottom: 2 },
  focusValue: { ...T.text.heading, color: T.ink },
  focusSub: { ...T.text.caption, color: T.inkMuted, marginTop: T.space.xs },
  milestones: {
    marginTop: T.space.lg,
    borderTopWidth: 1,
    borderTopColor: T.divider,
    paddingTop: T.space.sm,
  },
  milestone: { flexDirection: 'row', alignItems: 'center', paddingVertical: T.space.sm },
  milestoneDivider: { borderBottomWidth: 1, borderBottomColor: T.divider },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginLeft: T.space.md,
  },
  milestoneLabel: { ...T.text.label, color: T.inkSub },
  milestoneValue: { ...T.text.subtitle, color: T.ink },
  caption: { ...T.text.body, color: T.link, textAlign: 'center', marginTop: T.space.xl },
});
