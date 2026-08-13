import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

const MILESTONES = [
  { icon: 'flame' as const, label: '연속 공부', value: '7일', color: T.flame, bg: T.dangerBg },
  {
    icon: 'trophy' as const,
    label: '리그 순위',
    value: '+3',
    color: T.medal.gold,
    bg: T.paperAlt,
  },
  { icon: 'diamond' as const, label: '시간조각', value: '+42', color: T.accent, bg: T.accentBg },
];

// 세 번째 가치 제안 — 집중이 끝난 뒤 실제로 남는 연속 공부·리그·시간조각을 한 장에 묶는다.
// 허구의 과목 비교 목업 대신 현재 제품의 피드백 루프를 보여줘 로그인 직전 기대를 완성한다.
export default function SubjectCompareStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      testID="onboarding.step.subjectCompare"
      center
      scrollable
      title={'오늘의 집중이\n내일의 기록이 돼요'}
      ctaLabel="그로모 시작하기"
      onCta={onNext}
    >
      <View style={s.resultCard}>
        <View style={s.resultTop}>
          <View style={s.characterBox}>
            <CharacterImage size={72} variant="happy" />
          </View>
          <View style={s.resultCopy}>
            <Text style={s.eyebrow}>오늘의 집중</Text>
            <Text style={s.focusValue}>42분 완료</Text>
            <Text style={s.focusSub}>시작한 시간이 그대로 쌓였어요</Text>
          </View>
        </View>

        <View style={s.milestones}>
          {MILESTONES.map((item, index) => (
            <View
              key={item.label}
              style={[s.milestone, index < MILESTONES.length - 1 ? s.milestoneDivider : null]}
            >
              <View style={[s.iconBox, { backgroundColor: item.bg }]}>
                <Ionicons name={item.icon} size={17} color={item.color} />
              </View>
              <View style={s.milestoneCopy}>
                <Text style={s.milestoneLabel}>{item.label}</Text>
                <Text style={s.milestoneValue}>{item.value}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <Text style={s.caption}>집중 기록은 홈과 통계, 리그에 차곡차곡 반영돼요.</Text>
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
