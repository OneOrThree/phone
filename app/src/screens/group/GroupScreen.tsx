import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/constants/theme';
import { CharacterImage } from '@/components/character/CharacterImage';
import { useUser } from '@/store/UserContext';
import { getMyGroups } from '@/services/groupApi';
import type { GroupSummaryResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  clearPendingInvite,
  peekPendingInvite,
  setGroupInviteListener,
} from '@/navigation/navigationRef';
import { logGroupViewed } from '@/services/analyticsEvents';
import GroupRoomScreen from './GroupRoomScreen';
import GroupFindSheet from './components/GroupFindSheet';
import GroupInviteSheet from './components/GroupInviteSheet';

// 그룹 탭 진입점 — 명세 docs/app/group-plan.md §6-1. Fakedoor(GROMO-597)를 대체한다.
//
//   진입 → isGuest ? [게스트 안내]
//                  : getMyGroups() → 실패 [에러+재시도] / 빈 배열 [빈 상태] / 1건 이상 <GroupRoomScreen/>
//
// 그룹 1개 전제(§0) — 응답이 여러 건이어도 groups[0]만 쓴다. 목록 화면은 만들지 않는다.
// 초대 링크로 들어온 경우엔 어느 분기 위에든 GroupInviteSheet를 덮어 띄운다(§6-6).

// 플로팅 탭바가 가리는 하단 여백(리그·홈 화면과 동일 기준)
const TAB_BAR_SPACE = 74;

export default function GroupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { isGuest } = useUser();

  const [groups, setGroups] = useState<GroupSummaryResponse[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  // ── 초대 링크 수신(§6-6) ──────────────────────────────────────────────
  // 시트는 라우트가 아니라 이 화면 위의 오버레이라, 링크 수신은 navigationRef의 모듈 버퍼 +
  // 리스너 계약으로 받는다(navigationRef.ts 상단 주석 참고).
  //  · 마운트 시 peekPendingInvite() — 콜드 스타트에서 화면보다 링크가 먼저 도착한 경우를 이어받는다.
  //    게스트가 링크로 들어와 로그인하면 앱 트리가 리마운트되는데, 버퍼가 남아 있어 같은 그룹으로 복귀한다.
  //  · 버퍼를 비우는 곳은 여기뿐 — 시트가 닫히거나(onClose) 참여가 끝났을 때(onJoined)만 clear.
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(() => peekPendingInvite());

  useEffect(() => {
    setGroupInviteListener((groupId) => {
      // 초대 시트와 찾기 시트는 상호 배타 — 둘 다 SheetShell이라 겹치면 딤이 2겹으로 포개진다.
      // 링크로 들어온 초대가 우선(사용자가 방금 밖에서 받은 맥락)이라 찾기 시트를 내린다.
      setFindOpen(false);
      setInviteGroupId(groupId);
    });
    return () => setGroupInviteListener(null);
  }, []);

  // 요청 시퀀스 — 포커스마다 조회가 나가므로 탭을 빠르게 오가면 이전 응답이 늦게 도착해
  // 최신 목록을 덮을 수 있다(생성/참여 직후 빈 상태로 되돌아 보이는 형태).
  // 최신 요청의 결과만 반영한다(useFriends.ts의 requestSeqRef와 같은 패턴).
  const requestSeqRef = useRef(0);

  // 내 그룹 조회. 게스트는 호출 전에 차단한다(서버도 403이지만 왕복을 아낀다 — §5-3).
  const fetchGroups = useCallback(async () => {
    if (isGuest) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(false);
    try {
      const rows = await getMyGroups();
      if (seq !== requestSeqRef.current) return;
      setGroups(rows);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setError(true);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [isGuest]);

  // 포커스마다 재조회 — 생성/참여 직후(스택 pop·시트 닫힘) 그룹방으로 즉시 전환된다. 진입 계측도 여기서.
  useFocusEffect(
    useCallback(() => {
      logGroupViewed();
      fetchGroups();
    }, [fetchGroups]),
  );

  const closeInvite = useCallback(() => {
    clearPendingInvite();
    setInviteGroupId(null);
  }, []);

  // 초대로 참여 완료 — 버퍼를 비우고 재조회해 그룹방으로 전환한다.
  const onInviteJoined = useCallback(() => {
    closeInvite();
    fetchGroups();
  }, [closeInvite, fetchGroups]);

  // 검색으로 참여 완료 — 시트를 닫고 재조회.
  const onFindJoined = useCallback(() => {
    setFindOpen(false);
    fetchGroups();
  }, [fetchGroups]);

  const inviteSheet = inviteGroupId ? (
    <GroupInviteSheet groupId={inviteGroupId} onClose={closeInvite} onJoined={onInviteJoined} />
  ) : null;

  // ── 게스트 — 호출 없이 로그인 유도(§5-3) ──
  if (isGuest) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        <View style={[s.body, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}>
          <CharacterImage size={140} />
          <Text style={s.title}>로그인하고 그룹을 시작해요</Text>
          <Text style={s.desc}>
            게스트는 그룹에 참여할 수 없어요.{'\n'}로그인하면 바로 쓸 수 있어요.
          </Text>
          <TouchableOpacity
            style={s.primaryBtn}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('SettingsAccount')}
          >
            <Text style={s.primaryText}>로그인하고 그룹 시작하기</Text>
          </TouchableOpacity>
        </View>
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 최초 로딩 — 중앙 스피너(§5-4). 재조회(포커스) 때는 기존 화면을 유지한다. ──
  if (groups === null && loading) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 에러 + 다시 시도 ──
  if (groups === null && error) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        <View style={[s.body, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}>
          <Text style={s.title}>그룹을 불러오지 못했어요</Text>
          <Text style={s.desc}>잠시 후 다시 시도해주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={() => fetchGroups()}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // 그룹 1개 전제 — 여러 건이 와도 첫 번째만 쓴다(§6-1).
  const myGroup = groups?.[0];

  // ── 그룹방 — 가입한 그룹이 있으면 이 화면 안에서 렌더한다(별도 라우트 아님, §6-4) ──
  if (myGroup) {
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        <GroupRoomScreen groupId={myGroup.groupId} summary={myGroup} onLeft={fetchGroups} />
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 빈 상태 ──
  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
      <View style={[s.body, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}>
        <CharacterImage size={140} />
        <Text style={s.title}>함께 집중할 그룹을 만들어보세요</Text>
        <Text style={s.desc}>그룹을 찾거나 직접 만들 수 있어요</Text>
        <TouchableOpacity
          style={s.primaryBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('GroupCreate')}
          testID="group.create.entry"
        >
          <Text style={s.primaryText}>그룹 만들기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.outlineBtn}
          activeOpacity={0.85}
          onPress={() => setFindOpen(true)}
          testID="group.find.entry"
        >
          <Text style={s.outlineText}>그룹 찾기</Text>
        </TouchableOpacity>
      </View>

      {findOpen && <GroupFindSheet onClose={() => setFindOpen(false)} onJoined={onFindJoined} />}
      {inviteSheet}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // 탭 화면은 흰 캔버스 — 홈·리그·전체와 같은 배경이라야 탭 전환에서 배경이 튀지 않는다.
  // (그룹의 스택 화면 GroupCreate·GroupNotice는 FriendAdd·알림과 같은 T.bg를 유지한다.)
  root: { flex: 1, backgroundColor: T.paperLight },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: T.space.xxl,
  },
  title: { ...T.text.title, color: T.ink, marginTop: T.space.xl, textAlign: 'center' },
  desc: {
    ...T.text.body,
    color: T.inkSub,
    marginTop: T.space.sm,
    marginBottom: T.space.xxl,
    textAlign: 'center',
  },
  // 화면 CTA = 52 / r16 (그룹 3화면 공통 규격 — 시트 CTA와도 반경이 맞는다)
  primaryBtn: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  primaryText: { ...T.text.subtitle, color: T.white },
  outlineBtn: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },
  outlineText: { ...T.text.subtitle, color: T.ink },

  // 인라인 재시도 = 48 / r16 / px xxl — 그룹방·공지 화면과 같은 값을 쓴다(§G-4).
  // 화면 CTA(52/stretch)와 구분해 "조회 실패 복구"라는 역할을 규격으로 드러낸다.
  retryBtn: {
    height: 48,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },
});
