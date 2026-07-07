import { View, Text, StyleSheet } from 'react-native';
import { T, withAlpha } from '@/constants/theme';
import type { SessionFriend } from '@/v2/screens/league/useFocusFriends';
import { hourMin } from '../format';
import { StarAvatar } from './StarAvatar';

// 09 집중 · 친구 그리드 — 세션에서 좌로 스와이프한 페이지. 친구 전체 3열 그리드(실데이터).
// 전원 오늘 총 집중시간을 표기하고, 집중중(isFocusing)은 초록 테두리·시간으로 색 구분.
// 아바타 색은 팔레트 순환 — TODO: 캐릭터 장착 정보 렌더 연동 시 교체.

// 별사탕 아바타 팔레트 (시안 6인 색 그대로 순환)
const AVATAR_COLORS = T.avatarPalette;

export function FriendGrid({ friends }: { friends: SessionFriend[] }) {
  const focusing = friends.filter((f) => f.isFocusing).length;

  // 친구가 없으면 그리드 대신 안내 (친구 추가는 리그 탭 → 친구)
  if (friends.length === 0) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyTitle}>아직 친구가 없어요</Text>
        <Text style={s.emptySub}>
          리그 탭에서 친구를 추가하면{'\n'}집중할 때 여기서 같이 보여요.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <View style={s.banner}>
        <View style={s.bannerDot} />
        <Text style={s.bannerText}>{focusing}명이 지금 같이 집중하고 있어요</Text>
      </View>

      <View style={s.grid}>
        {friends.map((f, i) => (
          <View key={f.userId} style={[s.cell, !f.isFocusing && s.cellOff]}>
            <View style={[s.avatar, f.isFocusing ? s.avatarActive : s.avatarIdle]}>
              <StarAvatar color={AVATAR_COLORS[i % AVATAR_COLORS.length]} size={50} />
            </View>
            <Text style={s.name} numberOfLines={1}>
              {f.nickname}
            </Text>
            {f.isFocusing ? (
              <Text style={s.timeActive}>⏱ {hourMin(f.focusTimeMinutes * 60)}</Text>
            ) : (
              <Text style={s.timeIdle}>{hourMin(f.focusTimeMinutes * 60)}</Text>
            )}
          </View>
        ))}
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
    backgroundColor: withAlpha(T.night.green, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(T.night.green, 0.25),
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 18,
  },
  bannerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.night.green },
  bannerText: { ...T.text.label, fontWeight: '700', color: T.night.greenSoft },

  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  cell: { width: '31%', alignItems: 'center', gap: 5, marginVertical: 10 },
  cellOff: { opacity: 0.5 },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: withAlpha(T.night.cream, 0.08),
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  avatarActive: { borderWidth: 2.5, borderColor: T.night.green },
  avatarIdle: { borderWidth: 2.5, borderColor: withAlpha(T.night.cream, 0.15) },
  name: { ...T.text.label, color: T.paperLight, maxWidth: 74 },
  timeActive: {
    ...T.text.label,
    fontWeight: '700',
    color: T.night.green,
    fontVariant: ['tabular-nums'],
  },
  timeIdle: {
    ...T.text.label,
    fontWeight: '700',
    color: T.night.muted,
    fontVariant: ['tabular-nums'],
  },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 30 },
  emptyTitle: { ...T.text.label, fontWeight: '700', color: T.night.cream },
  emptySub: {
    ...T.text.caption,
    color: T.night.muted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
