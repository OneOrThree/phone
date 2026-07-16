import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import type { StepProps } from '@/screens/onboarding/types';

// W9 · 어제 사용 자가 추측 — 실제 스크린타임(W11)과 비교하기 전, 사용자가 먼저 어림한다.
// 디자인은 2·4·6·8시간 프리셋 칩 선택 + 큰 숫자 표시. guessedYesterdayMinutes(분)로 저장.
const OPTIONS = [2, 4, 6, 8]; // 시간
const DEFAULT_HOURS = 4;

export default function UsageGuessStep({ data, update, onNext }: StepProps) {
  const initial = data.guessedYesterdayMinutes ? data.guessedYesterdayMinutes / 60 : DEFAULT_HOURS;
  const [hours, setHours] = useState<number>(OPTIONS.includes(initial) ? initial : DEFAULT_HOURS);

  return (
    <StepScaffold
      center
      title={'어제 핸드폰,\n몇 시간이나 썼을까요?'}
      subtitle={'먼저 직접 추측해보세요.\n잠시 뒤 실제 기록과 비교해볼게요.'}
      ctaLabel="이만큼 쓴 것 같아요"
      onCta={() => {
        update({ guessedYesterdayMinutes: hours * 60 });
        onNext();
      }}
    >
      <View style={s.card}>
        <Text style={s.cardCap}>내 추측</Text>
        <View style={s.valueRow}>
          <Text style={s.value}>{hours}</Text>
          <Text style={s.unit}>시간쯤</Text>
        </View>
      </View>

      <View style={s.chips}>
        {OPTIONS.map((h) => {
          const on = h === hours;
          return (
            <TouchableOpacity
              key={h}
              activeOpacity={0.85}
              onPress={() => setHours(h)}
              style={[s.chip, on ? s.chipOn : null]}
            >
              <Text style={[s.chipText, on ? s.chipTextOn : null]}>{h}시간</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: T.white,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: T.accent,
    borderRadius: 22,
    paddingVertical: T.space.xxl,
    paddingHorizontal: T.space.xl,
    alignItems: 'center',
    marginBottom: T.space.xl,
  },
  cardCap: { fontSize: 11, fontWeight: '500', color: T.inkMuted, marginBottom: T.space.xs },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: T.space.sm },
  value: { ...T.text.timer, color: T.ink, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 20, fontWeight: '700', color: T.accent },
  chips: { flexDirection: 'row', alignSelf: 'stretch', gap: T.space.sm },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: T.space.md,
    borderRadius: 13,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
  },
  chipOn: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { ...T.text.label, color: T.link },
  chipTextOn: { fontWeight: '800', color: T.white },
});
