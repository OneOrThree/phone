import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import ScreenTimeAnalyzingOverlay, { ANALYZE_MS } from '@/components/ScreenTimeAnalyzingOverlay';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { formatDuration } from '@/screens/onboarding/format';
import { logOnboardingScreentimeViewed } from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// 분석 연출은 온보딩 플로우 진입당 1회만 — 뒤로 갔다 다시 진입해도 반복하지 않는다.
// 모듈 전역이라 JS 번들이 사는 동안 유지되므로, 온보딩 재진입(디버그 초기화 등) 시
// 연출이 다시 보이도록 OnboardingFlow 마운트에서 resetAnalyzeIntro()로 되돌린다.
let analyzedThisSession = false;

export function resetAnalyzeIntro() {
  analyzedThisSession = false;
}

// W11 · 어제 스크린타임 — 어제 하루 실제 사용시간(총량+카테고리별+앱별)을 네이티브 리포트 뷰로 표시.
// ScreenTimeReportView 'Total Activity'에 dayOffset={-1}을 줘 어제 하루치를 집계(홈 '핸드폰 사용'과 동일 뷰).
// W9에서 어제 사용을 자가추측 → 여기서 실제 어제 데이터로 비교한다.
// (DeviceActivityReport 익스텐션 안에서만 카테고리 데이터가 나옴 — App Group 우회 불가.)
// 권한 거부 유저는 컨트롤러가 이 스텝을 건너뛴다.
// 안드로이드(GROMO-994): 네이티브 리포트 뷰 대신 모듈 조회값(어제 총 사용시간)을 직접 그린다.
// 앱별 상세는 M2(피커·패키지 조회)에서 확장.
export default function YesterdayScreenTimeStep({ onNext }: StepProps) {
  // 분석 연출 — 진행바가 채워지고 끝나면 로딩 레이어를 걷고 CTA를 노출한다.
  const [analyzed, setAnalyzed] = useState(analyzedThisSession);
  // 안드로이드 어제 사용시간(분) — 조회 전·조회 실패 시 null이면 '–' 표시.
  const [androidYesterdayMinutes, setAndroidYesterdayMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    ScreenTimeModule.getYesterdayUsageBucketMinutes()
      .then((m) => {
        setAndroidYesterdayMinutes(m);
        logOnboardingScreentimeViewed({ has_data: true });
      })
      .catch(() => {
        // 조회 실패(OEM 서비스 오류·요청 중 권한 회수 등) — 0분으로 조작하지 않고 null 유지
        // → 기존 미확인('–') 표시를 그대로 탄다. 계측도 데이터 없음으로 남긴다(코드리뷰 반영).
        logOnboardingScreentimeViewed({ has_data: false });
      });
  }, []);

  // 전날 스크린타임 요약 노출 계측(진입당 1회) + 분석 연출 종료 타이머.
  // has_data: 실제 사용 분은 익스텐션 안에서만 그려져 JS로 넘어오지 않으므로(완료 감지 불필요),
  // 네이티브 리포트 뷰가 렌더 가능한지로 판정한다(iOS 실기기+모듈=데이터 표시 가능).
  // 안드로이드는 조회 성공/실패가 JS에서 판별되므로 위 조회 effect에서 결과에 따라 계측한다.
  // 연출은 세션 내 1회만 노출(뒤로 갔다 재진입해도 반복 안 함) — ANALYZE_MS 뒤 로딩 레이어를
  // 걷고 CTA를 노출한다. (홈 상세와 달리 온보딩은 리포트가 아니라 CTA를 띄워야 하므로 타이머로 건다.)
  useEffect(() => {
    if (Platform.OS !== 'android') {
      logOnboardingScreentimeViewed({ has_data: !!ScreenTimeReportView });
    }
    if (analyzedThisSession) return;
    const timer = setTimeout(() => {
      analyzedThisSession = true;
      setAnalyzed(true);
    }, ANALYZE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <StepScaffold
      title={t('onboarding.yesterdayScreenTime.title')}
      subtitle={t('onboarding.yesterdayScreenTime.subtitle')}
      ctaLabel={t('common.next')}
      onCta={onNext}
      ctaHidden={!analyzed}
    >
      <View style={s.reportBox}>
        {ScreenTimeReportView ? (
          <ScreenTimeReportView reportContext="Total Activity" dayOffset={-1} style={s.report} />
        ) : Platform.OS === 'android' ? (
          // 안드로이드 — 어제 총 사용시간 조회값 표시(앱별 상세는 M2에서 확장).
          <View style={s.androidSummary}>
            <Text style={s.androidLabel}>{t('onboarding.yesterdayScreenTime.androidLabel')}</Text>
            <Text style={s.androidValue}>
              {androidYesterdayMinutes == null ? '–' : formatDuration(androidYesterdayMinutes)}
            </Text>
            <Text style={s.androidHint}>{t('onboarding.yesterdayScreenTime.androidHint')}</Text>
          </View>
        ) : (
          <Text style={s.empty}>{t('onboarding.yesterdayScreenTime.iosOnly')}</Text>
        )}
        {/* 분석 연출이 끝날 때까지(ANALYZE_MS) 리포트를 로딩 레이어로 덮는다 — 위 타이머로 걷힘. */}
        {!analyzed ? <ScreenTimeAnalyzingOverlay /> : null}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  reportBox: { alignSelf: 'stretch', height: 440 },
  report: { flex: 1 },
  empty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 40 },
  // 안드로이드 어제 총 사용시간 카드(GROMO-994)
  androidSummary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
  },
  androidLabel: { ...T.text.label, color: T.inkMuted },
  androidValue: { ...T.text.title, color: T.ink },
  androidHint: { ...T.text.caption, color: T.inkFaint },
});
