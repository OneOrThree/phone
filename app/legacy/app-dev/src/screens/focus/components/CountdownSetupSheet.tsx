import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { DrumPicker } from '@/components/DrumPicker';
import { SheetShell } from '@/components/SheetShell';
import { PressableScale } from '@/components/PressableScale';

// 04 카운트다운 설정 — 시/분 휠로 목표 시간을 정하고 집중 시작.
const MAX_HOURS = 12; // 상한 12시간 — 12시간 선택 시 분은 0 고정
const MINUTE_STEP = 5;
// 라벨은 렌더 시점에 t()로 만든다 — 모듈 최상위에서 부르면 언어 변경이 반영되지 않는다.
const HOURS = Array.from({ length: MAX_HOURS + 1 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

export function CountdownSetupSheet({
  subjectName,
  onStart,
  onClose,
}: {
  subjectName: string;
  onStart: (goalSeconds: number) => void;
  onClose: () => void;
}) {
  // 기본 01:30
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(30);
  const goalSeconds = hours * 3600 + minutes * 60;
  const hourItems = HOURS.map((h) => t('focus.countdownSheet.hourUnit', { count: h }));
  const minuteItems = MINUTES.map((mm) => t('focus.countdownSheet.minuteUnit', { count: mm }));

  return (
    <SheetShell onClose={onClose}>
      <Text style={s.title}>{t('focus.countdownSheet.title', { subject: subjectName })}</Text>
      <Text style={s.sub}>{t('focus.countdownSheet.sub')}</Text>

      <View style={s.pickerRow}>
        <View style={s.pickerCol}>
          <DrumPicker
            items={hourItems}
            selectedIndex={hours}
            onChange={(i) => {
              setHours(i);
              if (i === MAX_HOURS) setMinutes(0);
            }}
          />
        </View>
        <View style={s.pickerCol}>
          <DrumPicker
            items={minuteItems}
            selectedIndex={minutes / MINUTE_STEP}
            // 12시간에서 분을 올리면 거부 → 휠이 0분으로 되돌아감
            onChange={(i) => setMinutes(hours === MAX_HOURS ? 0 : i * MINUTE_STEP)}
          />
        </View>
      </View>

      <PressableScale
        style={[s.startBtn, goalSeconds === 0 && s.startBtnDisabled]}
        haptic="light"
        disabled={goalSeconds === 0}
        onPress={() => onStart(goalSeconds)}
      >
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
    marginBottom: T.space.sm,
  },
  pickerRow: { flexDirection: 'row', marginTop: T.space.sm, marginBottom: T.space.lg },
  pickerCol: { flex: 1 },
  startBtn: {
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnDisabled: { opacity: 0.4 },
  startText: { ...T.text.subtitle, color: T.white },
});
