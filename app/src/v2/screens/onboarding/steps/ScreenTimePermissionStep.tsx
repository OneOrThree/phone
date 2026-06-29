import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';
import ScreenTimeModule from '@/services/ScreenTimeModule';

// 09 · 스크린타임 권한 — Apple 스크린타임 권한 요청. 결과를 screenTimeGranted 에 저장.
// 거부 시 시안상 09a(제한 상태)·09b(수동 입력)로 분기 — 이번 범위 미포함(TODO).
// iOS 시스템 권한 시트는 OS가 띄움(여기선 안 그림).

const PERKS = ['앱별 사용 시간', '카테고리별 분류', '기기에서만 처리 · 서버 미전송'];

function ClockIcon() {
  return (
    <View style={s.iconBox}>
      <Svg width={30} height={30} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={9} fill="none" stroke={T.accentDeep} strokeWidth={2} />
        <Path
          d="M12 7 V12 L15.5 14"
          stroke={T.accentDeep}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

export default function ScreenTimePermissionStep({ update, onNext, onBack }: StepProps) {
  async function allow() {
    // 실제 iOS 스크린타임(FamilyControls) 권한 요청. 시뮬레이터에선 미동작 가능 → 실기기에서 확인.
    let granted = false;
    try {
      granted = await ScreenTimeModule.requestAuthorization();
    } catch {
      granted = false;
    }
    update({ screenTimeGranted: granted });
    onNext(); // TODO: granted=false → 09a(제한)/09b(수동입력) 분기
  }
  function later() {
    update({ screenTimeGranted: false });
    onNext();
  }

  return (
    <StepScaffold
      header={<ClockIcon />}
      title={'사용 시간을\n정확히 보려면'}
      subtitle="Apple 스크린타임 권한이 필요해요. 이 데이터로 통계와 코인 보상을 계산해요."
      ctaLabel="권한 허용하기"
      onCta={allow}
      secondaryLabel="나중에 할게요"
      onSecondary={later}
      onBack={onBack}
    >
      <View style={s.card}>
        {PERKS.map((p, i) => (
          <View key={p} style={[s.row, i < PERKS.length - 1 ? s.rowDivider : null]}>
            <View style={s.dot} />
            <Text style={s.rowText}>{p}</Text>
          </View>
        ))}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  iconBox: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: T.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: '#F0E9DC' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: T.green },
  rowText: { ...T.text.body, fontSize: 14, color: T.ink },
});
