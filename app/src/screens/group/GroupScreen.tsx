import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
import GroupListScreen from './GroupListScreen';
import GroupRoomScreen from './GroupRoomScreen';
import GroupFindSheet from './components/GroupFindSheet';
import GroupInviteSheet from './components/GroupInviteSheet';

// 그룹 탭 진입점 — 명세 docs/app/group-plan.md §6-1 + 2차 docs/app/group-plan-2.md §0·§3-1.
// Fakedoor(GROMO-597)를 대체한다.
//
//   진입 → isGuest ? [게스트 안내]
//                  : getMyGroups() → 실패 [에러+재시도]
//                                  / 0건            [빈 상태]
//                                  / 1건            <GroupRoomScreen/> (내장 렌더 — 기존 UX 유지)
//                                  / 2건 이상·showList <GroupListScreen/>
//
// 멀티 그룹은 2차에 열렸지만 **1그룹 사용자에게 탭을 하나 더 시키지 않는다**(2차 §0-1) —
// 그래서 목록은 2건 이상일 때만 기본 화면이 되고, 1건일 땐 그룹방 ⋯ 메뉴의 '내 그룹 목록'
// (onShowGroups)으로 showList를 세워야 볼 수 있다.
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
  // 그룹이 1건이어도 목록을 볼 수 있게 하는 장치(2차 §0-3) — 그룹방 ⋯ 메뉴의 '내 그룹 목록'이 세운다.
  // 2건 이상이면 목록이 기본 화면이라 이 값과 무관하다.
  const [showList, setShowList] = useState(false);
  // mutation(생성·참여) 직후의 전이 중인가 — 성공한 mutation을 후속 GET 실패가 삼키지 않게 한다.
  // 전이 중에는 기존 빈 상태를 그대로 렌더하지 않고 로딩/에러+재시도를 세운다.
  // (그러지 않으면 생성 성공 → GET 실패 시 다시 '그룹 만들기' 빈 화면이 떠 같은 그룹을 또 만든다.)
  const [transitioning, setTransitioning] = useState(false);

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

  // 게스트 → 로그인 전환에서 초대 이어받기.
  // 위 useState 초기화는 **마운트 1회**라 앱 트리가 리마운트될 때만 버퍼를 다시 읽는다. 그런데
  // App.tsx의 applyStoredSession은 로그인 전후 userId가 같은 경우(게스트 계정에 소셜 provider를
  // 연결)를 따로 분기하고, 그때는 <UserProvider key={userId}>가 그대로라 리마운트가 없다.
  // isGuest는 prop 파생이라 리마운트 없이 갱신되지만 버퍼를 다시 읽을 계기가 없어 초대가 조용히
  // 증발한다 — 전환 자체를 감지해 이어받는다(리마운트 경로에선 전환이 안 잡혀 무해).
  const wasGuestRef = useRef(isGuest);
  useEffect(() => {
    const wasGuest = wasGuestRef.current;
    wasGuestRef.current = isGuest;
    if (!wasGuest || isGuest) return;
    const pending = peekPendingInvite();
    if (pending) setInviteGroupId(pending);
  }, [isGuest]);

  // 요청 시퀀스 — 포커스마다 조회가 나가므로 탭을 빠르게 오가면 이전 응답이 늦게 도착해
  // 최신 목록을 덮을 수 있다(생성/참여 직후 빈 상태로 되돌아 보이는 형태).
  // 최신 요청의 결과만 반영한다(useFriends.ts의 requestSeqRef와 같은 패턴).
  const requestSeqRef = useRef(0);

  // 초대 링크가 가리킨 그룹방 — 참여(또는 '이미 멤버') 판정 뒤 재조회가 끝날 때까지 목적지를 들고 있는다.
  // 재조회 결과가 2건 이상이면 기본 화면이 목록이라, 이 값을 잃으면 초대 링크가 '목록 열기'로 전락한다.
  const pendingRoomIdRef = useRef<string | null>(null);

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
      // 최신 목록을 받은 시점에만 전이가 끝난다 — 실패 때 풀면 빈 상태로 되돌아간다.
      setTransitioning(false);
    } catch {
      if (seq !== requestSeqRef.current) return;
      setError(true);
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [isGuest]);

  // mutation 성공 직후의 재조회 — 결과가 올 때까지(또는 실패가 확정될 때까지) 빈 상태를 렌더하지 않는다.
  const fetchAfterMutation = useCallback(() => {
    setTransitioning(true);
    fetchGroups();
  }, [fetchGroups]);

  // 포커스마다 재조회 — 생성/참여 직후(스택 pop·시트 닫힘) 그룹방으로 즉시 전환된다. 진입 계측도 여기서.
  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다 — 화면을 떠난 뒤 setState가 도는 것을 막는다.
  useFocusEffect(
    useCallback(() => {
      logGroupViewed();
      fetchGroups();
      return () => {
        requestSeqRef.current++;
      };
    }, [fetchGroups]),
  );

  const closeInvite = useCallback(() => {
    clearPendingInvite();
    setInviteGroupId(null);
  }, []);

  // 게스트 초대 → 로그인 유도(§6-6). **시트만 내리고 초대 버퍼는 남긴다** —
  // 로그인하면 앱 트리가 리마운트되고 peekPendingInvite()가 같은 그룹 프리뷰를 다시 띄운다.
  // clearPendingInvite를 부르는 closeInvite와 절대 혼용하지 않는다(버퍼를 지우면 초대가 증발한다).
  // 시트를 내리는 이유는 RN 네이티브 Modal이라 계정 화면 위에 그대로 남아 로그인 버튼을 가리기 때문이다.
  const onInviteLogin = useCallback(() => {
    setInviteGroupId(null);
    navigation.navigate('SettingsAccount');
  }, [navigation]);

  // 초대로 참여 완료 — 버퍼를 비우고 재조회해 **그 초대장이 가리킨** 그룹방으로 전환한다.
  // ⚠️ 목적지를 ref로 옮긴 뒤에 버퍼를 비운다. 그러지 않으면 이미 두 그룹 이상인 사용자가
  //    초대 링크를 열었을 때(참여 성공·이미 멤버 모두 이 콜백을 탄다) 재조회 후 목록만 떠서
  //    링크가 가리킨 방으로 못 간다 — 목적지 소비는 아래 useEffect가 맡는다.
  // ⚠️ 목적지는 현재 inviteGroupId가 아니라 **시트가 알려준 실제 가입 그룹**이다. 참여 요청이 떠 있는
  //    동안 두 번째 초대 링크가 도착하면 시트의 groupId(=inviteGroupId)만 갈리는데, 시트는 성공을
  //    세대와 무관하게 통지한다(가입은 실제로 일어났으므로). 여기서 inviteGroupId를 쓰면 가입한 A 대신
  //    나중에 온 B로 가려다, B가 아직 내 목록에 없어 아무 방도 열지 못한다.
  const onInviteJoined = useCallback(
    (joinedGroupId: string) => {
      pendingRoomIdRef.current = joinedGroupId;
      closeInvite();
      fetchAfterMutation();
    },
    [closeInvite, fetchAfterMutation],
  );

  // 초대 목적지 소비 — 목록을 새로 받은 시점에만 판정한다(참여 직후 목록엔 그 그룹이 들어 있다).
  //  · 2건 이상: 기본 화면이 목록이므로 그룹방을 push 한다(목록 카드 탭과 같은 분기)
  //  · 1건 이하: 내장 그룹방이 곧 그 그룹이라 push 하지 않고 열려 있던 목록만 접는다
  // 목록에 목적지가 없으면(참여가 실제로 반영되지 않음) 아무 데도 보내지 않고 소비만 한다 —
  // 남겨 두면 이후 아무 재조회에서나 뒤늦게 튀어 나간다.
  useEffect(() => {
    const target = pendingRoomIdRef.current;
    if (target === null || groups === null) return;
    pendingRoomIdRef.current = null;
    if (!groups.some((g) => g.groupId === target)) return;
    if (groups.length > 1) navigation.navigate('GroupRoom', { groupId: target });
    else setShowList(false);
  }, [groups, navigation]);

  // 검색으로 참여 완료 — 시트를 닫고 재조회.
  const onFindJoined = useCallback(() => {
    setFindOpen(false);
    fetchAfterMutation();
  }, [fetchAfterMutation]);

  // 그룹 나가기 성공 — 재조회를 기다리지 않고 즉시 빈 상태로 되돌린다.
  // (재조회만 믿으면 GET 실패 시 이미 나간 그룹방이 그대로 남는다.)
  // showList도 함께 내린다 — 마지막 그룹을 나간 뒤 다시 만들었을 때 빈 목록 요청이 남아 있으면
  // 새 그룹의 그룹방 대신 1건짜리 목록이 뜬다.
  const onLeft = useCallback(() => {
    setGroups([]);
    setError(false);
    setTransitioning(false);
    setShowList(false);
    fetchGroups();
  }, [fetchGroups]);

  // 목록에서 그룹을 골랐다 — 진입 경로가 둘이라 여기서 분기한다(목록 화면은 navigate 하지 않는다).
  //  · 1건: 목록은 '잠깐 열어 본' 상태일 뿐이라 내장 그룹방으로 되돌린다(push 하면 같은 방이 겹친다)
  //  · 2건 이상: 목록이 기본 화면이므로 그룹방을 스택에 push 한다
  const onSelectGroup = useCallback(
    (groupId: string) => {
      if ((groups?.length ?? 0) <= 1) {
        setShowList(false);
        return;
      }
      navigation.navigate('GroupRoom', { groupId });
    },
    [groups, navigation],
  );

  // 찾기 시트의 '참여 중' 행 탭 — 참여가 아니라 이동이라 목록 카드 탭과 같은 분기를 그대로 탄다.
  // (시트가 자체 판정을 갖고 있던 시절엔 1건+목록 상태에서 목록으로 되돌아오는 사각이 있었다 —
  //  분기를 여기 하나로 모아 showList 처리까지 한 곳에서 끝낸다.)
  const onOpenGroup = useCallback(
    (groupId: string) => {
      setFindOpen(false);
      onSelectGroup(groupId);
    },
    [onSelectGroup],
  );

  // 그룹 만들기 진입 — 돌아왔을 때의 포커스 재조회를 전이로 취급한다.
  // 만들지 않고 돌아온 경우에도 손해는 없다(조회에 성공하면 그대로 빈 상태로 떨어진다).
  const openCreate = useCallback(() => {
    setTransitioning(true);
    navigation.navigate('GroupCreate');
  }, [navigation]);

  const myGroups = groups ?? [];

  // 1건에서 '잠깐 열어 본' 목록은 스택 라우트가 아니라 이 화면의 로컬 상태(showList)라,
  // 헤더 백버튼만으론 Android 시스템 뒤로가기를 받을 수 없다 — 그대로 두면 탭 네비게이터의
  // 기본 동작을 타 다른 탭으로 가거나 앱을 빠져나가고, 방금 떠난 내장 그룹방으로 못 돌아온다.
  // 이 목록이 떠 있는 동안만 이벤트를 소비한다(iOS에선 no-op). 2건 이상의 기본 목록은
  // 탭의 첫 화면이라 되돌아갈 곳이 없으므로 손대지 않는다 — 헤더 백버튼 조건과 같은 기준이다.
  const tempListOpen = showList && myGroups.length === 1;
  useEffect(() => {
    if (!tempListOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowList(false);
      return true;
    });
    return () => sub.remove();
  }, [tempListOpen]);

  // 찾기 시트는 빈 상태·목록 두 분기에서 함께 쓴다 — 어느 쪽에서 열어도 같은 시트다.
  // 소속 판정 기준(groups)은 여기서 내려준다 — 시트가 따로 조회하면 부모와 스냅샷이 갈린다.
  const findSheet = findOpen ? (
    <GroupFindSheet
      groups={myGroups}
      onClose={() => setFindOpen(false)}
      onJoined={onFindJoined}
      onOpenGroup={onOpenGroup}
    />
  ) : null;

  const inviteSheet = inviteGroupId ? (
    <GroupInviteSheet
      groupId={inviteGroupId}
      onClose={closeInvite}
      onJoined={onInviteJoined}
      onLogin={onInviteLogin}
    />
  ) : null;

  // 기존 데이터가 있는 재조회 실패 — 화면을 갈아엎지 않고 인라인 배너로 알린다.
  // 무음으로 두면 방금 만든/참여한 그룹이 없는 화면을 보고 같은 동작을 반복하게 된다.
  const staleNotice =
    error && !transitioning && groups !== null ? (
      <View style={s.banner}>
        <Text style={s.bannerText}>목록을 새로고침하지 못했어요</Text>
        <TouchableOpacity onPress={() => fetchGroups()} hitSlop={12} activeOpacity={0.7}>
          <Text style={s.bannerRetry}>다시 시도</Text>
        </TouchableOpacity>
      </View>
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

  // ── 최초 로딩 — 중앙 스피너(§5-4). 목록을 한 번이라도 받았으면 절대 갈아끼우지 않는다. ──
  // 전이(생성 화면 왕복·참여 직후)도 여기서 제외한다: 만들지 않고 그냥 돌아와도 보고 있던
  // 그룹방/목록이 통째로 스피너로 바뀌어 화면이 깜빡였다. 그룹방(GroupRoomScreen)의
  // 'loading && !detail' 정책과 같은 기준으로 맞춘다.
  // transitioning의 원래 목적(성공한 mutation을 후속 GET 실패가 삼키는 것 방지)은
  // 아래 **에러 가드**에 그대로 남아 있어 지켜진다.
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

  // ── 에러 + 다시 시도 — 목록을 한 번도 못 받았거나, mutation 전이가 실패로 끝난 경우 ──
  if ((groups === null || transitioning) && error) {
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

  // ── 그룹방(1건) — 이 화면 안에서 렌더한다(별도 라우트 아님, §6-4). 목록 진입점을 함께 넘긴다 ──
  // 0건 판정을 먼저 하므로 여기 오면 [0]은 반드시 있다. showList면 아래 목록으로 떨어진다.
  if (myGroups.length === 1 && !showList) {
    const myGroup = myGroups[0];
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        {staleNotice}
        {/* inviteOpen — 초대 시트가 뜨면 그룹방의 '⋯' 메뉴를 내린다(둘 다 asModal이라 딤이 겹친다). */}
        <GroupRoomScreen
          groupId={myGroup.groupId}
          summary={myGroup}
          onLeft={onLeft}
          inviteOpen={!!inviteGroupId}
          onShowGroups={() => setShowList(true)}
        />
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 목록(2건 이상 또는 1건에서 '내 그룹 목록'을 연 경우) ──
  if (myGroups.length > 0) {
    // 1건에서 '잠깐 열어 본' 목록은 되돌아갈 길이 카드 탭뿐이었다 — 그 경우에만 헤더 백버튼을
    // 준다(스택 화면 관행과 같은 규격). 2건 이상의 기본 목록은 탭의 첫 화면이라 백버튼이 없다.
    const backToRoom = showList && myGroups.length <= 1 ? () => setShowList(false) : undefined;
    return (
      <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
        {staleNotice}
        <GroupListScreen
          groups={myGroups}
          onSelect={onSelectGroup}
          onCreate={openCreate}
          onFind={() => setFindOpen(true)}
          onRefresh={fetchGroups}
          onBack={backToRoom}
        />
        {findSheet}
        {inviteSheet}
      </SafeAreaView>
    );
  }

  // ── 빈 상태 ──
  return (
    <SafeAreaView style={s.root} edges={['top']} testID="group.screen">
      {staleNotice}
      <View style={[s.body, { paddingBottom: insets.bottom + TAB_BAR_SPACE }]}>
        <CharacterImage size={140} />
        <Text style={s.title}>함께 집중할 그룹을 만들어보세요</Text>
        <Text style={s.desc}>그룹을 찾거나 직접 만들 수 있어요</Text>
        <TouchableOpacity
          style={s.primaryBtn}
          activeOpacity={0.85}
          onPress={openCreate}
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

      {findSheet}
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

  // 재조회 실패 인라인 배너 — 문구는 그룹 화면 공통 s.notice 규격(caption/dangerInk),
  // 재시도 링크는 '모두보기'와 같은 accent 링크 규격을 쓴다(§G-4).
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
  },
  bannerText: { ...T.text.caption, color: T.dangerInk },
  bannerRetry: { ...T.text.caption, color: T.accent },
});
