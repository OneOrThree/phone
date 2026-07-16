import { useEffect } from 'react';
import { View, Text, Image, ActivityIndicator, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { T } from '@/constants/theme';
import { logOnboardingScreentimeViewed } from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// W11 · 어제 스크린타임 — 어제 하루 실제 사용시간(총량+카테고리별+앱별)을 네이티브 리포트 뷰로 표시.
// ScreenTimeReportView 'Total Activity'에 dayOffset={-1}을 줘 어제 하루치를 집계(홈 '핸드폰 사용'과 동일 뷰).
// W9에서 어제 사용을 자가추측 → 여기서 실제 어제 데이터로 비교한다.
// (DeviceActivityReport 익스텐션 안에서만 카테고리 데이터가 나옴 — App Group 우회 불가.)
// 권한 거부 유저는 컨트롤러가 이 스텝을 건너뛴다.
export default function YesterdayScreenTimeStep({ onNext }: StepProps) {
  // 전날 스크린타임 요약 노출 계측 — 진입당 1회.
  // has_data: 실제 사용 분은 익스텐션 안에서만 그려져 JS로 넘어오지 않으므로(완료 감지 불필요),
  // 네이티브 리포트 뷰가 렌더 가능한지로 판정한다(iOS 실기기+모듈=데이터 표시 가능).
  useEffect(() => {
    logOnboardingScreentimeViewed({ has_data: !!ScreenTimeReportView });
  }, []);

  return (
    <StepScaffold
      title="실제로는 얼마나 썼는지 볼까요?"
      subtitle="추측과 얼마나 달랐나요? 조금씩 줄여봐요."
      ctaLabel="다음"
      onCta={onNext}
    >
      <View style={s.reportBox}>
        {ScreenTimeReportView ? (
          <>
            {/* '분석중'을 뒤에 깔고, 리포트를 그 위에 올린다. 리포트는 데이터가 뜨기 전까진
                투명이라 이 화면이 비쳐 보이고, 로드 완료되면 위에서 덮어버린다(완료 감지 불필요). */}
            <View style={s.loadingLayer}>
              <Text style={s.analyzingText}>
                그로모가 사용자님의{'\n'}사용시간을 분석하고 있어요!
              </Text>
              <Image
                source={require('@/assets/character_study.png')}
                style={s.character}
                resizeMode="contain"
              />
              <ActivityIndicator size="large" color={T.accent} />
            </View>
            <ScreenTimeReportView reportContext="Total Activity" dayOffset={-1} style={s.report} />
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
  },
  analyzingText: { ...T.text.heading, color: T.ink, textAlign: 'center', lineHeight: 28 },
  character: { width: 170, height: 200 },
});
