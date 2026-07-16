import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { TagSuggestionSheet } from '@/screens/settings/components/TagSuggestionSheet';
import { RecommendedTagsEditSheet } from '@/screens/settings/components/RecommendedTagsEditSheet';
import { FOCUS_CATEGORY_GROUPS, occupationForCategory } from '@/constants/focusCategories';
import { updateOccupation } from '@/services/userApi';
import { getDefaultTags } from '@/services/focusApi';
import { logFocusTagCreated, logFocusTagDeleted } from '@/services/analyticsEvents';
import { useSubjects } from '@/store/SubjectContext';
import { useFocus } from '@/store/FocusContext';
import type { Subject } from '@/screens/focus/types';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 준비 시험 변경(SettingsOccupation) — 온보딩 W4와 같은 카테고리 목록(focusCategories)에서 하나 고른다.
// 앱이 실제로 굴리는 건 로컬 focusCategory(리그 UI·시험 칩)라 그 값을 바꾼다.
// 전 카테고리가 서버 Occupation(19종)과 1:1이라 변경 시 서버 occupation도 동기화 —
// 같은 카테고리 랭킹·비교 통계 모수용.
// [저장]을 누르면 추천 과목(GET /tag/defaults) 추가 + 보유 과목 정리(삭제) 2스텝 시트를
// 먼저 띄우고(GROMO-632/668), 실제 반영(로컬 focusCategory + 서버 occupation + 과목 추가/삭제)은
// 시트의 [완료하기]에서 일괄 적용한다. [취소하기]·딤 탭이면 시험 변경까지 전부 무반영.

export default function OccupationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const { subjects, addSubject, deleteSubject } = useSubjects();
  const { removeFocusSeconds } = useFocus();

  const [original, setOriginal] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 저장 후 시트로 제안할 내용 — null이면 시트 비표시.
  // additions: 미보유 추천 과목명, removals: 보유 과목 전체(삭제 제안).
  const [proposal, setProposal] = useState<{ additions: string[]; removals: Subject[] } | null>(
    null,
  );
  // [추천과목 수정하기] 시트용 — 현재 시험의 추천 과목 전체(null이면 비표시)
  const [editList, setEditList] = useState<string[] | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focusCategory).then((c) => {
      setOriginal(c);
      setSelected(c);
    });
  }, []);

  // 현재 시험이 그대로 선택된 상태 — 버튼이 [추천과목 수정하기]가 되어 시험 변경 없이
  // 추천 추가/과목 정리 시트만 다시 돌릴 수 있다(GROMO-668). 다른 시험이면 기존 [저장].
  const isSameAsCurrent = selected !== null && selected === original;
  const canSave = selected !== null;

  // 시험 변경 실제 반영 — 시트 [완료하기](또는 시트 생략 시 저장 직후)에서만 호출된다
  async function applyCategoryChange() {
    if (!selected) return;
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, selected);
    } catch {
      // 로컬 저장 실패는 치명적이지 않음
    }
    // 매핑되는 카테고리면 서버 occupation 동기화(실패해도 로컬 저장은 유효 — 다음 변경 때 재시도)
    const occupation = occupationForCategory(selected);
    if (occupation) updateOccupation({ occupation }).catch(() => {});
  }

  async function handleSave() {
    if (!selected || saving || !canSave) return;
    setSaving(true);
    const occupation = occupationForCategory(selected);

    // [추천과목 수정하기] — 현재 시험 그대로일 때. 추천 전체를 단일 시트로 띄워
    // 보유분은 체크된 상태로 시작, diff만 [완료하기]에서 반영한다.
    if (isSameAsCurrent && occupation) {
      try {
        const res = await getDefaultTags(occupation);
        setEditList([...res.tags].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.name));
      } catch {
        // 조회 실패 — 시트 없이 화면에 남는다(재시도 가능)
      }
      setSaving(false);
      return;
    }

    // [저장] — 다른 시험으로 변경. 추천 과목 조회 후 2스텝 시트(추가 제안 + 보유 과목 정리).
    // 삭제 제안은 직군 무관 '보유 과목 전체'를 대상으로 한다(GROMO-668) —
    // 전전 시험 과목처럼 어느 직군 추천에도 없는 과목도 이 기회에 정리할 수 있게.
    // 이 시점엔 아무것도 저장하지 않는다 — 반영은 시트 [완료하기]에서(취소하면 시험 변경도 무효).
    if (occupation) {
      try {
        const res = await getDefaultTags(occupation);
        const owned = new Set(subjects.map((x) => x.name));
        const additions = [...res.tags]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((t) => t.name)
          .filter((n) => !owned.has(n));
        if (additions.length > 0 || subjects.length > 0) {
          setSaving(false);
          setProposal({ additions, removals: subjects }); // 시트 표시 — 반영/취소는 시트 콜백에서
          return;
        }
      } catch {
        // 추천 조회 실패는 조용히 무시 — 시트 없이 바로 반영
      }
    }
    await applyCategoryChange();
    setSaving(false);
    navigation.goBack();
  }

  // 시트 [완료하기] — 시험 변경 + 과목 추가/삭제를 이 시점에 일괄 반영하고 닫는다.
  // 추가는 addSubject가 서버 태그 생성(syncTagCreated)까지 즉시 발사한다(실패 시 세션 업로드 때 자가치유).
  // 삭제는 FocusCategoryScreen과 동일한 후처리 — 서버 태그 동기화는 deleteSubject 내장,
  // 오늘 누적분은 홈 '오늘 집중'에서도 차감.
  function applySubjectDiff(adds: string[], removes: Subject[]) {
    adds.forEach((n) => {
      addSubject(n);
      logFocusTagCreated();
    });
    removes.forEach((sub) => {
      deleteSubject(sub.id);
      logFocusTagDeleted();
      if (sub.accumulatedSeconds > 0) removeFocusSeconds(sub.accumulatedSeconds);
    });
  }

  function handleComplete(adds: string[], removes: Subject[]) {
    applyCategoryChange();
    applySubjectDiff(adds, removes);
    navigation.goBack();
  }

  // [추천과목 수정하기] 완료 — 시험은 그대로이므로 과목 diff만 반영
  function handleEditComplete(adds: string[], removes: Subject[]) {
    applySubjectDiff(adds, removes);
    navigation.goBack();
  }

  return (
    // 시트가 화면 전체(헤더 포함)를 덮도록 Scaffold 밖 래퍼에서 오버레이한다
    <View style={s.flex1}>
      <SettingsScaffold
        title="준비 시험 변경"
        onBack={() => navigation.goBack()}
        footer={
          <TouchableOpacity
            style={[s.saveBtn, !canSave || saving ? s.saveBtnDisabled : null]}
            activeOpacity={0.85}
            disabled={!canSave || saving}
            onPress={handleSave}
          >
            <Text style={s.saveText}>
              {saving ? '저장 중…' : isSameAsCurrent ? '추천과목 수정하기' : '저장'}
            </Text>
          </TouchableOpacity>
        }
      >
        <Text style={s.desc}>같은 목표를 준비하는 사람들과 리그에서 만나요.</Text>

        {FOCUS_CATEGORY_GROUPS.map((group) => (
          <View key={group.label} style={s.group}>
            <Text style={s.groupLabel}>{group.label}</Text>
            <View style={s.chips}>
              {group.items.map((item) => {
                const on = selected === item;
                return (
                  <TouchableOpacity
                    key={item}
                    activeOpacity={0.85}
                    onPress={() => setSelected(item)}
                    style={[s.chip, on ? s.chipOn : null]}
                  >
                    <Text style={[s.chipText, on ? s.chipTextOn : null]}>{item}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={16} color={T.accentDeep} />
          <Text style={s.noteText}>
            준비 시험을 바꿔도 이미 등록한 과목은 그대로예요.{'\n'}과목은 따로 편집할 수 있어요.
          </Text>
        </View>
      </SettingsScaffold>

      {proposal !== null && selected !== null ? (
        <TagSuggestionSheet
          examLabel={selected}
          suggestions={proposal.additions}
          removals={proposal.removals}
          onComplete={handleComplete}
          // 취소·딤 탭 — 시험 변경 포함 전부 무반영. 화면에 남아 다시 고를 수 있게 시트만 닫는다.
          onCancel={() => setProposal(null)}
        />
      ) : null}

      {editList !== null && selected !== null ? (
        <RecommendedTagsEditSheet
          examLabel={selected}
          recommendations={editList}
          owned={subjects}
          onComplete={handleEditComplete}
          onCancel={() => setEditList(null)}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  desc: { ...T.text.body, color: T.inkSub, marginTop: T.space.sm, marginBottom: T.space.md },
  group: { marginTop: T.space.lg },
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

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.xxl,
  },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  saveBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { ...T.text.subtitle, color: T.white },
});
