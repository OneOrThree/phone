import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import type { InquiryContact } from '@/constants/inquiryContacts';
import { T } from '@/constants/theme';

// 1:1 문의 담당자 카드(docs/prd/inquiry/low-level-design.md §3 · information-architecture.md §2.3).
// 표시 전용이다 — props in, onPress out. 상태를 갖지 않는다.
//
// 카드 안의 정보 순서는 「누구인가 → 어떤 사람인가 → 행동」 셋뿐이다.
// keywords 는 **소유권 주장이 아니다** — 분위기를 알려줄 뿐이고 사용자는 무시하고 아무나
// 고를 수 있다(policy.md D2 · D6). 한 줄 소개와 응답 시간은 카드에서 뺐다(D9 개정 2026-08-14).

interface InquiryContactCardProps {
  contact: InquiryContact;
  /** 선택된 카테고리의 담당자 — 「추천」 배지 + accent 테두리 */
  recommended: boolean;
  onPress: (contact: InquiryContact) => void;
}

export default function InquiryContactCard({
  contact,
  recommended,
  onPress,
}: InquiryContactCardProps) {
  const avatarColor = T.avatarPalette[contact.avatarPaletteIndex % T.avatarPalette.length];

  return (
    // 배경은 흰색 그대로 두고 테두리만 accent로 바꾼다 — 설정 화면은 흰 바탕(T.paperLight) 위에
    // 흰 카드가 1px T.paperAlt 테두리로만 구분되는 규칙이라 배경을 칠하면 시안과 갈린다(LLD §5.2).
    <View
      style={[s.card, recommended ? s.cardRecommended : null]}
      testID={`inquiry.card.${contact.id}`}
    >
      <View style={s.head}>
        {/* 44 원 + 팔레트 배경 + 흰 이니셜 — 이 조합은 앱에 선례가 없다(새로 만든다).
            MemberTile은 44지만 T.sand + 캐릭터 이미지고, GroupCardBack은 이니셜 + 팔레트지만 36이다.
            여기는 사람 얼굴이 없는 담당자라 이니셜을 쓰되, 카드의 주인공이므로 44를 쓴다. */}
        <View style={[s.avatar, { backgroundColor: avatarColor }]}>
          <Text style={s.avatarText}>{contact.initial}</Text>
        </View>
        <View style={s.headText}>
          <View style={s.nameRow}>
            <Text style={s.name}>{contact.name}</Text>
            {recommended ? (
              <View style={s.badge}>
                <Text style={s.badgeText}>추천</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.keywords}>{contact.keywords}</Text>
        </View>
      </View>

      {/* 버튼 라벨이 카드 3장 다 같고 닉네임은 형제 요소라, accessibilityLabel이 없으면
          화면 읽기에서 똑같은 버튼 3개로 읽힌다 — 어느 방이 열리는지 알 수 없게 된다(LLD §3). */}
      <PressableScale
        style={s.cta}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel={`${contact.name}에게 카카오톡으로 문의하기`}
        onPress={() => onPress(contact)}
        testID={`inquiry.card.${contact.id}.cta`}
      >
        <Ionicons name="chatbubble" size={16} color={T.kakaoInk} />
        <Text style={s.ctaText}>카카오톡으로 문의하기</Text>
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    padding: T.space.lg,
    marginTop: T.space.md,
    shadowColor: T.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  cardRecommended: { borderColor: T.accent },

  head: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...T.text.subtitle, color: T.white },
  headText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: T.space.sm },
  name: { ...T.text.label, color: T.ink },
  badge: {
    backgroundColor: T.accentBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: T.space.sm,
  },
  badgeText: { ...T.text.caption, color: T.accentDeep },
  keywords: { ...T.text.caption, color: T.accentDeep, marginTop: 2 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    // 카카오 브랜드색은 LoginScreen에서 **색만** 가져왔다 — 형상(높이 52 · r14)은 따르지 않는다.
    // 이건 화면의 주 CTA가 아니라 카드 안의 행동 버튼이라 최소 터치 타겟(44pt)까지만 준다.
    backgroundColor: T.kakao,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.md,
  },
  ctaText: { ...T.text.label, color: T.kakaoInk },
});
