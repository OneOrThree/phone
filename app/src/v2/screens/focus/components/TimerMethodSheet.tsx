import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import type { FocusTimerMode } from '../types';
import { SheetShell } from './SheetShell';

// 03 타이머 방식 — 카운트업/카운트다운/뽀모도로 중 선택.
const ICON_BG = '#F0E7D7'; // 시안 아이콘 배경(밝은 카라멜)

const OPTIONS: {
  mode: FocusTimerMode;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}[] = [
  { mode: 'countup', icon: 'arrow-up', title: '카운트업', desc: '0부터 시간을 쌓아요' },
  { mode: 'countdown', icon: 'arrow-down', title: '카운트다운', desc: '목표 시간부터 줄어들어요' },
  { mode: 'pomodoro', icon: 'timer-outline', title: '뽀모도로', desc: '집중·휴식을 반복해요' },
];

export function TimerMethodSheet({
  subjectName,
  onSelect,
  onClose,
}: {
  subjectName: string;
  onSelect: (mode: FocusTimerMode) => void;
  onClose: () => void;
}) {
  return (
    <SheetShell onClose={onClose}>
      <Text style={s.title}>{subjectName} · 타이머 방식</Text>
      <Text style={s.sub}>어떻게 집중할지 골라요.</Text>
      <View style={s.list}>
        {OPTIONS.map((o) => (
          <TouchableOpacity
            key={o.mode}
            style={s.row}
            activeOpacity={0.8}
            onPress={() => onSelect(o.mode)}
          >
            <View style={s.iconBox}>
              <Ionicons name={o.icon} size={22} color={T.accent} />
            </View>
            <View style={s.flex1}>
              <Text style={s.rowTitle}>{o.title}</Text>
              <Text style={s.rowDesc}>{o.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={T.inkMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: T.ink },
  sub: { fontSize: 11, fontWeight: '500', color: T.inkMuted, marginTop: 2, marginBottom: 13 },
  list: { gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: '#ECE2D1',
    borderRadius: 15,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: T.ink },
  rowDesc: { fontSize: 11, fontWeight: '500', color: T.inkMuted, marginTop: 1 },
});
