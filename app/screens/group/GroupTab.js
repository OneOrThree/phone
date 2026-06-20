import { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, Dimensions, TouchableOpacity, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { T, inkBox } from '../../components/theme';
import { apiFetch } from '../../utils/api';
import { useUser } from '../../contexts/UserContext';

const SCREEN_W = Dimensions.get('window').width;
const H_PAD = 20;
const NUM_COLS = 2;
const COL_GAP = 10;
const CARD_W = (SCREEN_W - H_PAD * 2 - COL_GAP * (NUM_COLS - 1)) / NUM_COLS;

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

function formatLiveTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function InviteCard() {
  return (
    <View style={s.card}>
      <View style={s.inviteCircle}>
        <Text style={s.invitePlus}>+</Text>
      </View>
      <Text style={s.inviteLabel}>초대하기</Text>
    </View>
  );
}

function MemberCard({ member, groupId, myUserId }) {
  const initial = member.nickname?.[0] ?? '?';
  const isOwner = member.role === 'OWNER';
  const isMe = member.userId === myUserId;
  const isFocusing = member.isFocusing ?? false;

  // 집중 중일 때 초 단위 카운트업
  const baseSeconds = (member.focusTimeMinutes ?? 0) * 60;
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!isFocusing) { setElapsed(0); return; }
    setElapsed(0);
    intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(intervalRef.current);
  }, [isFocusing]);

  function handlePoke() {
    Alert.alert('준비 중', '콕 찌르기 기능은 곧 출시돼요!');
  }

  const cardContent = (
    <>
      {isOwner && (
        <View style={s.ownerBadge}>
          <Text style={s.ownerBadgeText}>호스트</Text>
        </View>
      )}
      <View style={[s.avatar, isOwner && s.avatarOwner]}>
        <Text style={[s.avatarText, isOwner && s.avatarTextOwner]}>{initial}</Text>
      </View>
      <View style={s.cardBottom}>
        <Text style={s.cardName} numberOfLines={1}>{member.nickname}</Text>
        {isFocusing ? (
          <Text style={s.cardFocusLive}>⏱ {formatLiveTime(baseSeconds + elapsed)}</Text>
        ) : (
          <Text style={s.cardFocus}>⏱ {formatMinutes(member.focusTimeMinutes)}</Text>
        )}
      </View>
      {!isMe && (
        <TouchableOpacity style={s.pokeBtn} onPress={handlePoke} activeOpacity={0.7}>
          <Text style={s.pokeBtnText}>👆 콕 찌르기</Text>
        </TouchableOpacity>
      )}
    </>
  );

  if (isFocusing) {
    return (
      <LinearGradient
        colors={['rgba(134,239,172,0.25)', 'rgba(255,255,255,0)', 'rgba(134,239,172,0.25)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[s.card, s.cardFocusing, isMe && s.cardMe]}
      >
        {cardContent}
      </LinearGradient>
    );
  }

  return (
    <View style={[s.card, isMe && s.cardMe]}>
      {cardContent}
    </View>
  );
}

function formatUntil(ms) {
  const mins = Math.ceil(ms / 60000);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}시간 ${m}분 후` : `${h}시간 후`;
  }
  return `${mins}분 후`;
}

export default function GroupTab({ group, groupId }) {
  const { userId: myUserId } = useUser();
  const [challenges, setChallenges] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!groupId) return;
    apiFetch(`/api/v1/groups/${groupId}/challenges`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setChallenges(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [groupId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (!group) return null;

  const active = challenges.filter((c) => c.status === 'ACTIVE');
  let missionText = '오늘 예정된 목표 없음';

  if (group.missionType === 'DURATION') {
    const mins = active[0]?.durationMinutes ?? group.durationMinutes;
    if (mins) missionText = `포커스타임 ${mins}분 이상`;
  } else {
    const ongoing = active.find(
      (c) => new Date(c.windowStart) <= now && now <= new Date(c.windowEnd),
    );
    const upcoming = active
      .filter((c) => new Date(c.windowStart) > now)
      .sort((a, b) => new Date(a.windowStart) - new Date(b.windowStart))[0];

    if (ongoing) {
      missionText = `${formatWindowTime(ongoing.windowStart)} ~ ${formatWindowTime(ongoing.windowEnd)} 포커스 진행 중`;
    } else if (upcoming) {
      const until = formatUntil(new Date(upcoming.windowStart) - now);
      missionText = `${formatWindowTime(upcoming.windowStart)} ~ ${formatWindowTime(upcoming.windowEnd)} 포커스 · ${until} 시작`;
    }
  }

  const sortedMembers = [...(group.members ?? [])].sort(
    (a, b) => b.focusTimeMinutes - a.focusTimeMinutes,
  );

  const isFull = (group.members?.length ?? 0) >= group.maxMembers;
  const listData = isFull ? sortedMembers : [...sortedMembers, { __invite: true }];

  const ListHeader = (
    <View style={s.headerWrap}>
      {/* 미션 정보 카드 */}
      <View style={[s.missionCard, inkBox(T.paperDark)]}>
        <Text style={s.missionText}>
          <Text style={s.missionLabel}>오늘의 미션: </Text>
          {missionText}
        </Text>
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
        item.__invite ? <InviteCard /> : <MemberCard member={item} groupId={groupId} myUserId={myUserId} />
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
  missionLabel: { fontSize: 15, fontWeight: '900', color: T.ink },
  missionText: { fontSize: 15, fontWeight: '700', color: T.ink, textAlign: 'center' },
  description: { fontSize: 14, color: T.inkMed, marginTop: 8 },

  // 인원
  memberCount: { fontSize: 15, fontWeight: '700', color: T.inkMed, marginBottom: 14 },
  memberCountNum: { color: T.ink, fontWeight: '900' },

  // 그리드 섹션 제목
  gridTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: T.inkMed,
    marginBottom: 10,
  },

  // 앨범 그리드
  columnWrapper: { gap: COL_GAP, marginBottom: COL_GAP },

  card: {
    width: CARD_W,
    minHeight: 130,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 8,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    borderRadius: 12,
    position: 'relative',
  },
  cardMe: {
    borderWidth: 2.5,
    borderColor: T.ink,
  },
  cardFocusing: {
    borderWidth: 1.5,
    borderColor: 'rgba(74,222,128,0.6)',
  },
  cardFocusLive: {
    fontSize: 13,
    fontWeight: '700',
    color: '#16a34a',
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
  avatarText: { fontSize: 26, fontWeight: '900', color: T.inkMed },
  avatarTextOwner: { color: T.paper },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardName: { fontSize: 14, fontWeight: '700', color: T.ink },
  cardFocus: { fontSize: 13, fontWeight: '600', color: T.inkLight },
  ownerBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: T.ink,
  },
  ownerBadgeText: { fontSize: 10, fontWeight: '800', color: T.paper },

  pokeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: T.paperLine,
    backgroundColor: T.paperDark,
  },
  pokeBtnText: { fontSize: 12, fontWeight: '700', color: T.ink },

  inviteLabel: { fontSize: 14, fontWeight: '700', color: T.inkMed },
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
