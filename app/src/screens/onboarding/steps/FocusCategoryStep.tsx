import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import { hapticLight } from '@/utils/haptics';
import { OCCUPATION_GROUPS, getDefaultSubjects } from '@/constants/focusCategories';
import { getOccupations } from '@/services/userApi';
import { getDefaultTags } from '@/services/focusApi';
import {
  logOnboardingFocusCategorySubmitted,
  logOnboardingStepAction,
} from '@/services/analyticsEvents';
import type { OccupationResponse } from '@/types/dto/user';
import type { StepProps } from '@/screens/onboarding/types';

// 목표 선택 — GET /occupations(서버)로 카테고리(code·표시명)를 받아 프론트 정적 그룹(OCCUPATION_GROUPS)으로
// 묶어 보여준다. 선택값은 '표시명'을 focusCategory에 저장한다(App·설정·통계 등 로컬 소비처가 표시명 기준이라
// 호환 유지). '다음'에서 선택 occupation의 추천 과목(GET /tag/defaults)을 받아 data.subjects에 채운다 —
// 다음 스텝(과목 확인) 표시 + 컨트롤러의 과목 스텝 삽입 여부(hasSubjects) 판단에 쓰인다.
// 로그인이 이 스텝보다 앞이라 인증 토큰이 있어 서버 조회가 가능하다. 실패 시 정적값으로 폴백한다.
export default function FocusCategoryStep({ data, update, onNext }: StepProps) {
  const [occupations, setOccupations] = useState<OccupationResponse[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const selected = data.focusCategory;

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    getOccupations()
      .then((list) => {
        if (!cancelled) setOccupations(list);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = () => {
    logOnboardingStepAction({ step: 'focus_category', action: 'category_retry' });
    setOccupations(null);
    setReloadKey((k) => k + 1);
  };

  // 선택 카테고리의 추천 과목을 서버에서 받아 data.subjects에 채운 뒤 진행. 실패 시 정적 폴백.
  const proceed = async () => {
    if (!selected || submitting) return;
    logOnboardingFocusCategorySubmitted({ category: selected });
    setSubmitting(true);
    const code = occupations?.find((o) => o.displayName === selected)?.code ?? null;
    try {
      const names = code
        ? (await getDefaultTags(code)).tags.map((t) => t.name)
        : getDefaultSubjects(selected);
      update({ subjects: names });
    } catch {
      update({ subjects: getDefaultSubjects(selected) });
    } finally {
      setSubmitting(false);
    }
    onNext();
  };

  // Maestro E2E — 직군 선택 항목 전역 인덱스(그룹 구분 없이 화면 표시 순서, 0부터).
  // 렌더마다 0으로 초기화되고 항목 렌더 순서대로 증가한다.
  let categoryItemIndex = 0;

  return (
    <StepScaffold
      testID="onboarding.step.category"
      title="무엇에 집중할까요?"
      subtitle="같은 목표를 가진 사람들과 리그에서 만나요."
      ctaLabel={submitting ? '불러오는 중…' : '다음'}
      ctaDisabled={!selected || submitting || !occupations}
      onCta={proceed}
      scrollable
    >
      {!occupations ? (
        <View style={s.center}>
          {loadFailed ? (
            <>
              <Text style={s.errorText}>목록을 불러오지 못했어요.</Text>
              <TouchableOpacity onPress={retry} style={s.retryBtn} activeOpacity={0.85}>
                <Text style={s.retryText}>다시 시도</Text>
              </TouchableOpacity>
            </>
          ) : (
            <ActivityIndicator color={T.accent} />
          )}
        </View>
      ) : (
        OCCUPATION_GROUPS.map((g) => {
          const items = g.codes
            .map((code) => occupations.find((o) => o.code === code))
            .filter((o): o is OccupationResponse => !!o);
          if (!items.length) return null;
          return (
            <View key={g.label} style={s.group}>
              <Text style={s.groupLabel}>{g.label}</Text>
              <View style={s.chips}>
                {items.map((o) => {
                  const on = selected === o.displayName;
                  return (
                    <TouchableOpacity
                      key={o.code}
                      testID={`onboarding.category.item.${categoryItemIndex++}`}
                      activeOpacity={0.85}
                      // 카테고리 변경 시 과목도 리셋 — 이전 카테고리 과목이 남지 않도록.
                      onPress={() => {
                        hapticLight();
                        if (o.displayName !== selected) {
                          // 선택 분포·변심을 보기 위해 '바뀔 때만' 발행한다(같은 칩 재탭은 무발행).
                          logOnboardingStepAction({
                            step: 'focus_category',
                            action: 'category_select',
                            value: o.displayName,
                          });
                          update({ focusCategory: o.displayName, subjects: [] });
                        }
                      }}
                      style={[s.chip, on ? s.chipOn : null]}
                    >
                      <Text style={[s.chipText, on ? s.chipTextOn : null]}>{o.displayName}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })
      )}
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: T.space.lg,
  },
  errorText: { ...T.text.label, color: T.inkSub },
  retryBtn: {
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xl,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.border,
    backgroundColor: T.white,
  },
  retryText: { ...T.text.label, fontWeight: '700', color: T.ink },
  group: { marginBottom: T.space.xl },
  groupLabel: { ...T.text.caption, color: T.inkMuted, marginBottom: T.space.sm, marginLeft: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm },
  chip: {
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    borderRadius: 13,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
  },
  chipOn: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { ...T.text.label, color: T.ink },
  chipTextOn: { color: T.white },
});
