import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { fmtMinutes } from '../format';
import { MemberAvatar } from './MemberAvatar';
import { TierBadge } from './TierBadge';

// 랭킹 한 행 — 순위 · 티어 뱃지 · 아바타 · 이름/티어명 · 주간 집중 시간 · 핀 토글.
// 티어 뱃지(tier_image)는 아바타 코너가 아니라 순위-아바타 사이에 크게 둔다.
// 글씨는 공통 스케일(T.text) — caption(13)이 최소 가독선.
// 시안: 하이라이트(bg #FBF3E8 + 2px #C8893F)는 내 행만, 핀은 별 채움으로만 표시.
interface Props {
  rank?: number | null; // null이면 순위 컬럼 생략
  nickname: string;
  tierLevel: number;
  minutes: number;
  isMe?: boolean;
  pinned?: boolean;
  onPress?: () => void;
  /** 없으면 핀 버튼 생략 */
  onPin?: () => void;
}

export function RankRow({
  rank,
  nickname,
  tierLevel,
  minutes,
  isMe,
  pinned,
  onPress,
  onPin,
}: Props) {
  return (
    <TouchableOpacity
      style={[s.row, isMe ? s.rowMe : null]}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={!onPress}
    >
      {rank != null && (
        <Text style={[s.rank, rank <= 3 ? s.rankTop : null]} allowFontScaling={false}>
          {rank}
        </Text>
      )}
      <TierBadge level={tierLevel} size={30} />
      <MemberAvatar size={36} me={isMe} />
      <View style={s.nameCol}>
        <Text style={s.name} numberOfLines={1}>
          {nickname}
        </Text>
        <Text style={s.tierName}>{tierByLevel(tierLevel).name}</Text>
      </View>
      <Text style={s.time} allowFontScaling={false}>
        {fmtMinutes(minutes)}
      </Text>
      {onPin && (
        <TouchableOpacity onPress={onPin} hitSlop={8} style={s.pinBtn}>
          <Ionicons
            name={pinned ? 'star' : 'star-outline'}
            size={19}
            color={pinned ? T.accent : '#C9BCA8'}
          />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginBottom: 7,
  },
  rowMe: { backgroundColor: '#FBF3E8', borderWidth: 2, borderColor: '#C8893F' },
  rank: {
    ...T.text.label,
    fontWeight: '800',
    width: 22,
    textAlign: 'center',
    color: '#9A8C7C',
  },
  rankTop: { color: T.accent },
  nameCol: { flex: 1, gap: 1, minWidth: 0 },
  name: { ...T.text.label, fontWeight: '700', color: T.ink },
  tierName: { ...T.text.caption, color: T.inkSub },
  time: { ...T.text.label, fontWeight: '800', color: T.ink, fontVariant: ['tabular-nums'] },
  pinBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});
