import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import { FOCUS_CATEGORY_GROUPS } from '@/constants/focusCategories';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 16 · 목표 선택 — focusCategory(집중 목표 1개, 리그 매칭용). 서버 계약 미정(신규 필드).
// 카테고리 목록은 리그 시험 칩과 같은 상수(focusCategories)를 쓴다.

export default function FocusCategoryStep({ data, update, onNext, onBack }: StepProps) {
  const selected = data.focusCategory;
  return (
    <StepScaffold
      title="무엇에 집중할까요?"
      subtitle="같은 목표를 가진 사람들과 리그에서 만나요."
      ctaLabel="다음"
      ctaDisabled={!selected}
      onCta={onNext}
      onBack={onBack}
    >
      {FOCUS_CATEGORY_GROUPS.map((g) => (
        <View key={g.label} style={s.group}>
          <Text style={s.groupLabel}>{g.label}</Text>
          <View style={s.chips}>
            {g.items.map((it) => {
              const on = selected === it;
              return (
                <TouchableOpacity
                  key={it}
                  activeOpacity={0.85}
                  onPress={() => update({ focusCategory: it })}
                  style={[s.chip, on ? s.chipOn : null]}
                >
                  <Text style={[s.chipText, on ? s.chipTextOn : null]}>{it}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  group: { marginBottom: 18 },
  groupLabel: { ...T.text.caption, color: T.inkMuted, marginBottom: 9, marginLeft: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
  },
  chipOn: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { ...T.text.label, color: T.ink },
  chipTextOn: { color: T.white },
});
