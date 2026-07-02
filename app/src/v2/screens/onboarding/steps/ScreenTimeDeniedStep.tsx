import { Text, StyleSheet, Linking } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import InfoNote, { NoteStrong } from '@/v2/screens/onboarding/components/InfoNote';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 09a · 권한 거부 분기 (제한 상태 안내). 권한 없이 계속할 수 있음을 안내.
// "설정에서 허용하기" → 앱 설정 페이지로 이동(Linking.openSettings).
//   iOS는 스크린타임 권한 창 직접 딥링크를 공개 API로 지원하지 않음(비공개 App-Prefs 스킴은 리젝 사유).
// TODO: 마스코트 임시 이모지 → Character2D.
export default function ScreenTimeDeniedStep({ onNext, onBack }: StepProps) {
  return (
    <StepScaffold
      center
      header={<Text style={s.mascot}>🐹</Text>}
      title="권한 없이도 괜찮아요"
      subtitle="다만 사용시간 목표 설정·통계는 쓸 수 없어요. 집중 타이머와 리그는 그대로 이용할 수 있어요."
      ctaLabel="설정에서 허용하기"
      onCta={() => Linking.openSettings()}
      secondaryLabel="이대로 계속하기"
      onSecondary={onNext}
      onBack={onBack}
    >
      <InfoNote>
        언제든 <NoteStrong>설정 › 스크린 타임 권한</NoteStrong>에서 켤 수 있어요.
      </InfoNote>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  mascot: { fontSize: 96 }, // 임시 마스코트(이모지) 크기 — Character2D 교체 예정
});
