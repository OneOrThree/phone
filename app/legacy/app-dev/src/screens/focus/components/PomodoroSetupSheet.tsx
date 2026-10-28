import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import type { PomodoroConfig } from '../types';
import { SheetShell } from '@/components/SheetShell';
import { PressableScale } from '@/components/PressableScale';

// 05 뽀모도로 설정 — 집중/휴식/세트를 스텝퍼로 조절 후 집중 시작.
interface Field {
  key: keyof PomodoroConfig;
  // 라벨·값 문구는 키만 담는다 — t()는 렌더 시점에 부른다.
  labelKey: string;
  valueKey: string;
  step: number;
  min: number;
  max: number;
}
const FIELDS: Field[] = [
  {
    key: 'focusMin',
    labelKey: 'focus.pomodoroSheet.focus',
    valueKey: 'focus.pomodoroSheet.valueMinutes',
    step: 5,
    min: 5,
    max: 90,
  },
  {
    key: 'breakMin',
    labelKey: 'focus.pomodoroSheet.break',
    valueKey: 'focus.pomodoroSheet.valueMinutes',
    step: 1,
    min: 1,
    max: 30,
  },
  {
    key: 'sets',
    labelKey: 'focus.pomodoroSheet.sets',
    valueKey: 'focus.pomodoroSheet.valueSets',
    step: 1,
    min: 1,
    max: 8,
  },
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
      <Text style={s.title}>{t('focus.pomodoroSheet.title', { subject: subjectName })}</Text>
      <Text style={s.sub}>{t('focus.pomodoroSheet.sub')}</Text>

      <View style={s.list}>
        {FIELDS.map((f) => {
          const label = t(f.labelKey);
          return (
            <View key={f.key} style={s.row}>
              <Text style={s.rowLabel}>{label}</Text>
              {/* 스텝퍼도 일반 버튼 규칙(스케일+사운드) — 다만 반복해서 누르는 조절 버튼이라
                햅틱은 주지 않는다(집중 시작 CTA와 무게가 같아져 버린다).
                작은 아이콘 버튼이라 기본 0.97은 잘 안 보여 0.9로 준다. */}
              <View style={s.stepper}>
                <PressableScale
                  style={s.stepBtn}
                  scaleTo={0.9}
                  accessibilityLabel={t('focus.pomodoroSheet.decrease', { label })}
                  onPress={() => bump(f, -1)}
                >
                  <Ionicons name="remove" size={18} color={T.inkSub} />
                </PressableScale>
                <Text style={s.stepValue}>{t(f.valueKey, { count: config[f.key] })}</Text>
                <PressableScale
                  style={s.stepBtn}
                  scaleTo={0.9}
                  accessibilityLabel={t('focus.pomodoroSheet.increase', { label })}
                  onPress={() => bump(f, 1)}
                >
                  <Ionicons name="add" size={18} color={T.inkSub} />
                </PressableScale>
              </View>
            </View>
          );
        })}
      </View>

      <PressableScale style={s.startBtn} haptic="light" onPress={() => onStart(config)}>
        <Text style={s.startText}>{t('focus.setupSheet.start')}</Text>
      </PressableScale>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: {
    ...T.text.label,
    fontWeight: '500',
    color: T.inkMuted,
    marginTop: 2,
    marginBottom: T.space.md,
  },
  list: { gap: T.space.sm, marginBottom: T.space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
  },
  rowLabel: { ...T.text.label, fontWeight: '700', color: T.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: T.space.lg },
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
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { ...T.text.subtitle, color: T.white },
});
