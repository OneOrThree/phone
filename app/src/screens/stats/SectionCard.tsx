// 통계 카드 공통 프레임 — 흰 카드에 제목(+캡션·부제)과 본문을 담는다.
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';

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

const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 18,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.lg,
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
