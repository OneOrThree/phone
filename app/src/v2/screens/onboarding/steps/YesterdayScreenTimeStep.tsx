import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import ScreenTimeReportView from '@/components/ScreenTimeReportView';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W11 · 스크린타임 — 실제 사용시간(총량+카테고리별+앱별)을 네이티브 리포트 뷰로 표시.
// 홈 '핸드폰 사용'(UsageDetailScreen)과 동일한 ScreenTimeReportView 'Total Activity' 임베드 → 실데이터.
// (DeviceActivityReport 익스텐션 안에서만 카테고리 데이터가 나옴 — App Group 우회 불가.)
// 권한 거부 유저는 컨트롤러가 이 스텝을 건너뛴다.
export default function YesterdayScreenTimeStep({ onNext, onBack }: StepProps) {
  return (
    <StepScaffold
      title="실제로는 얼마나 썼는지 볼까요?"
      subtitle="추측과 얼마나 달랐나요? 조금씩 줄여봐요."
      ctaLabel="다음"
      onCta={onNext}
      onBack={onBack}
    >
      <View style={s.reportBox}>
        {/* 리포트 콜드스타트가 느려 뒤에 스피너 → 뜨면 리포트가 덮음 */}
        <ActivityIndicator style={s.loading} size="large" color={T.accent} />
        {ScreenTimeReportView ? (
          <ScreenTimeReportView reportContext="Total Activity" style={s.report} />
        ) : (
          <Text style={s.empty}>iOS 기기에서만 볼 수 있어요</Text>
        )}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  reportBox: { alignSelf: 'stretch', height: 440 },
  loading: { position: 'absolute', top: 40, left: 0, right: 0 },
  report: { flex: 1 },
  empty: { ...T.text.body, color: T.inkMuted, textAlign: 'center', marginTop: 40 },
});
