import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';
// import { requestAuthorization } from '@/services/ScreenTimeModule';

// 09 · 스크린타임 권한 — Apple 스크린타임 권한 요청. 결과를 screenTimeGranted 에 저장.
// 거부 시 시안상 09a(제한 상태)·09b(수동 입력)로 분기 — 이번 골격엔 미포함(TODO: 분기 처리).
// TODO(시안 09): 권한 안내 카드 3줄(앱별 사용시간/카테고리 분류/기기내 처리·서버 미전송). iOS 시스템 시트는 OS가 띄움.
export default function ScreenTimePermissionStep({ update, onNext }: StepProps) {
  async function allow() {
    // TODO: const granted = await requestAuthorization();
    const granted = true; // 골격: 임시로 허용 처리
    update({ screenTimeGranted: granted });
    onNext(); // TODO: granted=false 면 09a/09b 분기
  }
  function later() {
    update({ screenTimeGranted: false });
    onNext();
  }
  return (
    <StepScaffold
      title={'사용 시간을\n정확히 보려면'}
      subtitle="Apple 스크린타임 권한이 필요해요. 이 데이터로 통계와 코인 보상을 계산해요."
      ctaLabel="권한 허용하기"
      onCta={allow}
      secondaryLabel="나중에 할게요"
      onSecondary={later}
    >
      {/* TODO(시안 09): 권한 항목 카드 */}
      <View style={s.card}>
        <Text style={s.item}>· 앱별 사용 시간</Text>
        <Text style={s.item}>· 카테고리별 분류</Text>
        <Text style={s.item}>· 기기에서만 처리 · 서버 미전송</Text>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  item: { ...T.text.body, fontSize: 14, color: T.ink },
});
