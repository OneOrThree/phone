import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';

// 준비 시험 변경 계열 시트 공용 UI(GROMO-668) — TagSuggestionSheet(2스텝)와
// RecommendedTagsEditSheet(추천과목 수정하기)가 같은 행 스타일을 쓴다.

// 전체 선택 행 — 리스트 위 오른쪽 정렬, 탭하면 전 항목 체크/해제
export function SelectAllRow({
  checked,
  checkColor,
  onToggle,
}: {
  checked: boolean;
  checkColor: string;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={s.selectAll} activeOpacity={0.7} onPress={onToggle}>
      <Text style={s.selectAllText}>전체 선택</Text>
      <View style={[s.check, checked && { backgroundColor: checkColor, borderColor: checkColor }]}>
        {checked ? <Ionicons name="checkmark" size={15} color={T.white} /> : null}
      </View>
    </TouchableOpacity>
  );
}

// 체크 선택 행 — 행 전체 탭으로 토글, 오른쪽 동그라미에 체크 표시
export function CheckRow({
  name,
  checked,
  checkColor,
  muted,
  onToggle,
}: {
  name: string;
  checked: boolean;
  checkColor: string;
  muted?: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={onToggle}>
      <View style={[s.iconBox, muted && s.iconBoxMuted]}>
        <Ionicons name="book-outline" size={20} color={muted ? T.inkMuted : T.accent} />
      </View>
      <Text style={s.rowName} numberOfLines={1}>
        {name}
      </Text>
      <View style={[s.check, checked && { backgroundColor: checkColor, borderColor: checkColor }]}>
        {checked ? <Ionicons name="checkmark" size={15} color={T.white} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  selectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  selectAllText: { ...T.text.caption, fontWeight: '600', color: T.inkMuted },
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
  iconBoxMuted: { backgroundColor: T.paperAlt },
  rowName: { ...T.text.label, fontWeight: '700', color: T.ink, flex: 1 },
  // 선택 동그라미 — 체크 시 checkColor로 채움
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: T.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
