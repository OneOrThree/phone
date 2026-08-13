import { View, Text, Image, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

const COMPANION_VIEWS = [
  { label: '친구', dot: T.green },
  { label: '그룹', dot: T.accentLight },
  { label: '같은 리그', dot: T.medal.gold },
];

// 두 번째 가치 제안 — 집중 세션 안에서 친구·그룹·같은 시험 리그를 넘겨 보는 실제 동료 경험.
// 과거의 1.9배 수치 주장을 걷고, 지금 앱에서 사용자가 직접 만나는 기능을 구체적으로 보여준다.
export default function TogetherEffectStep({ onNext }: StepProps) {
  return (
    <StepScaffold
      testID="onboarding.step.together"
      center
      header={
        <View style={s.illust}>
          <Image
            source={require('@/assets/characters_study.png')}
            style={s.groupImage}
            resizeMode="contain"
          />
          <View style={s.onlineBadge}>
            <View style={s.onlineDot} />
            <Text style={s.onlineText}>지금도 함께 집중 중</Text>
          </View>
        </View>
      }
      title={'혼자 시작해도\n혼자 하지 않게'}
      ctaLabel="다음"
      onCta={onNext}
    >
      <View style={s.viewRow}>
        {COMPANION_VIEWS.map((item) => (
          <View key={item.label} style={s.viewChip}>
            <View style={[s.viewDot, { backgroundColor: item.dot }]} />
            <Text style={s.viewText}>{item.label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.sub}>
        집중 화면을 넘기면 친구, 그룹, 같은 시험 준비생이{`\n`}함께 공부하는 모습이 보여요.
      </Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  illust: { alignItems: 'center' },
  groupImage: { width: 286, height: 184 },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: T.space.sm,
    backgroundColor: T.greenBg,
    borderRadius: 99,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.lg,
    transform: [{ rotate: '-2deg' }],
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.green },
  onlineText: { ...T.text.caption, fontWeight: '800', color: T.successInk },
  viewRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: T.space.sm,
  },
  viewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 99,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.md,
  },
  viewDot: { width: 7, height: 7, borderRadius: 4 },
  viewText: { ...T.text.caption, color: T.inkSub },
  sub: { ...T.text.body, color: T.inkSub, textAlign: 'center', marginTop: T.space.xl },
});
