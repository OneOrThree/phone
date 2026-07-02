import { LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { fmtMinutes } from '../format';
import { MemberAvatar } from './MemberAvatar';

// 하단 "나만의 랭킹" 시트 — 접힘(내 순위 요약) ↔ 펼침(나+핀 친구 목록).
// 시안 2번 "모달 펼침"은 별도 화면이 아니라 이 컴포넌트의 open 상태.
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
  onPressEntry?: (entry: MyRankingEntry) => void;
  /** 탭바 위에 띄우기 위한 bottom 오프셋 */
  bottom: number;
}

export function MyRankingSheet({ open, onToggle, entries, onPressEntry, bottom }: Props) {
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
            <Text style={s.title}>나만의 랭킹</Text>
            <Ionicons name={open ? 'chevron-down' : 'chevron-up'} size={17} color={T.inkSub} />
          </View>
          {!open && me && (
            <Text style={s.summary} allowFontScaling={false}>
              {myIndex + 1}위 · {me.nickname} · {fmtMinutes(me.minutes)}
            </Text>
          )}
        </TouchableOpacity>

        {open && (
          <View style={s.list}>
            {entries.map((e, i) => (
              <TouchableOpacity
                key={e.userId}
                style={[s.itemRow, e.isMe ? s.itemRowMe : null]}
                activeOpacity={0.8}
                onPress={onPressEntry && !e.isMe ? () => onPressEntry(e) : undefined}
                disabled={!onPressEntry || e.isMe}
              >
                <Text style={s.itemRank} allowFontScaling={false}>
                  {i + 1}
                </Text>
                <MemberAvatar size={34} tierLevel={e.tierLevel} />
                <Text style={s.itemName} numberOfLines={1}>
                  {e.nickname}
                  {e.isMe ? ' (나)' : ''}
                </Text>
                <Text style={s.itemTime} allowFontScaling={false}>
                  {fmtMinutes(e.minutes)}
                </Text>
              </TouchableOpacity>
            ))}
            {entries.length <= 1 && (
              <Text style={s.emptyHint}>랭킹 행의 ★을 눌러 친구를 고정해 보세요</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14 },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    shadowColor: '#50371E',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E4DBCB',
    marginBottom: 7,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...T.text.label, fontSize: 16, color: T.ink },
  summary: { ...T.text.label, color: T.inkSub, marginTop: 4 },

  list: { marginTop: 8 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  itemRowMe: { backgroundColor: '#FBF3E8' },
  itemRank: { width: 18, textAlign: 'center', ...T.text.caption, color: T.inkSub },
  itemName: { flex: 1, ...T.text.label, color: T.ink },
  itemTime: { ...T.text.caption, fontWeight: '700', color: T.ink },
  emptyHint: { ...T.text.caption, color: T.inkMuted, textAlign: 'center', paddingVertical: 8 },
});
