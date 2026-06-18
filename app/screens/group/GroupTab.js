import { View, Text, FlatList, StyleSheet, Dimensions } from 'react-native';
import { T, inkBox } from '../../components/theme';

const SCREEN_W = Dimensions.get('window').width;
const H_PAD = 20;
const NUM_COLS = 2;
const COL_GAP = 10;
const CARD_W = (SCREEN_W - H_PAD * 2 - COL_GAP * (NUM_COLS - 1)) / NUM_COLS;

const MISSION_CATEGORY = { FOCUS: '집중', SCREEN_TIME: '스크린타임' };
const STATUS_LABEL = { WAITING: '대기 중', ACTIVE: '활성', ENDED: '종료' };

function formatWindowTime(instant) {
  if (!instant) return '';
  const d = new Date(instant);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatMinutes(min) {
  if (!min) return '0분';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

function InviteCard() {
  return (
    <View style={s.card}>
      <Text style={s.inviteLabel}>초대하기</Text>
      <View style={s.inviteCircle}>
        <Text style={s.invitePlus}>+</Text>
      </View>
    </View>
  );
}

function MemberCard({ member }) {
  const initial = member.nickname?.[0] ?? '?';
  const isOwner = member.role === 'OWNER';
  return (
    <View style={s.card}>
      <View style={[s.avatar, isOwner && s.avatarOwner]}>
        <Text style={[s.avatarText, isOwner && s.avatarTextOwner]}>{initial}</Text>
      </View>
      <Text style={s.cardName} numberOfLines={1}>
        {member.nickname}
      </Text>
      <Text style={s.cardFocus}>⏱ {formatMinutes(member.focusTimeMinutes)}</Text>
      {isOwner && (
        <View style={s.ownerBadge}>
          <Text style={s.ownerBadgeText}>호스트</Text>
        </View>
      )}
    </View>
  );
}

export default function GroupTab({ group }) {
  if (!group) return null;

  const missionText = !group
    ? ''
    : group.missionType === 'DURATION'
      ? `${MISSION_CATEGORY[group.missionCategory] ?? group.missionCategory} · ${group.durationMinutes}분`
      : `${MISSION_CATEGORY[group.missionCategory] ?? group.missionCategory} · ${formatWindowTime(group.windowStart)} ~ ${formatWindowTime(group.windowEnd)}`;

  const sortedMembers = [...(group.members ?? [])].sort(
    (a, b) => b.focusTimeMinutes - a.focusTimeMinutes,
  );

  const isFull = (group.members?.length ?? 0) >= group.maxMembers;
  const listData = isFull ? sortedMembers : [...sortedMembers, { __invite: true }];

  const ListHeader = (
    <View style={s.headerWrap}>
      {/* 미션 정보 카드 */}
      <View style={[s.missionCard, inkBox(T.paperDark)]}>
        <View style={s.missionRow}>
          <View style={s.missionLabelRow}>
            <Text style={s.missionLabel}>미션</Text>
            <View style={s.statusPill}>
              <Text style={s.statusPillText}>{STATUS_LABEL[group.status] ?? group.status}</Text>
            </View>
          </View>
          <Text style={s.missionText}>{missionText}</Text>
        </View>
        {!!group.description && <Text style={s.description}>{group.description}</Text>}
      </View>

      {/* 인원 */}
      <Text style={s.memberCount}>
        멤버 <Text style={s.memberCountNum}>{group.members?.length ?? 0}</Text> / {group.maxMembers}명
      </Text>

      <Text style={s.gridTitle}>멤버</Text>
    </View>
  );

  return (
    <FlatList
      data={listData}
      keyExtractor={(item) => (item.__invite ? '__invite' : String(item.userId))}
      numColumns={NUM_COLS}
      renderItem={({ item }) =>
        item.__invite ? <InviteCard /> : <MemberCard member={item} />
      }
      ListHeaderComponent={ListHeader}
      columnWrapperStyle={s.columnWrapper}
      contentContainerStyle={s.container}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={<View style={s.scrollBottom} />}
    />
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: H_PAD },
  scrollBottom: { height: 20 },

  // 헤더
  headerWrap: { marginBottom: 12 },

  // 미션 카드
  missionCard: { padding: 14, marginTop: 20, marginBottom: 14 },
  missionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  missionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  missionLabel: { fontSize: 12, fontWeight: '700', color: T.ink },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: T.ink,
  },
  statusPillText: { fontSize: 10, fontWeight: '700', color: T.ink },
  missionText: { fontSize: 13, fontWeight: '700', color: T.ink },
  description: { fontSize: 12, color: T.inkMed, marginTop: 8 },

  // 인원
  memberCount: { fontSize: 13, fontWeight: '700', color: T.inkMed, marginBottom: 14 },
  memberCountNum: { color: T.ink, fontWeight: '900' },

  // 그리드 섹션 제목
  gridTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: T.inkMed,
    marginBottom: 10,
  },

  // 앨범 그리드
  columnWrapper: { gap: COL_GAP, marginBottom: COL_GAP },

  card: {
    width: CARD_W,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 6,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    borderRadius: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.paperDark,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarOwner: { backgroundColor: T.ink, borderColor: T.ink },
  avatarText: { fontSize: 22, fontWeight: '900', color: T.inkMed },
  avatarTextOwner: { color: T.paper },
  cardName: { fontSize: 12, fontWeight: '700', color: T.ink, textAlign: 'center' },
  cardFocus: { fontSize: 11, fontWeight: '600', color: T.inkLight },
  ownerBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: T.ink,
  },
  ownerBadgeText: { fontSize: 9, fontWeight: '800', color: T.paper },

  inviteLabel: { fontSize: 12, fontWeight: '700', color: T.inkMed },
  inviteCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitePlus: { fontSize: 28, fontWeight: '300', color: T.inkMed },
});
