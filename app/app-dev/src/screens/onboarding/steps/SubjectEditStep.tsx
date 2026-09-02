import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import InfoNote, { NoteStrong } from '@/screens/onboarding/components/InfoNote';
import { T } from '@/constants/theme';
import { t } from '@/i18n';
import { eunNeun } from '@/screens/onboarding/format';
import type { StepProps } from '@/screens/onboarding/types';

// 과목 확인 — 선택 카테고리의 추천 과목을 '읽기 전용'으로만 보여준다(추가/삭제 없음).
// 과목은 앞 스텝(FocusCategoryStep)이 GET /tag/defaults로 받아 data.subjects에 채워둔 값.
// 추천 과목이 없는 카테고리는 컨트롤러가 이 스텝을 건너뛴다(hasSubjects=false).
// 개별 행이 버튼처럼 보인다는 피드백(GROMO-821) — 카드를 낱개로 쪼개지 않고 한 박스
// 안에 행을 나열하고 ▶아이콘·굵은 강조를 덜어, '누르는 버튼'이 아닌 정보 리스트로 읽히게 한다.
export default function SubjectEditStep({ data, onNext }: StepProps) {
  const category = data.focusCategoryLabel ?? t('onboarding.subjectEdit.categoryFallback');
  const subjects = data.subjects;

  return (
    <StepScaffold
      testID="onboarding.step.subjectEdit"
      // particle(은/는)은 한국어 문구에서만 쓰는 치환값 — 다른 언어 문구는 이 값을 무시한다.
      title={t('onboarding.subjectEdit.title', { category, particle: eunNeun(category) })}
      ctaLabel={t('onboarding.subjectEdit.cta')}
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
      {/* GROMO-970 — 공통 과목=비교용·직접 추가=기록용 안내(추가 부담 완화) */}
      <View style={s.note}>
        <InfoNote>
          {t('onboarding.subjectEdit.notePrefix')}
          <NoteStrong>{t('onboarding.subjectEdit.noteStrong1')}</NoteStrong>
          {t('onboarding.subjectEdit.noteMiddle')}
          <NoteStrong>{t('onboarding.subjectEdit.noteStrong2')}</NoteStrong>
          {t('onboarding.subjectEdit.noteSuffix')}
        </InfoNote>
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
    paddingHorizontal: T.space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingVertical: T.space.md,
  },
  // 행 사이 얇은 구분선(첫 행 제외) — 낱개 카드가 아니라 하나의 리스트로 읽히게
  rowDivider: { borderTopWidth: 1, borderTopColor: T.divider },
  // ▶아이콘 대체 — 작은 점 마커(누르는 버튼 어포던스 제거)
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent },
  name: { ...T.text.label, color: T.ink, flex: 1 },
  note: { marginTop: T.space.md },
});
