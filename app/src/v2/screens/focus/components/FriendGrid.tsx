import { View, Text, StyleSheet } from 'react-native';
import { T } from '@/v2/constants/theme';
import type { Friend } from '../types';
import { hourMin } from '../format';
import { StarAvatar } from './StarAvatar';

// 09 집중 · 친구 그리드 — 세션에서 좌로 스와이프한 페이지. 함께 집중 중인 친구 3열 그리드.

export function FriendGrid({ friends }: { friends: Friend[] }) {
  const focusing = friends.filter((f) => f.status === 'focus').length;
  return (
    <View style={s.wrap}>
      <View style={s.banner}>
        <View style={s.bannerDot} />
        <Text style={s.bannerText}>{focusing}명이 지금 같이 집중하고 있어요</Text>
      </View>

      <View style={s.grid}>
        {friends.map((f) => {
          const active = f.status === 'focus';
          return (
            <View key={f.id} style={[s.cell, f.status === 'off' && s.cellOff]}>
              <View style={[s.avatar, active ? s.avatarActive : s.avatarIdle]}>
                <StarAvatar color={f.color} size={50} />
              </View>
              <Text style={s.name} numberOfLines={1}>
                {f.name}
              </Text>
              {f.status === 'focus' ? (
                <Text style={s.timeActive}>⏱ {hourMin(f.elapsedSeconds)}</Text>
              ) : (
                <Text style={s.timeIdle}>{f.status === 'rest' ? '휴식' : '오프'}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: 'rgba(127,203,142,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127,203,142,0.25)',
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  bannerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.night.green },
  bannerText: { ...T.text.caption, fontWeight: '700', color: T.night.greenSoft },

  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  cell: { width: '31%', alignItems: 'center', gap: 5, marginVertical: 10 },
  cellOff: { opacity: 0.5 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(246,241,233,0.08)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  avatarActive: { borderWidth: 2.5, borderColor: T.night.green },
  avatarIdle: { borderWidth: 2.5, borderColor: 'rgba(246,241,233,0.15)' },
  name: { ...T.text.caption, color: T.paperLight, maxWidth: 74 },
  timeActive: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.night.green,
    fontVariant: ['tabular-nums'],
  },
  timeIdle: { ...T.text.caption, fontWeight: '700', color: T.night.muted },
});
