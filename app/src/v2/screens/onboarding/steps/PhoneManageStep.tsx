import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W8 · 핸드폰 관리 — "집중을 깨는 건, 대부분 핸드폰이에요"(설득). 허용/차단 앱 그리드.
const ALLOWED = [T.green, T.blue, T.accent];

function LockTile() {
  return (
    <View style={[s.tile, s.tileBlocked]}>
      <Svg width={16} height={16} viewBox="0 0 20 20">
        <Rect x={4} y={9} width={12} height={8} rx={2} fill={T.inkSub} />
        <Path d="M6.5 9V6.5a3.5 3.5 0 017 0V9" fill="none" stroke={T.inkSub} strokeWidth={1.6} />
      </Svg>
    </View>
  );
}

export default function PhoneManageStep({ onNext, onBack }: StepProps) {
  return (
    <StepScaffold
      center
      title={'집중을 깨는 건,\n대부분 핸드폰이에요'}
      ctaLabel="다음"
      onCta={onNext}
      onBack={onBack}
    >
      <View style={s.card}>
        <View style={s.grid}>
          {ALLOWED.map((c) => (
            <View key={c} style={[s.tile, { backgroundColor: c }]} />
          ))}
          <LockTile />
          <LockTile />
          <LockTile />
        </View>
        <View style={s.modeRow}>
          <View style={s.modeDot} />
          <Text style={s.modeText}>집중 모드 · 허용 앱만 사용</Text>
        </View>
      </View>
      <Text style={s.caption}>집중 중엔 방해 알림을 막고,{'\n'}하루 스크린타임 목표를 지켜드려요</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: 44 * 3 + 12 * 2, gap: 12 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileBlocked: { backgroundColor: T.borderDark },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.green },
  modeText: { ...T.text.caption, fontWeight: '700', fontSize: 11, color: T.successInk },
  caption: { ...T.text.body, color: T.link, textAlign: 'center', marginTop: 20 },
});
