import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { T } from '@/v2/constants/theme';

// 임시 자리표시 — 슬라이더 기반 '분 단위 목표' 입력의 골격용 스텁.
// 실제 시안은 원형 게이지 + 가로 슬라이더(class gm-rgb) + 비교 카드. 12/17 화면 구현 시 교체.
// 슬라이더는 @react-native-community/slider 등으로 붙이고, 아래 −/+ 는 임시.
interface Props {
  unit: string; // '사용' | '집중'
  minutes: number;
  min: number;
  max: number;
  step: number;
  onChange: (m: number) => void;
}

function fmt(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

export default function GoalPlaceholder({ unit, minutes, min, max, step, onChange }: Props) {
  const clamp = (m: number) => Math.min(max, Math.max(min, m));
  return (
    <View style={s.wrap}>
      <Text style={s.value}>{fmt(minutes)}</Text>
      <Text style={s.unit}>하루 목표 {unit}시간</Text>
      {/* TODO(디자인): 원형 게이지 + 슬라이더로 교체. 아래 −/+ 는 임시 입력. */}
      <View style={s.row}>
        <TouchableOpacity style={s.pm} onPress={() => onChange(clamp(minutes - step))}>
          <Text style={s.pmText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.pm} onPress={() => onChange(clamp(minutes + step))}>
          <Text style={s.pmText}>＋</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingVertical: 24 },
  value: { ...T.text.display, fontSize: 48, color: T.ink },
  unit: { ...T.text.caption, color: T.inkMuted, marginTop: 6 },
  row: { flexDirection: 'row', gap: 16, marginTop: 28 },
  pm: {
    width: 64,
    height: 48,
    borderRadius: 14,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pmText: { ...T.text.title, color: T.ink },
});
