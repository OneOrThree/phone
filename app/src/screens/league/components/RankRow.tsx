import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { fmtDelta, hms } from '../format';
import { MemberAvatar } from './MemberAvatar';
import { TierBadge } from './TierBadge';
import { LiveFocusTime } from './LiveFocusTime';

// 랭킹 한 행 — 순위 · 티어 뱃지 · 아바타 · 이름/티어명 · 주간 집중 시간 · 핀 토글.
// 티어 뱃지(tier_image)는 아바타 코너가 아니라 순위-아바타 사이에 크게 둔다.
// deltaSeconds를 주면(핀한 사람만 모드) 시간 아래에 나 대비 차이를 함께 표시.
// GROMO-810: 집중 중이면 이름 옆 초록 점 + 티어명 자리에 과목·집중 중 라벨,
// 주간 시간이 focusStartedAt 기반으로 초마다 올라가는 라이브 표기로 전환.
// 시간은 초 원본을 HH:MM:SS 실초로 표기(hms, GROMO-665). 글씨는 공통 스케일(T.text) — caption(13)이 최소 가독선.
interface Props {
  rank?: number | null; // null이면 순위 컬럼 생략
  nickname: string;
  tierLevel: number;
  seconds: number;
  isMe?: boolean;
  pinned?: boolean;
  /** 나 대비 주간 집중 차이(초) — 핀한 사람만 모드에서만 전달 */
  deltaSeconds?: number;
  /** 집중 라이브(824 응답) — 서버 배포 전엔 undefined → 기존 고정 표기 */
  isFocusing?: boolean;
  focusStartedAt?: string | null;
  focusTagName?: string | null;
  onPress?: () => void;
  /** 없으면 핀 버튼은 생략하되, 총 집중시간 세로선 정렬을 위해 자리(폭)는 유지 */
  onPin?: () => void;
}

export function RankRow({
  rank,
  nickname,
  tierLevel,
  seconds,
  isMe,
  pinned,
  deltaSeconds,
  isFocusing,
  focusStartedAt,
  focusTagName,
  onPress,
  onPin,
}: Props) {
  const live = isFocusing === true && focusStartedAt != null;
  // 주간 시간 — 집중 중이면 진행 경과를 더해 초 단위 라이브, 아니면 기존 고정 표기
  const timeText = live ? (
    <LiveFocusTime
      baseSeconds={seconds}
      focusStartedAt={focusStartedAt}
      format={hms}
      style={[s.time, s.timeFocusing]}
    />
  ) : (
    <Text style={s.time} allowFontScaling={false}>
      {hms(seconds)}
    </Text>
  );
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
      <MemberAvatar size={36} />
      <View style={s.nameCol}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>
            {nickname}
          </Text>
          {live && <View style={s.focusDot} />}
        </View>
        {live ? (
          <Text style={s.focusingLabel} numberOfLines={1}>
            {focusTagName != null ? `${focusTagName} 집중 중` : '집중 중'}
          </Text>
        ) : (
          <Text style={s.tierName}>{tierByLevel(tierLevel).name}</Text>
        )}
      </View>
      {deltaSeconds != null ? (
        <View style={s.timeCol}>
          {timeText}
          <Text style={[s.delta, deltaSeconds > 0 ? s.deltaAhead : null]} allowFontScaling={false}>
            {fmtDelta(deltaSeconds)}
          </Text>
        </View>
      ) : (
        timeText
      )}
      {onPin ? (
        <TouchableOpacity onPress={onPin} hitSlop={8} style={s.pinBtn}>
          <MaterialCommunityIcons
            name={pinned ? 'pin' : 'pin-outline'}
            size={19}
            color={pinned ? T.accent : T.inkFaint}
          />
        </TouchableOpacity>
      ) : (
        // 내 칸엔 핀 버튼이 없지만, 남의 칸과 총 집중시간 세로선을 맞추려면 같은 폭을 차지해야 함
        <View style={s.pinBtn} />
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
  rowMe: { backgroundColor: T.accentBg, borderWidth: 2, borderColor: T.accent },
  rank: {
    ...T.text.label,
    fontWeight: '800',
    width: 22,
    textAlign: 'center',
    color: T.inkMuted,
  },
  rankTop: { color: T.accent },
  nameCol: { flex: 1, gap: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  name: { ...T.text.label, fontWeight: '700', color: T.ink, flexShrink: 1 },
  tierName: { ...T.text.caption, color: T.inkSub },
  // 집중 중 표시 (GROMO-810) — 이름 옆 초록 점 + 과목 라벨 + 초록 라이브 시간
  focusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.green },
  focusingLabel: { ...T.text.caption, fontWeight: '700', color: T.greenDeep },
  timeFocusing: { color: T.greenDeep },
  time: { ...T.text.label, fontWeight: '800', color: T.ink, fontVariant: ['tabular-nums'] },
  timeCol: { alignItems: 'flex-end', gap: 1 },
  delta: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  deltaAhead: { color: T.accent },
  pinBtn: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
});
