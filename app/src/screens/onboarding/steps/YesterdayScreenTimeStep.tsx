import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { T } from '@/constants/theme';
import { logOnboardingScreentimeViewed } from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// 분석 연출 시간 — 진행바가 리니어하게 100%까지 차는 데 걸리는 시간.
const ANALYZE_MS = 2000;

// 분석 연출은 앱 실행당 1회만 — 뒤로 갔다 다시 진입해도 반복하지 않는다(앱 재시작 시 초기화).
let analyzedThisSession = false;

// W11 · 어제 스크린타임 — 어제 하루 실제 사용시간(총량+카테고리별+앱별)을 네이티브 리포트 뷰로 표시.
// ScreenTimeReportView 'Total Activity'에 dayOffset={-1}을 줘 어제 하루치를 집계(홈 '핸드폰 사용'과 동일 뷰).
// W9에서 어제 사용을 자가추측 → 여기서 실제 어제 데이터로 비교한다.
// (DeviceActivityReport 익스텐션 안에서만 카테고리 데이터가 나옴 — App Group 우회 불가.)
// 권한 거부 유저는 컨트롤러가 이 스텝을 건너뛴다.
export default function YesterdayScreenTimeStep({ onNext }: StepProps) {
  // 분석 연출 — 진행바가 2초간 리니어하게 차오르고, 끝나면 로딩 레이어를 걷고 CTA를 노출한다.
  const [analyzed, setAnalyzed] = useState(analyzedThisSession);
  const progress = useSharedValue(0);

  // 전날 스크린타임 요약 노출 계측 — 진입당 1회.
  // has_data: 실제 사용 분은 익스텐션 안에서만 그려져 JS로 넘어오지 않으므로(완료 감지 불필요),
  // 네이티브 리포트 뷰가 렌더 가능한지로 판정한다(iOS 실기기+모듈=데이터 표시 가능).
  useEffect(() => {
    logOnboardingScreentimeViewed({ has_data: !!ScreenTimeReportView });
    if (analyzedThisSession) return;
    progress.value = withTiming(1, { duration: ANALYZE_MS, easing: Easing.linear });
    const timer = setTimeout(() => {
      analyzedThisSession = true;
      setAnalyzed(true);
    }, ANALYZE_MS);
    return () => clearTimeout(timer);
  }, [progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <StepScaffold
      title="실제로는 얼마나 썼는지 볼까요?"
      subtitle="추측과 얼마나 달랐나요? 조금씩 줄여봐요."
      ctaLabel="다음"
      onCta={onNext}
      ctaHidden={!analyzed}
    >
      <View style={s.reportBox}>
        {ScreenTimeReportView ? (
          <>
            <ScreenTimeReportView reportContext="Total Activity" dayOffset={-1} style={s.report} />
            {/* 분석 연출이 끝날 때까지 리포트를 로딩 레이어로 덮는다 — 진행바 100% 후 걷힘. */}
            {!analyzed ? (
              <View style={s.loadingLayer}>
                <Text style={s.analyzingText}>
                  그로모가 사용자님의{'\n'}사용시간을 분석하고 있어요!
                </Text>
                <Image
                  source={require('@/assets/character_study.png')}
                  style={s.character}
                  resizeMode="contain"
                />
                <View style={s.progressTrack}>
                  <Animated.View style={[s.progressFill, fill]} />
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={s.empty}>iOS 기기에서만 볼 수 있어요</Text>
        )}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  reportBox: { alignSelf: 'stretch', height: 440 },
  report: { flex: 1 },
  empty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 40 },
  loadingLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xl,
    backgroundColor: T.paper,
  },
  analyzingText: { ...T.text.heading, color: T.ink, textAlign: 'center', lineHeight: 28 },
  character: { width: 170, height: 200 },
  // 왼쪽→오른쪽으로 차오르는 분석 진행바.
  progressTrack: {
    alignSelf: 'stretch',
    marginHorizontal: T.space.xxl,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.caramel,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: T.accent },
});
