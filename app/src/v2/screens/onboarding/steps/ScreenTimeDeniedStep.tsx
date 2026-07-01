import { View, Text, StyleSheet, Linking } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import { T } from '@/v2/constants/theme';
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
      <View style={s.note}>
        <View style={s.dot} />
        <Text style={s.noteText}>
          언제든 <Text style={s.noteStrong}>설정 › 스크린 타임 권한</Text>에서 켤 수 있어요.
        </Text>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  mascot: { fontSize: 96 },
  note: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#FBF3E8',
    borderWidth: 1,
    borderColor: '#EBDCC2',
    borderRadius: 14,
    padding: 14,
    marginTop: 20,
    alignSelf: 'stretch',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent, marginTop: 6 },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },
  noteStrong: { color: T.ink, fontWeight: '700' },
});
