import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { SheetShell } from '@/components/SheetShell';

// GROMO-632 — 준비 시험 변경 직후 해당 직군 추천 과목 제안 시트.
// 행마다 [추가하기]로 하나씩 담거나 [전부 추가하기]로 일괄 추가. 개별 추가된 행은 목록에서 사라진다.
// 이미 보유한 과목은 호출부(OccupationScreen)에서 사전 제외돼 들어온다.
export function TagSuggestionSheet({
  examLabel,
  suggestions,
  onAddOne,
  onAddAll,
  onClose,
}: {
  examLabel: string;
  suggestions: string[]; // 미보유 추천 과목명 (sortOrder 정렬 완료)
  onAddOne: (name: string) => void;
  onAddAll: (names: string[]) => void;
  onClose: () => void; // 건너뛰기·딤 탭·소진 시 닫기 (goBack)
}) {
  const [remaining, setRemaining] = useState(suggestions);

  function handleAddOne(name: string) {
    onAddOne(name);
    const next = remaining.filter((n) => n !== name);
    setRemaining(next);
    if (next.length === 0) {
      // 마지막 항목까지 담으면 확인 후 자동 닫힘
      Alert.alert('추가되었습니다', undefined, [{ text: '확인', onPress: onClose }]);
    } else {
      Alert.alert('추가되었습니다');
    }
  }

  function handleAddAll() {
    if (remaining.length === 0) return;
    onAddAll(remaining);
    Alert.alert(`과목 ${remaining.length}개가 추가되었어요`, undefined, [
      { text: '확인', onPress: onClose },
    ]);
    setRemaining([]);
  }

  return (
    <SheetShell onClose={onClose}>
      <Text style={s.title}>{examLabel} 준비에 필요한 과목을 추천해요</Text>
      <Text style={s.sub}>
        추가하면 같은 시험을 준비하는 사람들과 과목별 공부시간을 비교할 수 있어요.
      </Text>

      <ScrollView style={s.listScroll} showsVerticalScrollIndicator={false}>
        <View style={s.list}>
          {remaining.map((name) => (
            <View key={name} style={s.row}>
              <View style={s.iconBox}>
                <Ionicons name="book-outline" size={20} color={T.accent} />
              </View>
              <Text style={s.rowName} numberOfLines={1}>
                {name}
              </Text>
              <TouchableOpacity
                style={s.addBtn}
                activeOpacity={0.8}
                onPress={() => handleAddOne(name)}
              >
                <Text style={s.addBtnText}>추가하기</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={s.addAllBtn} activeOpacity={0.85} onPress={handleAddAll}>
        <Text style={s.addAllText}>전부 추가하기</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.skipBtn} activeOpacity={0.7} onPress={onClose}>
        <Text style={s.skipText}>건너뛰기</Text>
      </TouchableOpacity>
    </SheetShell>
  );
}

const s = StyleSheet.create({
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2, marginBottom: 13 },
  listScroll: { maxHeight: 320 },
  list: { gap: 9 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 15,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { ...T.text.label, fontWeight: '700', color: T.ink, flex: 1 },
  addBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 11,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.accent,
  },
  addBtnText: { ...T.text.caption, fontWeight: '700', color: T.accent },
  addAllBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  addAllText: { ...T.text.subtitle, color: T.white },
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipText: { ...T.text.label, fontWeight: '600', color: T.inkMuted },
});
