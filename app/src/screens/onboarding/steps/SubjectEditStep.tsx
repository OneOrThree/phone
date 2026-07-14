import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import { eunNeun } from '@/screens/onboarding/format';
import type { StepProps } from '@/screens/onboarding/types';

// 과목 확인 — 선택 카테고리의 추천 과목을 '읽기 전용'으로만 보여준다(추가/삭제 없음).
// 과목은 앞 스텝(FocusCategoryStep)이 GET /tag/defaults로 받아 data.subjects에 채워둔 값.
// 추천 과목이 없는 카테고리는 컨트롤러가 이 스텝을 건너뛴다(hasSubjects=false).
// 개별 행이 버튼처럼 보인다는 피드백(GROMO-821) — 카드를 낱개로 쪼개지 않고 한 박스
// 안에 행을 나열하고 ▶아이콘·굵은 강조를 덜어, '누르는 버튼'이 아닌 정보 리스트로 읽히게 한다.
export default function SubjectEditStep({ data, onNext }: StepProps) {
  const category = data.focusCategory ?? '이 목표';
  const subjects = data.subjects;

  return (
    <StepScaffold
      title={`${category}${eunNeun(category)} 보통\n이 과목들을 공부해요`}
      ctaLabel="이대로 시작"
      onCta={onNext}
      scrollable
    >
      <View style={s.list}>
        {subjects.map((name, idx) => (
          <View key={`${name}-${idx}`} style={[s.row, idx > 0 && s.rowDivider]}>
            <View style={s.dot} />
            <Text style={s.name}>{name}</Text>
          </View>
        ))}
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  // 한 박스 안에 과목 행을 나열 — 개별 카드(버튼 느낌) 대신 단일 컨테이너
  list: {
    alignSelf: 'stretch',
    backgroundColor: T.paper,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
  },
  // 행 사이 얇은 구분선(첫 행 제외) — 낱개 카드가 아니라 하나의 리스트로 읽히게
  rowDivider: { borderTopWidth: 1, borderTopColor: T.divider },
  // ▶아이콘 대체 — 작은 점 마커(누르는 버튼 어포던스 제거)
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent },
  name: { ...T.text.label, color: T.ink, flex: 1 },
});
