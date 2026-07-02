import { LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { fmtMinutes } from '../format';
import { MemberAvatar } from './MemberAvatar';

// 하단 "나만의 랭킹" 시트 — 시안: 풀폭 상단 라운드, 접힘=내 순위 카드 / 펼침=핀 경쟁자 목록.
// "모달 펼침" 시안은 별도 화면이 아니라 이 컴포넌트의 open 상태.
export interface MyRankingEntry {
  userId: string;
  nickname: string;
  tierLevel: number;
  minutes: number;
  isMe: boolean;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  /** 집중 시간 내림차순으로 정렬해서 전달 */
  entries: MyRankingEntry[];
  /** 핀한 경쟁자 수 (헤더 "경쟁자 N명 중") */
  pinCount: number;
  onPressEntry?: (entry: MyRankingEntry) => void;
  /** 탭바 위에 띄우기 위한 bottom 오프셋 */
  bottom: number;
}

export function MyRankingSheet({ open, onToggle, entries, pinCount, onPressEntry, bottom }: Props) {
  const myIndex = entries.findIndex((e) => e.isMe);
  const me = myIndex >= 0 ? entries[myIndex] : undefined;

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
              나만의 랭킹 <Text style={s.titleSub}>· 경쟁자 {pinCount}명 중</Text>
            </Text>
            <Text style={s.toggleLabel}>{open ? '접기 ⌄' : '펼치기 ⌃'}</Text>
          </View>

          {/* 접힘 상태 — 내 순위 카드 */}
          {!open && me && (
            <View style={s.meRow}>
              <Text style={s.meRank} allowFontScaling={false}>
                {myIndex + 1}
              </Text>
              <MemberAvatar size={30} />
              <View style={s.meNameCol}>
                <Text style={s.meName} numberOfLines={1}>
                  {me.nickname} <Text style={s.meTag}>나</Text>
                </Text>
                <Text style={s.meTier}>{tierByLevel(me.tierLevel).name}</Text>
              </View>
              <Text style={s.meTime} allowFontScaling={false}>
                {fmtMinutes(me.minutes)}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* 펼침 상태 — 나 + 핀 경쟁자 목록 */}
        {open && (
          <View style={s.list}>
            {entries.map((e, i) => (
              <TouchableOpacity
                key={e.userId}
                style={s.itemRow}
                activeOpacity={0.8}
                onPress={onPressEntry && !e.isMe ? () => onPressEntry(e) : undefined}
                disabled={!onPressEntry || e.isMe}
              >
                <Text style={s.itemRank} allowFontScaling={false}>
                  {i + 1}
                </Text>
                <MemberAvatar size={30} />
                <View style={s.itemNameCol}>
                  <Text style={s.itemName} numberOfLines={1}>
                    {e.nickname}
                    {e.isMe ? <Text style={s.meTag}> 나</Text> : null}
                  </Text>
                  <Text style={s.itemTier}>{tierByLevel(e.tierLevel).name}</Text>
                </View>
                <Text style={s.itemTime} allowFontScaling={false}>
                  {fmtMinutes(e.minutes)}
                </Text>
              </TouchableOpacity>
            ))}
            <Text style={s.footHint}>핀한 경쟁자만 모아 나만의 랭킹으로 봐요</Text>
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
  title: { fontSize: 15, fontWeight: '800', color: T.ink },
  titleSub: { fontSize: 12, fontWeight: '600', color: T.inkSub },
  toggleLabel: { fontSize: 12, fontWeight: '600', color: '#9C6B43' },

  // 접힘 — 내 순위 카드 (시안 하이라이트)
  meRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FBF3E8',
    borderWidth: 1.5,
    borderColor: '#C8893F',
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  meRank: { width: 22, textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#C8893F' },
  meNameCol: { flex: 1, minWidth: 0 },
  meName: { fontSize: 14, fontWeight: '800', color: T.ink },
  meTag: { fontSize: 10, fontWeight: '600', color: '#C8893F' },
  meTier: { fontSize: 11, fontWeight: '600', color: T.inkSub },
  meTime: {
    fontSize: 14,
    fontWeight: '800',
    color: '#C8893F',
    fontVariant: ['tabular-nums'],
  },

  // 펼침 — 목록
  list: { marginTop: 2 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#E2D7C4',
  },
  itemRank: { width: 16, textAlign: 'center', fontSize: 13, fontWeight: '800', color: '#C8893F' },
  itemNameCol: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 14, fontWeight: '700', color: T.ink },
  itemTier: { fontSize: 11, fontWeight: '600', color: T.inkSub },
  itemTime: { fontSize: 13, fontWeight: '800', color: T.ink, fontVariant: ['tabular-nums'] },
  footHint: {
    fontSize: 12,
    fontWeight: '500',
    color: T.inkSub,
    textAlign: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
});
