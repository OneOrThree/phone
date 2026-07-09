import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/screens/settings/components/SettingsScaffold';
import { TagSuggestionSheet } from '@/screens/settings/components/TagSuggestionSheet';
import { FOCUS_CATEGORY_GROUPS, occupationForCategory } from '@/constants/focusCategories';
import { updateOccupation } from '@/services/userApi';
import { getDefaultTags } from '@/services/focusApi';
import { logFocusTagCreated } from '@/services/analyticsEvents';
import { useSubjects } from '@/store/SubjectContext';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 준비 시험 변경(SettingsOccupation) — 온보딩 W4와 같은 카테고리 목록(focusCategories)에서 하나 고른다.
// 앱이 실제로 굴리는 건 로컬 focusCategory(리그 UI·시험 칩)라 그 값을 바꾼다.
// 전 카테고리가 서버 Occupation(19종)과 1:1이라 변경 시 서버 occupation도 동기화 —
// 같은 카테고리 랭킹·비교 통계 모수용. (과목(subjects)은 사용자가 편집했을 수 있어 자동으로 건드리지 않는다.)
// 저장 직후에는 해당 직군 추천 과목(GET /tag/defaults)을 시트로 제안하고, 고른 것만 추가한다(GROMO-632).

export default function OccupationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const { subjects, addSubject } = useSubjects();

  const [original, setOriginal] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 저장 후 제안할 미보유 추천 과목 — null이면 시트 비표시
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.focusCategory).then((c) => {
      setOriginal(c);
      setSelected(c);
    });
  }, []);

  const changed = selected !== null && selected !== original;

  async function handleSave() {
    if (!selected || saving || !changed) return;
    setSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.focusCategory, selected);
    } catch {
      // 로컬 저장 실패는 치명적이지 않음
    }
    // 매핑되는 카테고리면 서버 occupation 동기화(실패해도 로컬 저장은 유효 — 다음 변경 때 재시도)
    const occupation = occupationForCategory(selected);
    if (occupation) {
      updateOccupation({ occupation }).catch(() => {});
      // 변경한 직군의 추천 과목 조회 — 보유 과목과 중복은 사전 제외.
      // 조회 실패·추천 없음이면 기존 UX 그대로 바로 뒤로 간다(저장 자체는 이미 완료).
      try {
        const res = await getDefaultTags(occupation);
        const owned = new Set(subjects.map((x) => x.name));
        const names = [...res.tags]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((t) => t.name)
          .filter((n) => !owned.has(n));
        if (names.length > 0) {
          setSaving(false);
          setSuggestions(names); // 시트 표시 — goBack은 시트가 닫힐 때
          return;
        }
      } catch {
        // 추천 조회 실패는 조용히 무시
      }
    }
    setSaving(false);
    navigation.goBack();
  }

  // 시트 콜백 — 추가는 로컬 과목으로만(서버 태그는 세션 업로드 때 tagSync가 지연 생성)
  function handleAddOne(name: string) {
    addSubject(name);
    logFocusTagCreated();
  }
  function handleAddAll(names: string[]) {
    names.forEach((n) => {
      addSubject(n);
      logFocusTagCreated();
    });
  }

  return (
    // 시트가 화면 전체(헤더 포함)를 덮도록 Scaffold 밖 래퍼에서 오버레이한다
    <View style={s.flex1}>
      <SettingsScaffold
        title="준비 시험 변경"
        onBack={() => navigation.goBack()}
        footer={
          <TouchableOpacity
            style={[s.saveBtn, !changed || saving ? s.saveBtnDisabled : null]}
            activeOpacity={0.85}
            disabled={!changed || saving}
            onPress={handleSave}
          >
            <Text style={s.saveText}>{saving ? '저장 중…' : '저장'}</Text>
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
            준비 시험을 바꿔도 이미 등록한 과목은 그대로예요. 과목은 따로 편집할 수 있어요.
          </Text>
        </View>
      </SettingsScaffold>

      {suggestions !== null && selected !== null ? (
        <TagSuggestionSheet
          examLabel={selected}
          suggestions={suggestions}
          onAddOne={handleAddOne}
          onAddAll={handleAddAll}
          onClose={() => navigation.goBack()}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1 },
  desc: { ...T.text.body, color: T.inkSub, marginTop: 6, marginBottom: 10 },
  group: { marginTop: 16 },
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

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 22,
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
