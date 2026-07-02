import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { fmtMinutes } from '../format';
import { MemberAvatar } from './MemberAvatar';

// 랭킹 한 행 — 순위·아바타·이름/티어명·주간 집중 시간·핀 토글.
// 내 행/핀 행은 시안대로 하이라이트(bg #FBF3E8 + 브라운 테두리).
interface Props {
  rank?: number | null; // null이면 순위 컬럼 생략(친구 목록 등)
  nickname: string;
  tierLevel: number;
  minutes: number;
  isMe?: boolean;
  pinned?: boolean;
  onPress?: () => void;
  /** 없으면 핀 버튼 생략(내 행 등) */
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
  const highlight = isMe || pinned;
  return (
    <TouchableOpacity
      style={[s.row, highlight ? s.rowHl : null]}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={!onPress}
    >
      {rank != null && (
        <Text style={[s.rank, rank <= 3 ? s.rankTop : null]} allowFontScaling={false}>
          {rank}
        </Text>
      )}
      <MemberAvatar size={46} tierLevel={tierLevel} />
      <View style={s.nameCol}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>
            {nickname}
          </Text>
          {isMe && (
            <View style={s.meBadge}>
              <Text style={s.meBadgeText}>나</Text>
            </View>
          )}
        </View>
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
            color={pinned ? '#E8B93C' : T.inkMuted}
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
    gap: 11,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginBottom: 8,
  },
  rowHl: { backgroundColor: '#FBF3E8', borderWidth: 2, borderColor: '#C8893F' },
  rank: { width: 24, textAlign: 'center', ...T.text.label, color: T.inkSub },
  rankTop: { color: T.accentDeep, fontWeight: '800' },
  nameCol: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { ...T.text.label, fontSize: 16, color: T.ink, flexShrink: 1 },
  meBadge: {
    backgroundColor: T.accent,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  meBadgeText: { fontSize: 11, fontWeight: '800', color: T.white },
  tierName: { ...T.text.caption, color: T.inkMuted },
  time: { ...T.text.label, fontSize: 15, fontWeight: '700', color: T.ink },
  pinBtn: { padding: 2 },
});
