import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { TagSuggestionSheet } from '@/screens/settings/components/TagSuggestionSheet';
import { RecommendedTagsEditSheet } from '@/screens/settings/components/RecommendedTagsEditSheet';
import { OCCUPATION_GROUPS } from '@/constants/focusCategories';
import { displayNameOf, useOccupations } from '@/services/occupationCatalog';
import { syncOccupation } from '@/services/occupationSync';
import { getDefaultTags } from '@/services/focusApi';
import {
  logFocusTagCreated,
  logFocusTagDeleted,
  logOccupationUpdated,
} from '@/services/analyticsEvents';
import { useSubjects } from '@/store/SubjectContext';
import { useFocus } from '@/store/FocusContext';
import { useUser } from '@/store/UserContext';
import type { Subject } from '@/screens/focus/types';
import type { Occupation } from '@/types/dto/user';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';
import { t } from '@/i18n';

// 준비 시험 변경(SettingsOccupation) — 온보딩 W4와 **같은 소스**(GET /occupations)의 목록에서
// 하나 고른다. 예전엔 이 화면만 앱 하드코딩 목록이라 온보딩과 다른 글자가 떴다(GROMO-1620).
// 선택·저장의 단위는 occupation code이고, 정본은 서버 users.occupation 하나다(GROMO-1624).
// 예전엔 로컬을 먼저 저장하고 서버 PATCH가 실패해도 넘어가서, 화면엔 새 시험인데 리그·비교
// 통계는 옛 시험으로 도는 상태가 조용히 남았다. 이제 PATCH가 성공해야 반영한다.
// [저장]을 누르면 추천 과목(GET /tag/defaults) 추가 + 보유 과목 정리(삭제) 2스텝 시트를
// 먼저 띄우고(GROMO-632/668), 실제 반영(로컬 code + 서버 occupation + 과목 추가/삭제)은
// 시트의 [완료하기]에서 일괄 적용한다. [취소하기]·딤 탭이면 시험 변경까지 전부 무반영.

export default function OccupationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const { subjects, addSubject, deleteSubjects } = useSubjects();
  const { removeFocusSeconds } = useFocus();

  const occupations = useOccupations();
  const { occupation: original, setOccupation } = useUser();
  const [selected, setSelected] = useState<Occupation | null>(original);
  const [saving, setSaving] = useState(false);
  // 저장 후 시트로 제안할 내용 — null이면 시트 비표시.
  // occupation: [저장]을 누른 시점의 선택 스냅샷 — 조회 대기 중 칩을 바꿔도 시트·최종 반영이
  // 눌렀던 시험 기준으로 일관되게 동작한다(리뷰 반영).
  // additions: 미보유 추천 과목명, removals: 보유 과목 전체(삭제 제안).
  const [proposal, setProposal] = useState<{
    occupation: Occupation;
    additions: string[];
    removals: Subject[];
  } | null>(null);
  // [추천과목 수정하기] 시트용 — 누른 시점의 시험 + 추천 과목 전체(null이면 비표시)
  const [editData, setEditData] = useState<{ occupation: Occupation; list: string[] } | null>(null);

  // 현재 시험이 그대로 선택된 상태 — 버튼이 [추천과목 수정하기]가 되어 시험 변경 없이
  // 추천 추가/과목 정리 시트만 다시 돌릴 수 있다(GROMO-668). 다른 시험이면 기존 [저장].
  const isSameAsCurrent = selected !== null && selected === original;
  const canSave = selected !== null;

  // 시험 변경 실제 반영 — 시트 [완료하기](또는 시트 생략 시 저장 직후)에서만 호출된다.
  // 화면 상태(selected)가 아닌 스냅샷된 occupation을 받는다(리뷰 반영).
  // 서버 PATCH가 성공해야 반영이다 — 실패하면 안내만 띄우고 화면에 남아 재시도하게 한다.
  async function applyCategoryChange(occupation: Occupation): Promise<boolean> {
    const ok = await syncOccupation(occupation, 'settings');
    if (ok) setOccupation(occupation);
    else Alert.alert('준비 시험을 바꾸지 못했어요', '네트워크 상태를 확인하고 다시 시도해 주세요.');
    return ok;
  }

  async function handleSave() {
    if (!selected || saving || !canSave) return;
    setSaving(true);
    // 누른 시점의 선택 스냅샷 — 조회 대기 중 칩이 바뀌어도 이 값 기준으로 진행
    const occupation = selected;

    // [추천과목 수정하기] — 현재 시험 그대로일 때. 추천 전체를 단일 시트로 띄워
    // 보유분은 체크된 상태로 시작, diff만 [완료하기]에서 반영한다.
    if (isSameAsCurrent) {
      try {
        const res = await getDefaultTags(occupation);
        setEditData({
          occupation,
          list: [...res.tags].sort((a, b) => a.sortOrder - b.sortOrder).map((tag) => tag.name),
        });
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
    try {
      const res = await getDefaultTags(occupation);
      const owned = new Set(subjects.map((x) => x.name));
      const additions = [...res.tags]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((tag) => tag.name)
        .filter((n) => !owned.has(n));
      if (additions.length > 0 || subjects.length > 0) {
        setSaving(false);
        setProposal({ occupation, additions, removals: subjects }); // 시트 표시 — 반영/취소는 시트 콜백에서
        return;
      }
    } catch {
      // 추천 조회 실패는 조용히 무시 — 시트 없이 바로 반영
    }
    const saved = await applyCategoryChange(occupation);
    setSaving(false);
    if (!saved) return; // 실패 안내를 띄운 뒤 화면에 남는다
    logOccupationUpdated();
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
    // 일괄 삭제 — 개별 deleteSubject 루프는 동명 과목 동시 삭제 시 서버 삭제를 스킵한다(리뷰 반영)
    deleteSubjects(removes.map((x) => x.id));
    removes.forEach((sub) => {
      logFocusTagDeleted();
      if (sub.accumulatedSeconds > 0) removeFocusSeconds(sub.accumulatedSeconds);
    });
  }

  // 시험 변경을 먼저 확정하고 과목 diff를 반영한다 — PATCH가 실패하면 과목까지 손대지 않고
  // 화면에 남아 재시도하게 한다(옛 시험 그대로인데 과목만 바뀌는 상태 방지).
  async function handleComplete(occupation: Occupation, adds: string[], removes: Subject[]) {
    const saved = await applyCategoryChange(occupation);
    if (!saved) return;
    logOccupationUpdated();
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
        title={t('settings.occupation.title')}
        onBack={() => navigation.goBack()}
        footer={
          <TouchableOpacity
            style={[s.saveBtn, !canSave || saving ? s.saveBtnDisabled : null]}
            activeOpacity={0.85}
            disabled={!canSave || saving}
            onPress={handleSave}
          >
            <Text style={s.saveText}>
              {saving
                ? t('common.saving')
                : isSameAsCurrent
                  ? t('settings.occupation.editRecommended')
                  : t('common.save')}
            </Text>
          </TouchableOpacity>
        }
      >
        <Text style={s.desc}>{t('settings.occupation.desc')}</Text>

        {/* 목록·순서는 서버 code(GET /occupations), 표시명은 앱 i18n — 온보딩과 같은 소스 */}
        {OCCUPATION_GROUPS.map((group) => {
          const items = group.codes
            .map((code) => ({ code, name: displayNameOf(occupations, code) }))
            .filter((o): o is { code: Occupation; name: string } => o.name !== null);
          if (!items.length) return null;
          return (
            <View key={group.labelKey} style={s.group}>
              <Text style={s.groupLabel}>{t(group.labelKey)}</Text>
              <View style={s.chips}>
                {items.map((item) => {
                  const on = selected === item.code;
                  return (
                    <TouchableOpacity
                      key={item.code}
                      activeOpacity={0.85}
                      onPress={() => setSelected(item.code)}
                      style={[s.chip, on ? s.chipOn : null]}
                    >
                      <Text style={[s.chipText, on ? s.chipTextOn : null]}>{item.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}

        <View style={s.note}>
          <Ionicons name="information-circle-outline" size={16} color={T.accentDeep} />
          <Text style={s.noteText}>{t('settings.occupation.note')}</Text>
        </View>
      </SettingsScaffold>

      {proposal !== null ? (
        <TagSuggestionSheet
          examLabel={displayNameOf(occupations, proposal.occupation) ?? '이 시험'}
          suggestions={proposal.additions}
          removals={proposal.removals}
          onComplete={(adds, removes) => handleComplete(proposal.occupation, adds, removes)}
          // 취소·딤 탭 — 시험 변경 포함 전부 무반영. 화면에 남아 다시 고를 수 있게 시트만 닫는다.
          onCancel={() => setProposal(null)}
        />
      ) : null}

      {editData !== null ? (
        <RecommendedTagsEditSheet
          examLabel={displayNameOf(occupations, editData.occupation) ?? '이 시험'}
          recommendations={editData.list}
          owned={subjects}
          onComplete={handleEditComplete}
          onCancel={() => setEditData(null)}
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
    minHeight: 54,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveText: { ...T.text.subtitle, color: T.white },
});
