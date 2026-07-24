// ST7 전(前) 대비 카드의 지표 행 — 증감 화살표·퍼센트·분량. 폰 사용처럼 줄어드는 게
// 좋은 지표는 lowerIsBetter로 색 판정을 뒤집는다.
import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';
import { fmtMinutes } from '@/utils/timeFormat';

export function DeltaRow({
  label,
  delta,
  base,
  lowerIsBetter,
}: {
  label: string;
  delta: number;
  base: number;
  lowerIsBetter: boolean;
}) {
  const pct = base > 0 ? Math.round((Math.abs(delta) / base) * 100) : null;
  const up = delta > 0;
  const flat = delta === 0;
  const good = flat ? false : lowerIsBetter ? !up : up;
  const arrow = flat ? '–' : up ? '▲' : '▼';
  const color = flat ? T.inkMuted : good ? T.successInk : T.dangerInk;
  return (
    <View style={s.deltaRow}>
      <Text style={s.deltaLabel}>{label}</Text>
      <View style={s.deltaValueWrap}>
        <Text style={[s.deltaArrow, { color }]}>{arrow}</Text>
        <Text style={[s.deltaPct, { color }]}>{pct === null ? '–' : `${pct}%`}</Text>
        <Text style={s.deltaMin}>{flat ? '변화 없어요' : `${fmtMinutes(Math.abs(delta))}`}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: T.space.sm,
  },
  deltaLabel: { ...T.text.label, color: T.inkSub },
  deltaValueWrap: { flexDirection: 'row', alignItems: 'baseline', gap: T.space.sm },
  deltaArrow: { ...T.text.label },
  deltaPct: { ...T.text.subtitle, fontWeight: '800' },
  deltaMin: { ...T.text.caption, color: T.inkMuted },
});
