import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { T, inkBox } from '../../components/theme';
import { apiFetch } from '../../utils/api';
import { useUser } from '../../contexts/UserContext';
import { timeStrToSeconds, nowSecondsInZone, zoneSuffix } from '../../utils/challengeTime';

const SCREEN_W = Dimensions.get('window').width;
const H_PAD = 20;
const NUM_COLS = 2;
const COL_GAP = 10;
const CARD_W = (SCREEN_W - H_PAD * 2 - COL_GAP * (NUM_COLS - 1)) / NUM_COLS;

function formatWindowTime(timeStr) {
  if (!timeStr) return '';
  // 백엔드가 "HH:mm:ss" 형식으로 반환 → "HH:mm"으로 표시
  const [h, m] = timeStr.split(':');
  return `${h}:${m}`;
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

function SpeechBubble({ bio, isMe, onPress }) {
  const hasBio = bio && bio.trim().length > 0;
  if (!hasBio && !isMe) return null;
  return (
    <TouchableOpacity
      style={s.bubbleWrap}
      onPress={isMe ? onPress : undefined}
      activeOpacity={isMe ? 0.7 : 1}
    >
      <View style={s.bubble}>
        <Text style={[s.bubbleText, !hasBio && s.bubblePlaceholder]} numberOfLines={2}>
          {hasBio ? bio : '소개 추가'}
        </Text>
      </View>
      <View style={s.bubbleTail} />
    </TouchableOpacity>
  );
}

function MemberCard({ member, groupId, myUserId, bio, onEditBio, onPress }) {
  const initial = member.nickname?.[0] ?? '?';
  const isOwner = member.role === 'OWNER';
  const isMe = member.userId === myUserId;
  const isFocusing = member.isFocusing ?? false;

  // 집중 중일 때 초 단위 카운트업
  const baseSeconds = (member.focusTimeMinutes ?? 0) * 60;
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!isFocusing) {
      setElapsed(0);
      return;
    }
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
      <SpeechBubble bio={bio} isMe={isMe} onPress={onEditBio} />
      <View style={[s.avatar, isOwner && s.avatarOwner]}>
        <Text style={[s.avatarText, isOwner && s.avatarTextOwner]}>{initial}</Text>
      </View>
      <View style={s.cardBottom}>
        <Text style={s.cardName} numberOfLines={1}>
          {member.nickname}
        </Text>
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
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <LinearGradient
          colors={['rgba(134,239,172,0.25)', 'rgba(255,255,255,0)', 'rgba(134,239,172,0.25)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[s.card, s.cardFocusing, isMe && s.cardMe]}
        >
          {cardContent}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[s.card, isMe && s.cardMe]} onPress={onPress} activeOpacity={0.85}>
      {cardContent}
    </TouchableOpacity>
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

export default function GroupTab({ group, groupId, refreshing, onRefresh }) {
  const { userId: myUserId } = useUser();
  const navigation = useNavigation();
  const [challenges, setChallenges] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [myBio, setMyBio] = useState('');

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

  useEffect(() => {
    if (!groupId) return;
    AsyncStorage.getItem(`gromo:group:${groupId}:bio`)
      .then((val) => setMyBio(val ?? ''))
      .catch(() => {});
  }, [groupId]);

  function handleEditBio() {
    Alert.prompt(
      '한줄 소개',
      '그룹에서 보여질 나만의 한줄 소개',
      (text) => {
        if (text === null) return;
        const trimmed = text.trim();
        setMyBio(trimmed);
        AsyncStorage.setItem(`gromo:group:${groupId}:bio`, trimmed).catch(() => {});
      },
      'plain-text',
      myBio,
    );
  }

  if (!group) return null;

  const active = challenges.filter((c) => c.status === 'ACTIVE');
  let missionText = '오늘 예정된 목표 없음';

  if (group.missionType === 'DURATION') {
    const mins = active[0]?.durationMinutes ?? group.durationMinutes;
    if (mins) missionText = `포커스타임 ${mins}분 이상`;
  } else {
    // 그룹 타임존 벽시계의 '하루 중 초' 기준으로 비교
    const nowDate = new Date(now);
    const ongoing = active.find((c) => {
      const nowSec = nowSecondsInZone(c.timeZone, nowDate);
      return timeStrToSeconds(c.windowStart) <= nowSec && nowSec <= timeStrToSeconds(c.windowEnd);
    });
    const upcoming = active
      .filter((c) => timeStrToSeconds(c.windowStart) > nowSecondsInZone(c.timeZone, nowDate))
      .sort((a, b) => timeStrToSeconds(a.windowStart) - timeStrToSeconds(b.windowStart))[0];

    if (ongoing) {
      missionText = `${formatWindowTime(ongoing.windowStart)} ~ ${formatWindowTime(ongoing.windowEnd)}${zoneSuffix(ongoing.timeZone)} 포커스 진행 중`;
    } else if (upcoming) {
      const diffSec = timeStrToSeconds(upcoming.windowStart) - nowSecondsInZone(upcoming.timeZone, nowDate);
      const until = formatUntil(diffSec * 1000);
      missionText = `${formatWindowTime(upcoming.windowStart)} ~ ${formatWindowTime(upcoming.windowEnd)}${zoneSuffix(upcoming.timeZone)} 포커스 · ${until} 시작`;
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
      </View>

      {/* 인원 */}
      <Text style={s.memberCount}>
        멤버 <Text style={s.memberCountNum}>{group.members?.length ?? 0}</Text> / {group.maxMembers}
        명
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
        item.__invite ? (
          <InviteCard />
        ) : (
          <MemberCard
            member={item}
            groupId={groupId}
            myUserId={myUserId}
            bio={item.userId === myUserId ? myBio : (item.bio ?? '')}
            onEditBio={handleEditBio}
            onPress={() => navigation.navigate('MemberCalendar', { member: item, groupId })}
          />
        )
      }
      ListHeaderComponent={
        <>
          {refreshing && (
            <ActivityIndicator size="small" color={T.inkMed} style={s.refreshIndicator} />
          )}
          {ListHeader}
        </>
      }
      columnWrapperStyle={s.columnWrapper}
      contentContainerStyle={s.container}
      showsVerticalScrollIndicator={false}
      ListFooterComponent={<View style={s.scrollBottom} />}
      onScrollEndDrag={({ nativeEvent }) => {
        if (nativeEvent.contentOffset.y < -60 && !refreshing) {
          onRefresh?.();
        }
      }}
    />
  );
}

const s = StyleSheet.create({
  container: { paddingHorizontal: H_PAD },
  scrollBottom: { height: 20 },
  refreshIndicator: { marginTop: 10 },

  // 헤더
  headerWrap: { marginBottom: 12 },

  // 미션 카드
  missionCard: { padding: 14, marginTop: 14, marginBottom: 14 },
  missionLabel: { fontSize: 15, fontWeight: '900', color: T.ink },
  missionText: { fontSize: 15, fontWeight: '700', color: T.ink, textAlign: 'center' },
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

  // 말풍선
  bubbleWrap: { alignItems: 'center', marginBottom: 4 },
  bubble: {
    backgroundColor: T.paperDark,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.paperLine,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: CARD_W - 24,
  },
  bubbleText: { fontSize: 11, fontWeight: '500', color: T.ink, textAlign: 'center' },
  bubblePlaceholder: { color: T.inkLight },
  bubbleTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: T.paperDark,
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
