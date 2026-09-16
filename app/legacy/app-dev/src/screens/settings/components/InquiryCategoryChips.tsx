import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { INQUIRY_CATEGORIES, type InquiryCategoryId } from '@/constants/inquiryContacts';
import { T } from '@/constants/theme';
import { t } from '@/i18n';

// 1:1 문의 카테고리 칩(docs/prd/inquiry/low-level-design.md §4).
// 단일 선택이고, 같은 칩을 다시 누르면 해제된다(null).

interface InquiryCategoryChipsProps {
  selected: InquiryCategoryId | null;
  /** 같은 칩 재탭 시 null — 선택 해제 */
  onSelect: (id: InquiryCategoryId | null) => void;
}

export default function InquiryCategoryChips({ selected, onSelect }: InquiryCategoryChipsProps) {
  return (
    <View style={s.chips}>
      {INQUIRY_CATEGORIES.map((category) => {
        const on = selected === category.id;
        return (
          <TouchableOpacity
            key={category.id}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(on ? null : category.id)}
            style={[s.chip, on ? s.chipOn : null]}
            testID={`inquiry.chip.${category.id}`}
          >
            <Text style={[s.chipText, on ? s.chipTextOn : null]}>{t(category.labelKey)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  // 배치·상자는 OccupationScreen의 s.chips·s.chip — 같은 설정 하위 화면의 단일 선택 칩이다.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm },
  chip: {
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    borderRadius: 13,
    backgroundColor: T.white,
    borderWidth: 1.5,
    borderColor: T.border,
    // ⚠️ flexWrap 은 **칩 사이**를 줄바꿈할 뿐 칩 **안**을 줄이지 못한다. 320pt + 최대 글자
    //    배율에서 「집중 · 스크린타임」의 고유 너비가 본문 폭을 넘으면 칩 오른쪽이 화면 밖으로
    //    잘려 읽지도 누르지도 못한다. 폭을 제한하고 라벨이 그 안에서 줄바꿈되게 한다.
    maxWidth: '100%',
    flexShrink: 1,
  },
  // ⚠️ 선택 상태만 출처가 다르다(ChallengeComposeSheet의 s.chipOn·s.chipTextOn) — 의도한 것이다.
  //    OccupationScreen의 선택 상태는 accent 채움 + 흰 글자라 화면에서 가장 강한 요소가 되는데,
  //    카테고리는 담당자를 고르기 위한 길잡이일 뿐이라(policy.md D6) 담당자 카드보다 앞서면 안 된다.
  //    그래서 선택 표현만 옅은 틴트 쪽을 쓴다. 두 값 모두 코드에 실재하므로 새 값은 없다.
  chipOn: { backgroundColor: T.accentBg, borderColor: T.accent },
  chipText: { ...T.text.label, color: T.ink },
  chipTextOn: { color: T.accentDeep, fontWeight: '700' },
});
