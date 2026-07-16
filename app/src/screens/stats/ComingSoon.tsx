import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';

// "준비 중" 티저 — 진짜 UI(children)를 그려두고 블러 + 오버레이를 덮는다.
// 텍스트만 있는 빈 스텁 대신 실제 기능처럼 보이게(비친구 프로필 잠금 티저와 같은 패턴).
// children은 pointerEvents='none'으로 터치 차단.

export function ComingSoon({ note, children }: { note?: string; children: ReactNode }) {
  return (
    <View style={s.wrap}>
      <View pointerEvents="none">{children}</View>
      <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
      <View style={s.overlay}>
        <View style={s.badge}>
          <Ionicons name="hourglass-outline" size={12} color={T.accentDeep} />
          <Text style={s.badgeText}>준비 중</Text>
        </View>
        {note ? <Text style={s.note}>{note}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    paddingHorizontal: T.space.xl,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 999,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.xs,
    shadowColor: T.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  badgeText: { ...T.text.caption, fontWeight: '700', color: T.accentDeep },
  note: { ...T.text.caption, fontWeight: '500', color: T.inkSub, textAlign: 'center' },
});
