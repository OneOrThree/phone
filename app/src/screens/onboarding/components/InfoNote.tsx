import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/constants/theme';

// 온보딩 공통 안내 박스 — 점 + 텍스트. 강조 문구는 <NoteStrong> 으로 감싼다.
export default function InfoNote({ children }: { children: ReactNode }) {
  return (
    <View style={s.box}>
      <View style={s.dot} />
      <Text style={s.text}>{children}</Text>
    </View>
  );
}

export function NoteStrong({ children }: { children: ReactNode }) {
  return <Text style={s.strong}>{children}</Text>;
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: T.space.md,
    alignItems: 'flex-start',
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    padding: T.space.lg,
    alignSelf: 'stretch',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent, marginTop: T.space.sm },
  text: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },
  strong: { color: T.ink, fontWeight: '700' },
});
