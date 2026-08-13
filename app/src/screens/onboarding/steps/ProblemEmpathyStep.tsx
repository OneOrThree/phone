import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { CharacterImage } from '@/components/character/CharacterImage';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

// 로그인 전 첫 화면 — 문제를 길게 설명하기보다 실제 집중 화면의 핵심 경험을 먼저 보여준다.
// 앱 전체가 밝은 표면이라, 다크 집중 세션 카드를 한 번만 강하게 써서 "집중 모드로 들어간다"는
// 전환을 기억하게 한다. 타이머·자동 기록은 공통 기능이고, iOS에서만 지원하는 방해 앱 차단은
// 다른 플랫폼에서 집중 목표로 바꿔 실제로 제공하는 기능만 명시한다.
export default function ProblemEmpathyStep({ onNext }: StepProps) {
  const supportsFocusShield = Platform.OS === 'ios';

  return (
    <StepScaffold
      testID="onboarding.step.problem"
      center
      title={'오늘 할 일만 고르면\n집중이 바로 시작돼요'}
      ctaLabel="다음"
      onCta={onNext}
    >
      <View style={s.sessionCard}>
        <View style={s.sessionTop}>
          <View style={s.livePill}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>집중 중</Text>
          </View>
          <View style={s.subjectPill}>
            <Text style={s.subjectText}>오늘의 할 일</Text>
          </View>
        </View>

        <View style={s.characterStage}>
          <View style={s.glowLarge} />
          <View style={s.glowSmall} />
          <CharacterImage size={116} variant="study" />
        </View>

        <Text style={s.timer}>25:00</Text>
        <View style={s.featureRow}>
          <View style={s.feature}>
            <Ionicons name="timer-outline" size={15} color={T.night.cream} />
            <Text style={s.featureText}>타이머</Text>
          </View>
          <View style={s.feature}>
            <Ionicons
              name={supportsFocusShield ? 'shield-checkmark-outline' : 'flag-outline'}
              size={15}
              color={T.night.cream}
            />
            <Text style={s.featureText}>{supportsFocusShield ? '방해 앱 차단' : '집중 목표'}</Text>
          </View>
          <View style={s.feature}>
            <Ionicons name="stats-chart-outline" size={15} color={T.night.cream} />
            <Text style={s.featureText}>자동 기록</Text>
          </View>
        </View>
      </View>
      <Text style={s.caption}>복잡한 준비 없이, 시작한 순간부터 기록해요.</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  sessionCard: {
    alignSelf: 'stretch',
    backgroundColor: T.night.bottom,
    borderRadius: 24,
    padding: T.space.lg,
    shadowColor: T.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sessionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.night.face,
    borderRadius: 99,
    paddingHorizontal: T.space.md,
    paddingVertical: 7,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.night.green },
  liveText: { ...T.text.caption, color: T.night.cream },
  subjectPill: {
    backgroundColor: T.night.face,
    borderRadius: 99,
    paddingHorizontal: T.space.md,
    paddingVertical: 7,
  },
  subjectText: { ...T.text.caption, color: T.night.muted },
  characterStage: { height: 132, alignItems: 'center', justifyContent: 'center' },
  glowLarge: {
    position: 'absolute',
    width: 146,
    height: 146,
    borderRadius: 73,
    backgroundColor: T.night.face,
    opacity: 0.82,
  },
  glowSmall: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1,
    borderColor: T.accentLight,
    opacity: 0.45,
  },
  timer: { ...T.text.display, color: T.white, textAlign: 'center', letterSpacing: 1 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: T.space.sm,
    marginTop: T.space.lg,
  },
  feature: {
    flex: 1,
    minWidth: 78,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: T.night.face,
    borderRadius: 12,
    paddingHorizontal: T.space.sm,
    paddingVertical: T.space.sm,
  },
  featureText: { ...T.text.caption, color: T.night.cream, textAlign: 'center', flexShrink: 1 },
  caption: { ...T.text.body, color: T.inkSub, textAlign: 'center', marginTop: T.space.xl },
});
