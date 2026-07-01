import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { T } from '@/v2/constants/theme';
import { hms } from '../format';
import { SheetShell } from './SheetShell';

// 04 카운트다운 설정 — 목표 시간 지정 + 빠른추가 후 집중 시작.
const DEFAULT_GOAL = 90 * 60; // 01:30:00
const MAX_GOAL = 12 * 3600; // 상한 12시간
const QUICK = [
  { min: 10, label: '+00:10' },
  { min: 30, label: '+00:30' },
  { min: 60, label: '+01:00' },
];

export function CountdownSetupSheet({
  subjectName,
  onStart,
  onClose,
}: {
  subjectName: string;
  onStart: (goalSeconds: number) => void;
  onClose: () => void;
}) {
  const [goalSeconds, setGoalSeconds] = useState(DEFAULT_GOAL);

  return (
    <SheetShell onClose={onClose}>
      <Text style={s.title}>{subjectName} · 카운트다운</Text>
      <Text style={s.sub}>목표 시간을 정하면 0으로 줄어들어요.</Text>

      <Text style={s.bigTime}>{hms(goalSeconds)}</Text>

      <View style={s.quickRow}>
        {QUICK.map((q) => (
          <TouchableOpacity
            key={q.min}
            style={s.chip}
            activeOpacity={0.8}
            onPress={() => setGoalSeconds((prev) => Math.min(prev + q.min * 60, MAX_GOAL))}
          >
            <Text style={s.chipText}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[s.startBtn, goalSeconds === 0 && s.startBtnDisabled]}
        activeOpacity={0.85}
        disabled={goalSeconds === 0}
        onPress={() => onStart(goalSeconds)}
      >
        <Text style={s.startText}>집중 시작</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '800', color: T.ink },
  sub: { fontSize: 11, fontWeight: '500', color: T.inkMuted, marginTop: 2, marginBottom: 6 },
  bigTime: {
    fontSize: 50,
    fontWeight: '800',
    letterSpacing: -2,
    color: T.ink,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginVertical: 12,
  },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: '#F1EADD',
    borderWidth: 1,
    borderColor: '#E2D7C4',
  },
  chipText: { fontSize: 13, fontWeight: '700', color: T.inkSub },
  startBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnDisabled: { opacity: 0.4 },
  startText: { fontSize: 16, fontWeight: '700', color: T.white },
});
