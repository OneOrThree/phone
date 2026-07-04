import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W8 · 핸드폰 관리 — "집중을 깨는 건, 대부분 핸드폰이에요"(설득). 허용/차단 앱 그리드.
// 허용 앱은 iOS 앱 아이콘처럼 컬러 타일 + 흰색 글리프(전화·메시지·음악)로 표현.
const APP_GLYPHS = {
  call: 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  chat: 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
};
const ALLOWED = [
  { key: 'call' as const, bg: T.green },
  { key: 'chat' as const, bg: T.blue },
  { key: 'music' as const, bg: T.accent },
];

function AppIcon({ glyph, bg }: { glyph: string; bg: string }) {
  return (
    <View style={[s.tile, { backgroundColor: bg }]}>
      <Svg width={26} height={26} viewBox="0 0 24 24">
        <Path d={glyph} fill={T.white} />
      </Svg>
    </View>
  );
}

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
          {ALLOWED.map(({ key, bg }) => (
            <AppIcon key={key} glyph={APP_GLYPHS[key]} bg={bg} />
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
      <Text style={s.caption}>
        집중 중엔 방해 알림을 막고,{'\n'}하루 스크린타임 목표를 지켜드려요
      </Text>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: 44 * 3 + 12 * 2,
    gap: 12,
  },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileBlocked: { backgroundColor: T.borderDark },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.green },
  modeText: { ...T.text.caption, fontWeight: '700', fontSize: 11, color: T.successInk },
  caption: { ...T.text.body, color: T.link, textAlign: 'center', marginTop: 20 },
});
