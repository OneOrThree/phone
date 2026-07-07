import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import { getDefaultSubjects } from '@/constants/focusCategories';
import { T } from '@/constants/theme';
import { eunNeun } from '@/v2/screens/onboarding/format';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 과목 확인 — 선택 카테고리의 기본 추천 과목을 '읽기 전용'으로만 보여준다(추가/삭제 없음).
// 추천 과목이 없는 카테고리는 컨트롤러가 이 스텝을 건너뛴다.
export default function SubjectEditStep({ data, update, onNext }: StepProps) {
  const category = data.focusCategory ?? '이 목표';
  const subjects = getDefaultSubjects(data.focusCategory);

  return (
    <StepScaffold
      title={`${category}${eunNeun(category)} 보통\n이 과목들을 공부해요`}
      ctaLabel="이대로 시작"
      onCta={() => {
        update({ subjects });
        onNext();
      }}
      scrollable
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
          </View>
        ))}
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
});
