import { LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { fmtDelta, fmtMinutes } from '../format';
import { MemberAvatar } from './MemberAvatar';
import { TierBadge } from './TierBadge';

// 하단 "내 순위" 시트 — 접힘/펼침 공통으로 '지금 보는 리그 기준 내 순위 카드'를 고정하고,
// 펼치면 핀한 라이벌 목록(나 대비 시간 차)이 붙는다.
// 순위 숫자는 위 랭킹 리스트와 같은 파생값 하나만 받는다 — 순위 기준 이원화 방지.
export interface RivalEntry {
  userId: string;
  nickname: string;
  tierLevel: number;
  minutes: number;
  /** 나 대비 주간 집중 차이(분) — 양수면 나보다 앞섬 */
  deltaMinutes: number;
}

export interface MyRankStatus {
  /** 현재 리그 기준 내 순위 — 리스트와 동일 기준 */
  rank: number;
  nickname: string;
  tierLevel: number;
  minutes: number;
  /** 바로 윗 순위와의 차이 — null이면 1위 */
  above: { nickname: string; gapMinutes: number } | null;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  /** 지금 보고 있는 리그 라벨 (예: '노무사 리그') — 순위 기준 표기 */
  leagueTitle: string;
  /** null이면 이 리그 순위에 내가 없음 */
  status: MyRankStatus | null;
  /** 내 순위 카드 탭 → 리스트의 내 행으로 스크롤 */
  onPressMyRank?: () => void;
  /** 집중 시간 내림차순으로 정렬해서 전달 */
  rivals: RivalEntry[];
  onPressRival?: (rival: RivalEntry) => void;
  /** 탭바 위에 띄우기 위한 bottom 오프셋 */
  bottom: number;
}

export function MyRankingSheet({
  open,
  onToggle,
  leagueTitle,
  status,
  onPressMyRank,
  rivals,
  onPressRival,
  bottom,
}: Props) {
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={[s.wrap, { bottom }]} pointerEvents="box-none">
      <View style={s.card}>
        <TouchableOpacity activeOpacity={0.85} onPress={toggle}>
          <View style={s.handle} />
          <View style={s.headerRow}>
            <Text style={s.title}>
              내 순위 <Text style={s.titleSub}>· {leagueTitle}</Text>
            </Text>
            <Text style={s.toggleLabel}>{open ? '접기 ⌄' : `라이벌 ${rivals.length} ⌃`}</Text>
          </View>
        </TouchableOpacity>

        {/* 내 순위 카드 — 접힘/펼침 공통 고정. 탭하면 리스트의 내 행으로 */}
        {status ? (
          <TouchableOpacity
            style={s.meRow}
            activeOpacity={0.85}
            onPress={onPressMyRank}
            disabled={!onPressMyRank}
          >
            <Text style={s.meRank} allowFontScaling={false}>
              {status.rank}
            </Text>
            <TierBadge level={status.tierLevel} size={26} />
            <MemberAvatar size={30} me />
            <View style={s.meNameCol}>
              <Text style={s.meName} numberOfLines={1}>
                {status.nickname} <Text style={s.meTag}>나</Text>
              </Text>
              <Text style={s.meTier}>{tierByLevel(status.tierLevel).name}</Text>
            </View>
            <View style={s.meTimeCol}>
              <Text style={s.meTime} allowFontScaling={false}>
                {fmtMinutes(status.minutes)}
              </Text>
              <Text style={s.meGap} numberOfLines={1} allowFontScaling={false}>
                {status.above
                  ? `▲ ${status.above.nickname}까지 ${fmtMinutes(status.above.gapMinutes)}`
                  : '지금 1위예요'}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={s.meRow}>
            <Text style={s.emptyText}>아직 이번 주 내 순위가 없어요</Text>
          </View>
        )}

        {/* 펼침 — 핀한 라이벌 목록: 순위 숫자 없이 나 대비 차이로 비교 */}
        {open && (
          <View style={s.list}>
            {rivals.map((r) => (
              <TouchableOpacity
                key={r.userId}
                style={s.itemRow}
                activeOpacity={0.8}
                onPress={onPressRival ? () => onPressRival(r) : undefined}
                disabled={!onPressRival}
              >
                <MemberAvatar size={30} />
                <View style={s.itemNameCol}>
                  <Text style={s.itemName} numberOfLines={1}>
                    {r.nickname}
                  </Text>
                  <Text style={s.itemTier}>{tierByLevel(r.tierLevel).name}</Text>
                </View>
                <View style={s.itemTimeCol}>
                  <Text style={s.itemTime} allowFontScaling={false}>
                    {fmtMinutes(r.minutes)}
                  </Text>
                  <Text
                    style={[s.itemDelta, r.deltaMinutes > 0 ? s.itemDeltaAhead : null]}
                    allowFontScaling={false}
                  >
                    {fmtDelta(r.deltaMinutes)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            <Text style={s.footHint}>
              {rivals.length
                ? '시간 차는 내 이번 주 집중 기준이에요'
                : '랭킹에서 별(★)을 누르면 라이벌로 담겨요'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0 },
  card: {
    backgroundColor: '#F1EADD',
    borderTopWidth: 1,
    borderTopColor: '#E2D7C4',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    shadowColor: '#50371E',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -8 },
    elevation: 6,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D8CFBE',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { ...T.text.label, fontWeight: '800', color: T.ink },
  titleSub: { ...T.text.caption, color: T.inkSub },
  toggleLabel: { ...T.text.caption, color: '#9C6B43' },

  // 내 순위 카드 (시안 하이라이트)
  meRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FBF3E8',
    borderWidth: 1.5,
    borderColor: '#C8893F',
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  meRank: {
    ...T.text.label,
    fontWeight: '800',
    width: 22,
    textAlign: 'center',
    color: '#C8893F',
  },
  meNameCol: { flex: 1, minWidth: 0 },
  meName: { ...T.text.label, fontWeight: '800', color: T.ink },
  meTag: { ...T.text.caption, color: '#C8893F' },
  meTier: { ...T.text.caption, color: T.inkSub },
  meTimeCol: { alignItems: 'flex-end', gap: 2 },
  meTime: {
    ...T.text.label,
    fontWeight: '800',
    color: '#C8893F',
    fontVariant: ['tabular-nums'],
  },
  meGap: { ...T.text.caption, color: T.inkSub },
  emptyText: {
    ...T.text.caption,
    flex: 1,
    textAlign: 'center',
    color: T.inkSub,
    paddingVertical: 4,
  },

  // 펼침 — 라이벌 목록
  list: { marginTop: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#E2D7C4',
  },
  itemNameCol: { flex: 1, minWidth: 0 },
  itemName: { ...T.text.label, fontWeight: '700', color: T.ink },
  itemTier: { ...T.text.caption, color: T.inkSub },
  itemTimeCol: { alignItems: 'flex-end', gap: 2 },
  itemTime: {
    ...T.text.caption,
    fontWeight: '800',
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  itemDelta: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  itemDeltaAhead: { color: '#C8893F' },
  footHint: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkSub,
    textAlign: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
});
