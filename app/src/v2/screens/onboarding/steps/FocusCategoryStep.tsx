import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import { T } from '@/v2/constants/theme';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 16 · 목표 선택 — focusCategory(집중 목표 1개, 리그 매칭용). 서버 계약 미정(신규 필드).
// TODO(시안 16): 칩 단일 선택. 카테고리 목록은 추후 서버/상수로 분리.
const GROUPS: { label: string; items: string[] }[] = [
  { label: '전문 자격증', items: ['노무사', '변리사', '세무사', '회계사', '감정평가사'] },
  { label: '공무원·고시', items: ['공무원', '경찰·소방', '행정고시', '자격증'] },
  { label: '학생', items: ['중학생', '고등학생', '수능·N수', '대학생'] },
  { label: '취업·어학', items: ['취업 준비', '토익·토플', '코딩'] },
  { label: '그 외', items: ['자기계발', '집중력 키우기', '기타'] },
];

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
      {GROUPS.map((g) => (
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
