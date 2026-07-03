import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { PomodoroConfig } from '../types';
import { SheetShell } from './SheetShell';

// 05 뽀모도로 설정 — 집중/휴식/세트를 스텝퍼로 조절 후 집중 시작.
interface Field {
  key: keyof PomodoroConfig;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
}
const FIELDS: Field[] = [
  { key: 'focusMin', label: '집중', unit: '분', step: 5, min: 5, max: 90 },
  { key: 'breakMin', label: '휴식', unit: '분', step: 1, min: 1, max: 30 },
  { key: 'sets', label: '세트', unit: '회', step: 1, min: 1, max: 8 },
];
const DEFAULT: PomodoroConfig = { focusMin: 25, breakMin: 5, sets: 4 };

export function PomodoroSetupSheet({
  subjectName,
  onStart,
  onClose,
}: {
  subjectName: string;
  onStart: (config: PomodoroConfig) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<PomodoroConfig>(DEFAULT);

  function bump(f: Field, dir: 1 | -1) {
    setConfig((prev) => {
      const next = prev[f.key] + dir * f.step;
      return { ...prev, [f.key]: Math.max(f.min, Math.min(f.max, next)) };
    });
  }

  return (
    <SheetShell onClose={onClose}>
      <Text style={s.title}>{subjectName} · 뽀모도로</Text>
      <Text style={s.sub}>집중과 휴식을 반복해요.</Text>

      <View style={s.list}>
        {FIELDS.map((f) => (
          <View key={f.key} style={s.row}>
            <Text style={s.rowLabel}>{f.label}</Text>
            <View style={s.stepper}>
              <TouchableOpacity style={s.stepBtn} activeOpacity={0.7} onPress={() => bump(f, -1)}>
                <Ionicons name="remove" size={18} color={T.inkSub} />
              </TouchableOpacity>
              <Text style={s.stepValue}>
                {config[f.key]}
                {f.unit}
              </Text>
              <TouchableOpacity style={s.stepBtn} activeOpacity={0.7} onPress={() => bump(f, 1)}>
                <Ionicons name="add" size={18} color={T.inkSub} />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={s.startBtn} activeOpacity={0.85} onPress={() => onStart(config)}>
        <Text style={s.startText}>집중 시작</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2, marginBottom: 13 },
  list: { gap: 9, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  rowLabel: { ...T.text.label, fontWeight: '700', color: T.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: T.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    ...T.text.label,
    minWidth: 52,
    textAlign: 'center',
    fontWeight: '700',
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  startBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { ...T.text.subtitle, color: T.white },
});
