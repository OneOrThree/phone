import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { getDefaultSubjects } from '@/constants/focusCategories';
import { T } from '@/constants/theme';
import { eunNeun } from '@/v2/screens/onboarding/format';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W5 · 과목 확인·편집 — 선택 카테고리의 기본 추천 과목을 보여주고 추가/삭제.
// 추천 과목이 없는 카테고리는 컨트롤러가 이 스텝을 건너뛴다.
export default function SubjectEditStep({ data, update, onNext, onBack }: StepProps) {
  const category = data.focusCategory ?? '이 목표';
  const [subjects, setSubjects] = useState<string[]>(
    data.subjects.length ? data.subjects : getDefaultSubjects(data.focusCategory),
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = (next: string[]) => {
    setSubjects(next);
    update({ subjects: next });
  };
  const remove = (idx: number) => commit(subjects.filter((_, i) => i !== idx));
  const add = () => {
    const name = draft.trim();
    if (name && !subjects.includes(name)) commit([...subjects, name]);
    setDraft('');
    setAdding(false);
  };

  return (
    <StepScaffold
      title={`${category}${eunNeun(category)} 보통\n이 과목들을 공부해요`}
      ctaLabel="이대로 시작"
      onCta={() => {
        update({ subjects });
        onNext();
      }}
      onBack={onBack}
    >
      <View style={s.list}>
        {subjects.map((name, idx) => (
          <View key={`${name}-${idx}`} style={s.row}>
            <View style={s.iconBox}>
              <Svg width={15} height={15} viewBox="0 0 16 16">
                <Path d="M4 3l9 5-9 5z" fill={T.accent} />
              </Svg>
            </View>
            <Text style={s.name}>{name}</Text>
            <TouchableOpacity
              onPress={() => remove(idx)}
              style={s.remove}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Svg width={10} height={10} viewBox="0 0 12 12">
                <Path d="M1 1l10 10M11 1L1 11" stroke={T.inkMuted} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          </View>
        ))}

        {adding ? (
          <View style={s.row}>
            <View style={s.iconBox}>
              <Svg width={15} height={15} viewBox="0 0 16 16">
                <Path d="M4 3l9 5-9 5z" fill={T.accent} />
              </Svg>
            </View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={add}
              onBlur={add}
              placeholder="과목 이름"
              placeholderTextColor={T.inkMuted}
              autoFocus
              returnKeyType="done"
              style={s.input}
            />
          </View>
        ) : (
          <TouchableOpacity activeOpacity={0.8} onPress={() => setAdding(true)} style={s.addRow}>
            <Svg width={15} height={15} viewBox="0 0 16 16">
              <Path d="M8 2v12M2 8h12" stroke={T.inkMuted} strokeWidth={2} strokeLinecap="round" />
            </Svg>
            <Text style={s.addText}>과목 추가</Text>
          </TouchableOpacity>
        )}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  list: { alignSelf: 'stretch', gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...T.text.label, fontWeight: '700', color: T.ink, flex: 1 },
  input: { ...T.text.label, fontWeight: '700', color: T.ink, flex: 1, padding: 0 },
  remove: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: T.chipBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: T.borderDark,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 12,
  },
  addText: { ...T.text.label, color: T.inkMuted },
});
