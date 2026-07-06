import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import SettingsScaffold from '@/v2/screens/settings/components/SettingsScaffold';
import { FOCUS_CATEGORY_GROUPS } from '@/constants/focusCategories';
import { STORAGE_KEYS } from '@/types/storage';
import type { V2RootStackParamList } from '@/navigation/types';
import { T } from '@/constants/theme';

// 준비 시험 변경(SettingsOccupation) — 온보딩 W4와 같은 카테고리 목록(focusCategories)에서 하나 고른다.
// 앱이 실제로 굴리는 건 로컬 focusCategory(리그 UI·시험 칩)라 그 값을 바꾼다.
// TODO(백엔드 협의): focusCategory ↔ 서버 Occupation(5종) 매핑 확정 시 updateOccupation 동기화.
// 과목(subjects)은 사용자가 편집했을 수 있어 자동으로 건드리지 않는다(안내만).

export default function OccupationScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [original, setOriginal] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setSaving(false);
    navigation.goBack();
  }

  return (
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
  );
}

const s = StyleSheet.create({
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
