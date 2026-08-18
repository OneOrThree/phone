// 통계 카드 공통 프레임 — 흰 카드에 제목(+캡션·부제)과 본문을 담는다.
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';
import { CARD_BORDER_W, CARD_PAD, CARD_RADIUS } from './constants';

export function SectionCard({
  title,
  caption,
  subtitle,
  children,
}: {
  title: string;
  caption?: string;
  subtitle?: string; // 제목 아래 설명 한 줄 — 카드 의미 부제(시안 ST6, GROMO-849)
  children: ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={[s.cardHead, subtitle ? s.cardHeadTight : null]}>
        <Text style={s.cardTitle}>{title}</Text>
        {caption ? <Text style={s.cardCaption}>{caption}</Text> : null}
      </View>
      {subtitle ? <Text style={s.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

// ⚠️ 프레임 치수는 constants.ts에서 가져온다 — 로딩 스켈레톤(StatsSkeleton)이 같은 값으로
//    카드 높이를 계산하므로, 여기서 직접 숫자를 쓰면 둘이 소리 없이 어긋난다(GROMO-1381).
const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: CARD_BORDER_W,
    borderColor: T.border,
    borderRadius: CARD_RADIUS,
    paddingHorizontal: CARD_PAD,
    paddingVertical: CARD_PAD,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: T.space.md,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  cardCaption: { ...T.text.caption, color: T.inkMuted },
  // 부제가 있는 카드 — 제목과 부제를 붙이고, 본문 여백은 부제가 담당
  cardHeadTight: { marginBottom: T.space.xs },
  cardSubtitle: { ...T.text.caption, color: T.inkMuted, marginBottom: T.space.md },
});
