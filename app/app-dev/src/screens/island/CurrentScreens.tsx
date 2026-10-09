import { VisitorBoard } from '@/screens/island/VisitorBoard';
import { sessionGeneration } from '@/services/api/session';
import { hasBundledAudio } from '@/constants/audio';
import { componentTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import { findReachableTutorialSpot } from '@/services/tutorial';
import {
  isTutorialExperience,
  tutorialExperienceScene,
  tutorialExperienceAction,
} from '@/services/tutorialExperience';
import { syncAndroidScreenTime } from '@/services/screentimeSync';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  AppState,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  State,
  Building,
  Color,
  Route,
  displayIsland as currentIsland,
  viewIsland,
  serverHome,
  canVisit,
  buildingNames,
  costs,
  buildMinutes,
  balance,
  buildingShare,
  earnedBy,
  collectedBy,
  isHost,
  sessionSeconds,
  dayKey,
  periodBounds,
  islandWeeklyAverage,
  hoursMinutes,
  questMemberRate,
  trackNames,
} from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { ApiError } from '@/services/api/client';
import { useBoardNotices } from '@/screens/interiors/useBoardNotices';
import { getSession } from '@/services/api/session';
import { catColor, useIslandPresence } from '@/screens/focus/useIslandPresence';
import { isGoldenFishParticipant, type GoldenFishEvent } from '@/services/islandRealtime';
import {
  fishingSpotsForActors,
  useFishingPeerActors,
  type FishingPeer,
} from '@/screens/focus/useFishingPeerActors';
import { GoldenFishCutscene } from '@/screens/focus/GoldenFishCutscene';
import { RestGroup } from '@/screens/focus/RestGroup';
import { Sailing } from '@/screens/world/WorldViews';
import {
  FiButton,
  FiModal,
  FishingActor,
  FishingIsland,
  FishingPeerActorView,
  FishingWalker,
  INK,
  a11yHidden,
  anchorCard,
  labelBox,
  nearGram,
  nearRaft,
  occupied,
  DEFAULT_CATCH_PLACEMENT,
  DEFAULT_SPOT,
  LANDING,
  OUTLINE,
  PEER_SPOTS,
  castSpot,
  fishingCatchPlacement,
  fishingPeerCatchVisible,
  fiCard,
  fiTitle,
  fishingGrid,
  hms,
} from '@/screens/focus/FishingIsland';
import { Text, TextInput } from '@/design-system/typography';
import { Point, landPath, onLand } from '@/utils/world-grid';
import { RedesignScreens } from '@/screens/island/Screens';
import { FinalIsland } from '@/screens/island/WorldMap';
import {
  GuideBox,
  TutorialScene,
  useScreenReaderEnabled,
  TutorialSpotlight,
  useSpotlightTarget,
} from '@/screens/island/NpcGuide';
import { useBoardHomeIndicator } from '@/screens/island/useBoardHomeIndicator';
import { CatSprite } from '@/components/CatSprite';
import { HOME_QUEST_LIST_DETAIL, pendingQuestRewards } from '@/screens/island/HomeQuestIndicator';
import {
  art,
  C,
  k,
  Txt,
  Pic,
  Btn,
  Badge,
  Group,
  Row,
  Seg,
  Field,
  Strip,
  Toggle,
  Overlay,
} from '@/design-system/patterns';
import { IslandSheet, IslandPopup } from '@/screens/island/IslandSheet';
import { InteriorRoute } from '@/screens/interiors/BuildingInteriors';
import { Library } from '@/screens/island/Library';
import { Hall } from '@/screens/island/Hall';
import { useFriendsScreen, type FriendsScreenState } from '@/screens/island/useFriendsScreen';
import { BlockedUsersScreen } from '@/screens/island/BlockedUsersScreen';
import {
  isScreenTimeAvailable,
  screenTime,
  ScreenTimeAuthorization,
  ScreenTimeSelection,
  selectionCount,
} from '@/services/screenTime';

// 임시 검수 전용: 인증·서버를 쓰지 않는 데모에서 집중마다 황금 물고기를 확정 재생한다.
const GOLDEN_TEST =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo') &&
  new URLSearchParams(window.location.search).has('golden-test');

const afterForegroundMs = (callback: () => void, durationMs: number) => {
  let remainingMs = durationMs;
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const isForeground = (state: string | null) => state !== 'background' && state !== 'inactive';
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (startedAt !== null) {
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
      startedAt = null;
    }
  };
  const start = () => {
    if (stopped || timer || startedAt !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      startedAt = null;
      stopped = true;
      subscription.remove();
      callback();
    }, remainingMs);
  };
  const subscription = AppState.addEventListener('change', (state) => {
    if (isForeground(state)) start();
    else clear();
  });
  if (isForeground(AppState.currentState)) start();
  return () => {
    if (stopped) return;
    stopped = true;
    clear();
    subscription.remove();
  };
};

const buildingArt: Record<Building, string> = {
  hall: 'hall',
  board: 'notice-board',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
};
const date = (at: number) =>
  new Date(at).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  });
function Close({ onPress }: { onPress: () => void }) {
  return <Btn small title="×" kind="glass" onPress={onPress} />;
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Txt kind="meta" style={{ paddingVertical: 24, textAlign: 'center' }}>
      {children}
    </Txt>
  );
}
function Sheet({
  e,
  title,
  bg = 'dock',
  sign = 'boat/raft',
  children,
  footer,
  action,
  actionPress,
  tall = true,
  onClose,
  onBack,
}: any) {
  return (
    <IslandSheet
      bg={bg}
      sign={sign}
      title={title}
      tall={tall}
      onBack={onBack ?? e.back}
      onClose={onClose ?? e.home}
      action={action}
      actionPress={actionPress}
      footer={footer}
    >
      {children}
    </IslandSheet>
  );
}

export function CurrentScreens({ e }: any) {
  const friendsRouteActive = e.route === 'friends' || e.route === 'friendSearch';
  const friendsSafetyRouteActive = friendsRouteActive || e.route === 'boat';
  const serverIslands = e.islands;
  const dispatch = e.dispatch;
  const friendsScreen = useFriendsScreen({
    // 공용 소비자(뗏목 배지·우체통)가 첫 진입부터 서버 친구를 쓰도록 화면 route와 무관하게 적재한다.
    active: !!serverIslands,
    // 친구 화면과 요청 배지를 노출하는 뗏목 진입은, 공용 소비자가 계속 활성이어도
    // 차단 목록을 다시 검증하는 freshness boundary다.
    routeActive: friendsSafetyRouteActive,
    routeKey: friendsSafetyRouteActive ? e.route : null,
    searchActive: friendsRouteActive,
    date: dayKey(e.now),
  });
  useEffect(() => {
    if (!serverIslands) return;
    const friends = friendsSnapshotForSync(friendsScreen.data);
    // 차단 목록 재검증 중 data=null은 공개 보류이지 관계 삭제가 아니다. 빈 snapshot을
    // reducer에 넣으면 기존 친구의 로컬 편지 기록까지 영구 삭제되므로 보존한다.
    if (friends) dispatch({ type: 'FRIENDS_SYNC', friends });
  }, [dispatch, friendsScreen.data, serverIslands]);

  return <CurrentScreensContent e={{ ...e, friendsScreen }} />;
}

export function friendsSnapshotForSync(data: FriendsScreenState['data']) {
  if (!data) return null;
  const toFriend = (
    userId: string,
    nickname: string | null,
    islandName: string | null | undefined,
    status: 'friend' | 'received' | 'sent',
  ) => ({
    id: userId,
    name: nickname ?? '탈퇴한 사용자',
    color: 'white' as Color,
    island: islandName ?? '',
    status,
    messages: [],
  });
  return [
    ...data.friends.map((friend) =>
      toFriend(friend.userId, friend.nickname, friend.mainIslandName, 'friend'),
    ),
    ...data.friendRequests.map((request) =>
      toFriend(request.userId, request.nickname, null, 'received'),
    ),
    ...data.sentFriendRequests.map((request) =>
      toFriend(request.userId, request.nickname, null, 'sent'),
    ),
  ];
}

// 주민 화면 가드 판정(GROMO-2138). 서버 모드는 로컬 목업 섬 대신 서버 current 로 소속을,
// 스냅샷의 완공 건물로 잠금을 본다. 미조회는 undefined로 유지해 아래 진입 가드가 기다리게 한다.
// 방문자는 현재 섬 주민 여부를 이어받지 않고 공개 읽기 API로 완공 여부를 확인한다.
export function memberGate(state: State, server: boolean) {
  if (!server) {
    const i = currentIsland(state);
    return { joined: i.joined, built: viewIsland(state).buildings, host: isHost(i) };
  }
  const facts = state.visitingIslandId ? null : serverHome(state);
  const visit = state.serverIslands?.visit;
  return {
    joined: !state.visitingIslandId && state.serverIslands?.currentIslandId != null,
    built: state.visitingIslandId
      ? visit?.island.id === state.visitingIslandId
        ? (visit.buildings ?? undefined)
        : undefined
      : facts?.completedBuildings,
    host: facts?.home.island.role === 'host',
  };
}
function CurrentScreensContent({ e }: any) {
  const state: State = e.state,
    i = currentIsland(state),
    r: Route = e.route;
  const [boardReadVersion, setBoardReadVersion] = useState(0);
  const boardBuilt = memberGate(state, !!e.islands).built;
  const boardStatus = useBoardHomeIndicator({
    active:
      !!e.islands &&
      !state.visitingIslandId &&
      !!boardBuilt?.includes('board') &&
      ['home', 'board', 'notice'].includes(r),
    ownerId: getSession()?.userId ?? null,
    islandId: state.serverIslands?.currentIslandId ?? i.id,
    markRead: ['board', 'notice'].includes(r),
    readVersion: boardReadVersion,
  });
  const rewardIslandId = r === 'quest' && e.detail === HOME_QUEST_LIST_DETAIL ? i.id : undefined;
  const rewardModalOpen =
    !state.visitingIslandId && pendingQuestRewards(state.rewards, rewardIslandId).length > 0;
  const screenE = {
    ...e,
    boardStatus,
    onBoardCommentRead: () => setBoardReadVersion((version) => version + 1),
  };
  const memberRoutes: Route[] = [
    'home',
    'guide',
    'focusVisit',
    'focusTravel',
    'fishingArrival',
    'focusSetup',
    'focus',
    'rest',
    'focusResult',
    'returnTravel',
    'hall',
    'manage',
    'members',
    'ledger',
    'construction',
    'board',
    'notice',
    'noticeEdit',
    'quest',
    'questEdit',
    'tower',
    'explore',
    'library',
    'diary',
    'stats',
    'mail',
    'chat',
    'friendMail',
    'shop',
    'product',
    'orders',
    'sound',
  ];
  const { joined, built, host } = memberGate(state, !!e.islands);
  const endServerVisit = () => {
    e.dispatch({ type: 'END_VISIT' });
    e.reset(state.serverIslands?.currentIslandId ? 'home' : 'chooseIsland');
  };
  const visitMap = () => e.replace('visitIsland', state.visitingIslandId);
  const closeFacility = e.islands && state.visitingIslandId ? visitMap : e.home;
  if (!joined && !state.visitingIslandId && memberRoutes.includes(r))
    return (
      <Overlay close={() => e.reset('chooseIsland')}>
        <Txt kind="h17">가입한 섬이 없어요</Txt>
        <Txt kind="meta">섬을 선택하거나 새로 만든 뒤 이용할 수 있어요.</Txt>
        <Btn title="첫 섬 선택으로" onPress={() => e.reset('chooseIsland')} />
      </Overlay>
    );
  // 구경 중에는 구경하는 섬의 홈·회관 정보·게시판 열람과 돌아가는 배만 연다(허용 목록).
  // 나머지는 내 섬 화면이 섞이거나 섬 상태가 꼬이지 않게 모두 막는다
  if (
    state.visitingIslandId &&
    !(
      e.islands
        ? ['visitIsland', 'manage', 'members', 'board', 'notice', 'visitIslandFocus']
        : [
            'home',
            'manage',
            'members',
            'board',
            'notice',
            'quest',
            'travel',
            'visitIsland',
            'visitIslandFocus',
            'permission',
            'screenTimeApps',
          ]
    ).includes(r)
  )
    return (
      <Overlay
        close={closeFacility}
        background={
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        }
      >
        <Txt kind="h17">주민만 이용할 수 있어요</Txt>
        <Btn title="확인" onPress={closeFacility} />
      </Overlay>
    );
  if (e.islands && state.visitingIslandId && !built)
    return (
      <Overlay close={endServerVisit}>
        <Txt>섬 모습을 불러오지 못했어요. 다시 방문해 주세요.</Txt>
        <Btn title="원래 섬으로" onPress={endServerVisit} />
      </Overlay>
    );
  const locked: Partial<Record<Route, Building>> = {
    library: 'library',
    diary: 'library',
    stats: 'library',
    hall: 'hall',
    manage: 'hall',
    members: 'hall',
    ledger: 'hall',
    construction: 'hall',
    board: 'board',
    quest: 'board',
    questEdit: 'board',
    notice: 'board',
    noticeEdit: 'board',
    tower: 'tower',
    explore: 'tower',
    mail: 'mail',
    chat: 'mail',
    friendMail: 'mail',
    shop: 'shop',
    product: 'shop',
    orders: 'shop',
    sound: 'gram',
  };
  const required = locked[r];
  if (required && e.islands && !state.visitingIslandId && !serverHome(state))
    return (
      <Overlay close={e.home}>
        <Txt>{e.homeError ? '시설 정보를 불러오지 못했어요' : '시설 정보를 확인하고 있어요.'}</Txt>
        {e.homeError && <Btn title="다시 시도" onPress={e.retryHome} />}
      </Overlay>
    );
  if (required && built && !built.includes(required))
    return (
      <Overlay
        close={closeFacility}
        background={
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        }
      >
        <Pic id={`bld/${buildingArt[required]}`} w={100} />
        <Txt kind="h17">{t('home.lock.missing', { building: buildingNames[required] })}</Txt>
        <Txt kind="meta">
          {required === 'library' ? t('home.lock.libraryLocked') : t('home.lock.lockedGeneric')}
        </Txt>
        <Btn
          title={host && built.includes('hall') ? t('home.lock.viewNext') : t('common.ok')}
          onPress={() => (host && built.includes('hall') ? e.go('construction') : closeFacility())}
        />
      </Overlay>
    );
  if (e.islands && state.visitingIslandId && ['board', 'notice'].includes(r)) {
    const islandId = state.visitingIslandId;
    return (
      <VisitorBoard
        key={islandId}
        islandId={islandId}
        backOverride={e.backOverride}
        onClose={visitMap}
      />
    );
  }
  if (r === 'visit') return <Visit e={e} />;
  if (['arrival', 'travel'].includes(r)) return <Travel e={e} />;
  if (r === 'focusVisit') return <FocusVisit e={e} />;
  if (r === 'visitIsland')
    return <VisitIsland e={screenE} onReturnFromVisit={e.islands ? endServerVisit : undefined} />;
  if (r === 'visitIslandFocus')
    return (
      <FocusVisit
        e={e}
        islandId={e.detail || state.visitingIslandId}
        onBack={e.islands ? visitMap : e.back}
      />
    );
  if (
    [
      'focusTravel',
      'fishingArrival',
      'focusSetup',
      'focus',
      'focusResult',
      'returnTravel',
      'rest',
    ].includes(r)
  )
    return <FocusFlow e={e} />;
  if (['library', 'diary', 'stats'].includes(r)) return <Library e={e} />;
  if (['hall', 'manage', 'members', 'ledger', 'construction'].includes(r))
    return (
      <Hall
        key={r}
        e={e.islands && state.visitingIslandId ? { ...e, back: visitMap, home: visitMap } : e}
      />
    );
  // 게시판·우체통은 건물 안 장면(BuildingInteriors)으로 그린다
  if (['board', 'notice', 'noticeEdit', 'quest', 'questEdit'].includes(r))
    return (
      <>
        <InteriorRoute e={screenE} modalAboveBoard={rewardModalOpen} />
        {/* 보상은 내 섬 퀘스트 몫이라 구경 중에는 띄우지 않는다 */}
        {!state.visitingIslandId && <RewardModal e={e} rewardIslandId={rewardIslandId} />}
      </>
    );
  if (['mail', 'chat', 'friendMail'].includes(r)) return <InteriorRoute e={e} />;
  if (['tower', 'explore'].includes(r)) return <Tower e={e} />;
  if (['boat', 'mainIsland', 'currentIsland', 'friends', 'friendSearch'].includes(r))
    return <Social e={e} />;
  if (['shop', 'product', 'orders', 'sound'].includes(r)) return <ShopMusic e={e} />;
  if (r === 'permission')
    return e.detail === 'settings' ? (
      <AppPermissionManager e={e} />
    ) : (
      <ScreenTimePermission e={e} />
    );
  if (r === 'screenTimeApps') return <MeasuredAppPicker e={e} />;
  if (r === 'blockedUsers' && e.islands) return <BlockedUsersScreen e={e} />;
  return <RedesignScreens e={screenE} />;
}

function AppPermissionManager({ e }: any) {
  const [status, setStatus] = useState<ScreenTimeAuthorization | 'loading'>('loading');
  const [selection, setSelection] = useState<ScreenTimeSelection | null>(null);
  const [selectionStatus, setSelectionStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const unavailable = Platform.OS !== 'ios' || !isScreenTimeAvailable || status === 'unavailable';
  const approved = status === 'approved';
  const selectedCount = selectionCount(selection);
  const selectionDescription =
    selectionStatus === 'loading'
      ? '선택 상태 확인 중'
      : selectionStatus === 'error'
        ? '선택 상태를 확인하지 못했어요'
        : selectedCount
          ? `${selectedCount}개 선택됨`
          : '아직 선택하지 않았어요';
  const permissionDescription = approved ? '허용됨' : unavailable ? '사용 불가' : '허용 필요';

  useEffect(() => {
    let active = true;
    const syncPermissionState = () => {
      screenTime
        .getAuthorizationStatus()
        .then((nextStatus) => {
          if (!active) return;
          setStatus(nextStatus);
          e.dispatch({ type: 'SETTING', key: 'permission', value: nextStatus === 'approved' });
        })
        .catch(() => active && setStatus('unavailable'));
      setSelectionStatus('loading');
      screenTime
        .getMeasurementSelectionCounts()
        .then((nextSelection) => {
          if (!active) return;
          setSelection(nextSelection);
          setSelectionStatus('ready');
        })
        .catch(() => active && setSelectionStatus('error'));
    };
    syncPermissionState();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') syncPermissionState();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const requestConnection = async () => {
    if (approved) return true;
    if (unavailable) {
      e.notify('이 기기에서는 스크린타임을 연결할 수 없어요.');
      return false;
    }
    setBusy(true);
    try {
      await screenTime.requestAuthorization();
      const nextStatus = await screenTime.getAuthorizationStatus();
      setStatus(nextStatus);
      e.dispatch({ type: 'SETTING', key: 'permission', value: nextStatus === 'approved' });
      if (nextStatus !== 'approved') e.notify('iOS 설정에서 스크린타임 권한을 허용해 주세요.');
      return nextStatus === 'approved';
    } catch {
      e.notify('스크린타임 권한을 요청하지 못했어요.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeConnection = async (next: boolean) => {
    if (next) {
      await requestConnection();
      return;
    }
    // Family Controls 권한은 앱에서 직접 철회할 수 없어 시스템 설정으로 보낸다.
    await openSystemSettings();
  };

  const openSystemSettings = async () => {
    if (Platform.OS !== 'ios' || typeof Linking.openSettings !== 'function') return;
    await Linking.openSettings();
  };

  const openMeasuredApps = async () => {
    if (!(approved || (await requestConnection()))) return;
    e.go('screenTimeApps', 'settings');
  };

  return (
    <Sheet e={e} title="앱 권한 관리">
      <Txt kind="section">스크린타임</Txt>
      <Group>
        <Row
          title="스크린타임 연결"
          sub="폰 사용 퀘스트와 기록에 사용해요"
          tail={
            <Toggle
              label="스크린타임 연결"
              value={approved}
              disabled={busy || status === 'loading' || unavailable}
              onChange={changeConnection}
            />
          }
        />
        <Row
          title="측정 앱"
          sub={selectionDescription}
          accessibilityLabel={`측정 앱, ${selectionDescription}`}
          chevron
          onPress={openMeasuredApps}
        />
      </Group>
      <Txt kind="meta">연결을 끄면 폰 사용 퀘스트 달성률은 “확인 필요”로 표시돼요.</Txt>
      <Txt kind="section">시스템 설정</Txt>
      <Group>
        <Row
          title="측정 권한"
          sub={
            Platform.OS === 'ios' ? 'iOS 설정 › 스크린타임에서 변경' : 'iOS에서만 변경할 수 있어요'
          }
          accessibilityLabel={`측정 권한, ${permissionDescription}`}
          right={<Badge soft>{permissionDescription}</Badge>}
          chevron
          disabled={Platform.OS !== 'ios'}
          onPress={openSystemSettings}
        />
      </Group>
      <Txt kind="meta">권한이 없으면 기록을 0분으로 처리하지 않고 확인이 필요한 상태로 남겨요.</Txt>
    </Sheet>
  );
}

function ScreenTimePermission({ e }: any) {
  const [status, setStatus] = useState<ScreenTimeAuthorization | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const gateParts = String(e.detail).split('|');
  const boardFirst = gateParts[0] === 'board-first';
  const gateRoute = (gateParts[1] || 'board') as Route;
  const gateDetail = decodeURIComponent(gateParts[2] || '');
  const measuredApps = e.detail === 'measured-apps';
  const finish = () => {
    if (Platform.OS === 'android') {
      e.back();
      return;
    }
    if (boardFirst) {
      e.replace('screenTimeApps', e.detail);
    } else if (measuredApps) {
      e.replace('screenTimeApps', 'settings');
    } else {
      e.back();
    }
  };
  const skip = () => {
    if (boardFirst) {
      e.dispatch({ type: 'SETTING', key: 'screenTimeBoardPromptSeen', value: true });
      e.replace(gateRoute, gateDetail);
    } else {
      e.back();
    }
  };
  const syncStatus = async () => {
    const generation = sessionGeneration();
    const next = await screenTime.getAuthorizationStatus();
    if (generation !== sessionGeneration()) return 'unavailable';
    setStatus(next);
    e.dispatch({ type: 'SETTING', key: 'permission', value: next === 'approved' });
    if (Platform.OS === 'android') {
      e.dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
      const snapshot = await syncAndroidScreenTime();
      if (generation !== sessionGeneration()) return 'unavailable';
      e.dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot, now: Date.now() });
      setStatus(snapshot.approved ? 'approved' : next === 'approved' ? 'denied' : next);
      return snapshot.approved ? 'approved' : next === 'approved' ? 'denied' : next;
    }
    return next;
  };
  useEffect(() => {
    let active = true;
    screenTime
      .getAuthorizationStatus()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        e.dispatch({ type: 'SETTING', key: 'permission', value: next === 'approved' });
        if (boardFirst && next === 'approved') finish();
      })
      .catch(() => active && setStatus('unavailable'));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      syncStatus()
        .then((next) => {
          if (next === 'approved' && boardFirst) finish();
        })
        .catch(() => {});
    });
    return () => subscription.remove();
  }, []);
  const request = async () => {
    setBusy(true);
    try {
      await screenTime.requestAuthorization();
      const next = await syncStatus();
      if (next === 'approved') finish();
    } catch {
      e.notify('스크린타임 권한을 요청하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };
  if (status === 'loading')
    return (
      <Sheet
        e={e}
        title="측정 권한"
        onBack={boardFirst ? skip : undefined}
        onClose={boardFirst ? skip : undefined}
      >
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={C.ink} />
        </View>
      </Sheet>
    );
  const unavailable = !isScreenTimeAvailable || status === 'unavailable';
  return (
    <Sheet
      e={e}
      title="측정 권한"
      onBack={boardFirst ? skip : undefined}
      onClose={boardFirst ? skip : undefined}
    >
      <Pic id="cat/black/sitting" w={82} />
      <Txt kind="h17">사용 시간을 정확히 기록할게요</Txt>
      <Txt>
        {Platform.OS === 'android'
          ? '설정의 사용 정보 접근에서 GROMO를 허용해 주세요. 앱별 사용 기록으로 전체 사용 시간을 계산해요. 화면 내용은 읽지 않으며 다른 앱을 잠그지 않아요.'
          : 'GROMO가 선택한 앱의 사용 시간만 확인할 수 있도록 스크린타임 권한이 필요해요. 어떤 앱을 썼는지나 화면 내용은 볼 수 없어요.'}
      </Txt>
      <Group flat>
        <Row
          title="스크린타임 권한"
          sub={
            unavailable
              ? '이 기기에서는 사용할 수 없어요'
              : status === 'approved'
                ? '연결됨'
                : status === 'denied'
                  ? '설정에서 권한을 허용해 주세요'
                  : '아직 연결하지 않았어요'
          }
        />
      </Group>
      {Platform.OS === 'android' && status === 'approved' && (
        <Btn
          title="사용 정보 접근 설정 열기"
          kind="sec"
          onPress={async () => {
            if (!(await screenTime.openUsageAccessSettings()))
              e.notify('사용 정보 접근 설정을 열지 못했어요.');
          }}
        />
      )}
      {status === 'approved' ? (
        <Btn
          title={boardFirst ? '측정 앱 고르기' : measuredApps ? '계속' : '완료'}
          onPress={finish}
        />
      ) : status === 'denied' ? (
        <>
          <Btn
            title={Platform.OS === 'android' ? '사용 정보 접근 설정 열기' : 'iOS 설정 열기'}
            disabled={busy}
            onPress={Platform.OS === 'android' ? request : () => Linking.openSettings()}
          />
          <Btn
            title={boardFirst ? '나중에 하고 게시판 열기' : '나중에'}
            kind="ghost"
            onPress={skip}
          />
        </>
      ) : unavailable ? (
        <Btn title={boardFirst ? '게시판 열기' : '확인'} onPress={skip} />
      ) : (
        <>
          <Btn
            title={busy ? '권한 요청 중…' : '스크린타임 연결하기'}
            disabled={busy}
            onPress={request}
          />
          {boardFirst && <Btn title="나중에 하고 게시판 열기" kind="ghost" onPress={skip} />}
        </>
      )}
      <Txt kind="meta">권한이 없으면 폰 사용 퀘스트는 0분이 아니라 “확인 필요”로 표시돼요.</Txt>
    </Sheet>
  );
}

function MeasuredAppPicker({ e }: any) {
  const [selection, setSelection] = useState<ScreenTimeSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const pickerInFlight = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gateParts = String(e.detail).split('|');
  const boardFirst = gateParts[0] === 'board-first';
  const gateRoute = (gateParts[1] || 'board') as Route;
  const gateDetail = decodeURIComponent(gateParts[2] || '');
  const finish = () => {
    if (boardFirst) {
      e.dispatch({ type: 'SETTING', key: 'screenTimeBoardPromptSeen', value: true });
      e.replace(gateRoute, gateDetail);
    } else {
      e.back();
    }
  };
  const openPicker = async () => {
    if (pickerInFlight.current) return;
    pickerInFlight.current = true;
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    setBusy(true);
    try {
      const active = await screenTime.getMeasurementSelectionCounts();
      setSelection(active);
      const picked = await screenTime.presentAppPicker();
      if (!picked) {
        if (boardFirst) finish();
        return;
      }
      const count = selectionCount(picked);
      if (picked.appliesImmediately) {
        const activated = await screenTime.promoteSelection();
        if (!activated) throw new Error('measurement selection activation failed');
        const unconfirmedDays = await screenTime.getUnconfirmedUsageBucketDays();
        e.dispatch({ type: 'SCREEN_TIME_UNCONFIRMED', days: unconfirmedDays });
        const minutes = await screenTime.getTodayUsageBucketMinutes();
        e.dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: true });
        e.dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
        e.dispatch({ type: 'SCREEN_TIME', value: minutes });
        e.notify(`측정 앱 ${count}개를 바로 적용했어요.`);
      } else {
        e.notify(`측정 앱 ${count}개를 내일부터 적용해요.`);
      }
      setSelection(picked);
      finish();
    } catch {
      e.notify('측정 앱 선택 화면을 열지 못했어요.');
    } finally {
      pickerInFlight.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    screenTime
      .getMeasurementSelectionCounts()
      .then(setSelection)
      .catch(() => {});
    if (!boardFirst) return;
    autoTimer.current = setTimeout(openPicker, 450);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, []);
  return (
    <Sheet
      e={e}
      title="측정 앱"
      onBack={boardFirst ? finish : undefined}
      onClose={boardFirst ? finish : undefined}
    >
      <Pic id="cat/black/sitting" w={82} />
      <Txt kind="h17">줄이고 싶은 앱을 골라주세요</Txt>
      <Txt>
        선택한 앱과 카테고리의 사용 시간을 15분 단위로 기록해요. 앱 이름은 Apple 선택 화면 안에서만
        보여요.
      </Txt>
      <Group flat>
        <Row
          title="현재 측정 대상"
          sub={selectionCount(selection) ? `${selectionCount(selection)}개 선택됨` : '아직 없음'}
        />
        <Row
          title="변경 적용"
          sub={selectionCount(selection) ? '기존 대상 변경은 다음 날부터' : '최초 선택은 바로'}
        />
      </Group>
      <Btn
        title={busy ? '선택 화면 여는 중…' : '측정 앱 고르기'}
        disabled={busy}
        onPress={openPicker}
      />
      {boardFirst && <Btn title="나중에 하고 게시판 열기" kind="ghost" onPress={finish} />}
      <Txt kind="meta">
        선택을 바꾸는 날에는 기존 앱 기준 기록을 유지하고, 자정부터 새 대상을 측정해요.
      </Txt>
    </Sheet>
  );
}
// 섬 구경 · 전망대 · 상점 · 축음기 · 내 뗏목(친구·꾸미기)은 v2 시트 구현(Screens.tsx)이 그린다
function Visit({ e }: any) {
  return <RedesignScreens e={e} />;
}
function Travel({ e }: any) {
  const s: State = e.state;
  const first = e.route === 'arrival';
  const target = first
    ? currentIsland(s)
    : (s.islands.find((j) => j.id === (e.detail || e.visited)) ?? currentIsland(s));
  return (
    <Sailing
      state={s}
      from={first ? t('focusFlow.common.myLittleBoat') : (s.travelOrigin ?? currentIsland(s).name)}
      destination={target.name}
      duration={1900}
      onArrive={() => {
        if (first) {
          e.setGuideStep(0);
          e.replace('guide');
        } else if (target.joined) {
          e.dispatch({ type: 'SWITCH_ISLAND', id: target.id });
          e.home();
        } else if (canVisit(s, target.id)) {
          // 기존 방문자 권한(회관 정보·게시판 열람)을 유지한 채 읽기 전용 메인 섬 경로로 연다.
          e.dispatch({ type: 'VISIT', id: target.id });
          e.replace('visitIsland', target.id);
        } else e.replace('visit', target.id);
      }}
    />
  );
}
function VisitIsland({ e, onReturnFromVisit }: any) {
  const s: State = e.state,
    islandId = e.detail || s.visitingIslandId;
  return (
    <FinalIsland
      state={s}
      go={e.go}
      build={e.build}
      boardStatus={e.boardStatus}
      viewingIslandId={s.visitingIslandId ? undefined : islandId}
      notify={e.notify}
      dispatch={e.dispatch}
      onReturnFromVisit={onReturnFromVisit}
    />
  );
}
function FocusVisit({ e, islandId, onBack }: any) {
  const s: State = e.state,
    i = s.islands.find((island) => island.id === islandId) ?? currentIsland(s),
    L = useAppLayout(),
    safe = useSafeAreaInsets(),
    reduce = s.settings.reduceMotion,
    close = onBack ?? e.home,
    visiting = !!islandId;
  // GROMO-2010 — 서버 모드에서는 대상 섬의 실시간 집중 멤버가 정본이다.
  // 방문 관전은 serverIslands.visit 의 섬, 내 낚시섬 관전은 현재 섬. 목업·로컬 방문은 기존 로컬 경로.
  const liveIslandId = e.islands
    ? islandId
      ? (s.serverIslands?.visit?.island.id ?? null)
      : (s.serverIslands?.currentIslandId ?? null)
    : null;
  const transitionHandler = useRef<(transition: any) => void>(() => {});
  const live = useIslandPresence({
    active: liveIslandId !== null,
    islandId: liveIslandId,
    onTransition: (transition) => transitionHandler.current(transition),
  });
  const myId = getSession()?.userId;
  const peerMembers: FishingPeer[] = liveIslandId
    ? live.focus
        .filter((m) => m.userId !== myId)
        .map((m) => ({
          userId: m.userId,
          sessionId: m.sessionId,
          name: m.name ?? '주민',
          color: catColor(m.catColor),
          subject: m.subject,
          seconds:
            m.activeSeconds +
            (m.status === 'active'
              ? Math.max(0, Math.floor((e.now + live.clockOffset - m.anchorMs) / 1000))
              : 0),
          status: m.status,
        }))
    : (i.members ?? [])
        .filter((member) => member.focusing)
        .map((member: any) => ({
          userId: member.id,
          sessionId: member.sessionId ?? member.id,
          name: member.name ?? '주민',
          color: member.color,
          subject: member.subject ?? null,
          seconds: member.seconds ?? 0,
          status: 'active' as const,
        }));
  const peerFlow = useFishingPeerActors({
    members: peerMembers,
    ready: liveIslandId ? live.status === 'ready' : true,
    reduce,
    realtime: liveIslandId !== null,
    snapshotVersion: live.snapshotVersion,
    snapshotTransitions: live.snapshotTransitions,
  });
  transitionHandler.current = peerFlow.onTransition;
  const peers = peerFlow.actors.filter((actor) => actor.visible);
  const spots = fishingSpotsForActors(peerFlow.actors);
  return (
    <View style={{ flex: 1 }}>
      <FishingIsland
        focus={{ x: 50, y: 50 }}
        spots={spots}
        onRaft={close}
        raftLabel={visiting ? t('focusFlow.common.raftLabelVisiting') : undefined}
        gram={i.buildings.includes('gram')}
      >
        {(size, sizeY, zoom) => {
          const shown = new Set<string>(),
            kept: ReturnType<typeof labelBox>[] = [];
          if (zoom >= 1)
            peers
              .map((actor) => ({
                id: actor.key,
                spot: actor.spot,
                subject: actor.subject ?? '',
              }))
              .sort((a, b) => b.spot.y - a.spot.y)
              .forEach((label) => {
                const box = labelBox(label.spot, label.subject, size, sizeY);
                if (
                  kept.some(
                    (other) =>
                      !(
                        other.right <= box.left ||
                        box.right <= other.left ||
                        other.bottom <= box.top ||
                        box.bottom <= other.top
                      ),
                  )
                )
                  return;
                kept.push(box);
                shown.add(label.id);
              });
          return peers.map((actor) => (
            <FishingPeerActorView
              key={actor.key}
              actor={{ ...actor, subject: shown.has(actor.key) ? actor.subject : null }}
              size={size}
              sizeY={sizeY}
              reduce={reduce}
              onEntered={peerFlow.entered}
              onCast={peerFlow.cast}
              onPausedExit={peerFlow.leftForPause}
              onStretch={peerFlow.stretched}
              onCompletedExit={peerFlow.leftForComplete}
            />
          ));
        }}
      </FishingIsland>
      <View
        style={{
          position: 'absolute',
          zIndex: 30,
          top: L.landscape ? Math.max(14, safe.top + 8) : Math.max(64, safe.top + 12),
          left: Math.max(18, safe.left + 8),
        }}
      >
        <FiButton
          small
          title={visiting ? '돌아가기' : '닫기'}
          id="close-focus-visit"
          onPress={close}
        />
      </View>
      {liveIslandId && live.status === 'loading' ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <ActivityIndicator color={INK} />
        </View>
      ) : liveIslandId && live.status === 'error' ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <View
            style={{
              marginHorizontal: 24,
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 18,
              backgroundColor: '#FFFDFAD9',
              paddingVertical: 12,
              paddingHorizontal: 18,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 22.4, fontWeight: '800', color: INK }}>
              {live.error?.code === 'MEMBER_ONLY'
                ? '이 섬의 주민 상태를 볼 수 없어요'
                : '주민 상태를 불러오지 못했어요'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="다시 시도"
              onPress={live.retry}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 13, lineHeight: 20.8, fontWeight: '800', color: INK }}>
                다시 시도
              </Text>
            </Pressable>
          </View>
        </View>
      ) : !peers.length ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <View
            style={{
              marginHorizontal: 24,
              borderWidth: 2,
              borderColor: OUTLINE,
              borderRadius: 18,
              backgroundColor: '#FFFDFAD9',
              paddingVertical: 12,
              paddingHorizontal: 18,
            }}
          >
            <Text style={{ fontSize: 14, lineHeight: 22.4, fontWeight: '800', color: INK }}>
              지금 낚시 중인 주민이 없어요
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
function FocusFlow({ e: environment }: any) {
  const experience = isTutorialExperience(environment.state);
  // 화면 내부에서만 체험 세션을 투영한다. API·실시간·전역 집중 상태는 연결하지 않는다.
  const e = experience
    ? {
        ...environment,
        state: tutorialExperienceScene(environment.state),
        focus: undefined,
        islands: undefined,
        dispatch: (action: any) =>
          environment.dispatch({ ...action, type: tutorialExperienceAction(action.type) }),
        setGuideStep: (step: number, expected?: any) => {
          environment.setGuideStep(step, expected);
          if (step === 99) environment.home();
        },
      }
    : environment;
  const s: State = e.state,
    i = currentIsland(s),
    L = useAppLayout(),
    safe = useSafeAreaInsets(),
    r: Route = e.route,
    wide = L.width >= 600,
    reduce = s.settings.reduceMotion,
    tutorialStep: number = e.guideStep;
  const screenReader = useScreenReaderEnabled();
  const advanceTutorial = (from: number, to: number) => {
    if (tutorialStep === from)
      e.setGuideStep(to, { step: from, revision: s.tutorialRevision ?? 0 });
  };
  const setupInputTarget = useSpotlightTarget(tutorialStep === 7),
    setupStartTarget = useSpotlightTarget(tutorialStep === 8),
    pauseTarget = useSpotlightTarget(tutorialStep === 14),
    endTarget = useSpotlightTarget(tutorialStep === 17),
    confirmEndTarget = useSpotlightTarget(tutorialStep === 18),
    resultTarget = useSpotlightTarget(tutorialStep === 21);
  const [fan, setFan] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [dialog, setDialog] = useState<'music' | 'end' | 'endRest' | 'reward' | null>(null),
    [error, setError] = useState(''),
    [setupHeight, setSetupHeight] = useState(0),
    // 화면 높이 대신 실제 영역 높이(키보드가 뜨면 줄어듦)로 준비 카드 위치를 잡는다
    [boxHeight, setBoxHeight] = useState(0),
    [walker, setWalker] = useState({ p: LANDING, left: false, walking: false }),
    // 휴식 오가는 배 이동: 휴식 시간은 휴식하기를 누른 순간부터 흐르고, 집중은 낚시섬에 도착해야 다시 흐른다
    [voyage, setVoyage] = useState<'toRest' | 'toSpot' | null>(null),
    // 자리에서 뗏목까지 걸어가기(leave)·뗏목에서 자리로 걸어오기(comeback): 걷는 동안 버튼·모달 없음, 시간 안 흐름
    [leg, setLeg] = useState<'leave' | 'comeback' | null>(null),
    [goldenCutscene, setGoldenCutscene] = useState<GoldenFishEvent | null>(null),
    [goldenCatches, setGoldenCatches] = useState<
      Record<string, { count: number; eventId: string }>
    >({}),
    [goldenReeling, setGoldenReeling] = useState(false),
    [goldenFish, setGoldenFish] = useState(false),
    [tutorialReeling, setTutorialReeling] = useState(false),
    // 첫 물고기를 낚는 연출을 시작할 차례 — 황금 컷신·reel이 끝날 때까지 미룬다
    [tutorialCatchStart, setTutorialCatchStart] = useState<number | null>(null),
    // 첫 물고기 reel이 끝나 12단계로 갈 차례 — 황금 컷신·reel이 끝날 때까지 미룬다
    [tutorialCatchRevision, setTutorialCatchRevision] = useState<number | null>(null);
  const tutorialRequest = useRef<string | null>(null);
  const tutorialRetryAt = useRef(0);
  const tutorialReelCancel = useRef<(() => void) | null>(null);
  const tutorialReelRevision = useRef<number | null>(null);
  const tutorialMounted = useRef(true);
  useEffect(() => {
    tutorialMounted.current = true;
    return () => {
      tutorialMounted.current = false;
      tutorialReelCancel.current?.();
    };
  }, []);
  const walkingToken = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    position = useRef(LANDING),
    // 걷기·항해 콜백은 끝났을 때의 최신 화면·세션을 보고 계속할지 정한다(그 사이 집중이 끝났으면 중단)
    latest = useRef({ r, s, now: e.now }),
    backRef = useRef<() => boolean>(() => false),
    goldenHandler = useRef<(event: GoldenFishEvent) => void>(() => {}),
    goldenPresenter = useRef<(event: GoldenFishEvent) => void>(() => {}),
    goldenCutsceneRef = useRef<GoldenFishEvent | null>(null),
    goldenQueueRef = useRef<GoldenFishEvent[]>([]),
    goldenQueueTimerRef = useRef<(() => void) | null>(null),
    goldenPendingReelRef = useRef<GoldenFishEvent | null>(null),
    goldenDeferredNavigationRef = useRef<(() => void) | null>(null),
    goldenPendingSessionRef = useRef<GoldenFishEvent[]>([]),
    goldenAnnouncementPendingRef = useRef(false),
    goldenSeenRef = useRef(new Set<string>()),
    goldenTestSession = useRef<string | null>(null),
    // 내가 직접 finish()를 부른 동안은 그 응답이 오기 전에 같은 종료를 알리는 내 focus.member.updated
    // completed 브로드캐스트가 먼저 도착해도 강퇴로 오인하지 않는다.
    finishInFlightRef = useRef(false),
    // finish() 응답 전에 도착해 무시한 내 종료 이벤트 — finish()가 실패하면 그 이벤트를 뒤늦게 처리한다.
    suppressedEndRef = useRef(false),
    // 내가 종료를 요청한 세션 id — 응답이 끝난 뒤 늦게 도착하는 같은 세션의 완료 이벤트를 강퇴로 오인하지 않는다.
    endedByMeSessionIdRef = useRef<string | null>(null);
  latest.current = { r, s, now: e.now };
  // 서버 세션: 결과 카드의 퀘스트 지표·보상 수령은 서버 회차가 정본이다(GROMO-2014).
  // 목업(review/demo·비로그인)은 e.islands 가 없어 로컬 경로 그대로다.
  const serverQuests = !!e.islands && !s.visitingIslandId;
  const boardQ = useBoardNotices({
    active: serverQuests && r === 'focusResult',
    scopeKey: `focusQuests:${s.serverIslands?.currentIslandId ?? i.id}`,
  });
  // GROMO-2010 — 서버 모드에서는 같은 섬 주민의 실시간 집중/휴식·응원이 정본이다.
  // 응원 채널은 내 진행 서버 세션이 이 섬에 있을 때만 구독·발신한다(없으면 서버가 거절한다).
  const liveIslandId = e.islands ? (s.serverIslands?.currentIslandId ?? null) : null;
  const emoteSessionId =
    liveIslandId && s.session?.version != null && s.session.islandId === liveIslandId
      ? s.session.id
      : null;
  const myId = getSession()?.userId;
  const actorUserId = myId ?? (GOLDEN_TEST ? 'demo-me' : undefined);
  const transitionHandler = useRef<(transition: any) => void>(() => {});
  const live = useIslandPresence({
    active: liveIslandId !== null,
    islandId: liveIslandId,
    emoteSessionId,
    onSendError: e.notify,
    onTransition: (transition) => transitionHandler.current(transition),
    onGoldenFish: (event) => goldenHandler.current(event),
  });
  const resultSessionId = r === 'focusResult' ? (s.lastResult?.id ?? null) : null;
  const goldenSessionId = s.session?.id ?? resultSessionId;
  const recordGoldenCatch = (event: GoldenFishEvent) => {
    setGoldenCatches((current) => {
      const next = { ...current };
      for (const member of event.members) {
        const key = `${member.userId}:${member.sessionId}`;
        next[key] = {
          count: (current[key]?.count ?? 0) + 1,
          eventId: event.eventId,
        };
      }
      return next;
    });
  };
  const startGoldenReelTimer = () => {
    setGoldenReeling(true);
    goldenQueueTimerRef.current = afterForegroundMs(() => {
      setGoldenReeling(false);
      goldenQueueTimerRef.current = null;
      const next = goldenQueueRef.current.shift() ?? null;
      goldenCutsceneRef.current = next;
      if (next) {
        setGoldenReeling(false);
        setGoldenFish(false);
        setGoldenCutscene(next);
      } else {
        const navigate = goldenDeferredNavigationRef.current;
        goldenDeferredNavigationRef.current = null;
        navigate?.();
      }
    }, 2000);
  };
  const announceGoldenCatch = () => {
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
      goldenAnnouncementPendingRef.current = true;
      return;
    }
    goldenAnnouncementPendingRef.current = false;
    AccessibilityInfo.announceForAccessibility(t('focusFlow.fish.goldenCaughtA11y'));
  };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !goldenAnnouncementPendingRef.current) return;
      goldenAnnouncementPendingRef.current = false;
      AccessibilityInfo.announceForAccessibility(t('focusFlow.fish.goldenCaughtA11y'));
    });
    return () => subscription.remove();
  }, []);
  goldenPresenter.current = (event) => {
    if (reduce) {
      setGoldenReeling(false);
      recordGoldenCatch(event);
      setGoldenFish(true);
      announceGoldenCatch();
      return;
    }
    setGoldenFish(false);
    setGoldenReeling(false);
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      goldenQueueRef.current.push(event);
      return;
    }
    goldenCutsceneRef.current = event;
    setGoldenCutscene(event);
  };
  goldenHandler.current = (event) => {
    if (experience) return;
    const current = latest.current;
    const participantSessionId =
      current.s.session?.id ?? (current.r === 'focusResult' ? current.s.lastResult?.id : undefined);
    if (
      current.r === 'focusSetup' &&
      myId &&
      event.members.some((member) => member.userId === myId)
    ) {
      if (goldenSeenRef.current.has(event.eventId)) return;
      goldenSeenRef.current.add(event.eventId);
      goldenPendingSessionRef.current.push(event);
      return;
    }
    if (
      !participantSessionId ||
      !isGoldenFishParticipant(event, myId, participantSessionId) ||
      (current.r !== 'focus' && current.r !== 'rest' && current.r !== 'focusResult')
    )
      return;
    if (goldenSeenRef.current.has(event.eventId)) return;
    goldenSeenRef.current.add(event.eventId);
    if (goldenSeenRef.current.size > 200)
      goldenSeenRef.current.delete(goldenSeenRef.current.values().next().value!);
    if (current.r === 'rest') {
      goldenQueueRef.current.push(event);
      return;
    }
    goldenPresenter.current(event);
  };
  useEffect(() => {
    if (!goldenSessionId || (r !== 'focus' && r !== 'rest' && r !== 'focusResult')) return;
    const pending = goldenPendingSessionRef.current;
    goldenPendingSessionRef.current = [];
    for (const event of pending) {
      if (!isGoldenFishParticipant(event, myId, goldenSessionId)) continue;
      if (r === 'rest') goldenQueueRef.current.push(event);
      else goldenPresenter.current(event);
    }
  }, [goldenSessionId, r, myId]);
  const goldenFor = (userId: string | null | undefined, sessionId: string | null | undefined) =>
    userId && sessionId ? goldenCatches[`${userId}:${sessionId}`] : undefined;
  const activeFocusCount = live.focus.filter((member) => member.status === 'active').length;
  useEffect(() => {
    if (!liveIslandId || !s.session) return;
    e.onPresenceCounts?.(
      s.session.id,
      liveIslandId,
      live.status === 'ready'
        ? {
            focus: Math.max(activeFocusCount, s.session.status === 'active' ? 1 : 0),
            rest: Math.max(live.rest.length, s.session.status === 'paused' ? 1 : 0),
          }
        : null,
    );
  }, [
    liveIslandId,
    s.session?.id,
    s.session?.status,
    live.status,
    activeFocusCount,
    live.rest.length,
  ]);
  useEffect(
    () => () => {
      walkingToken.current++;
      if (timer.current) clearTimeout(timer.current);
      if (emoteTimer.current) clearTimeout(emoteTimer.current);
      goldenQueueTimerRef.current?.();
    },
    [],
  );
  // 안드로이드 뒤로가기는 App.back 보다 먼저 이 화면이 처리한다
  useEffect(() => {
    if (!e.backOverride) return;
    e.backOverride.current = () => backRef.current();
    return () => {
      e.backOverride.current = null;
    };
  }, [e.backOverride]);
  // 휴식·결과로 전환하는 순간의 당첨은 유지한다. 집중 흐름을 완전히 떠날 때만 지운다.
  useEffect(() => {
    setFan(false);
    setDialog(null);
    const inFocusFlow = r === 'focusSetup' || r === 'focus' || r === 'rest' || r === 'focusResult';
    if (!inFocusFlow) {
      setEmote(null);
      goldenCutsceneRef.current = null;
      goldenQueueRef.current = [];
      goldenQueueTimerRef.current?.();
      goldenQueueTimerRef.current = null;
      goldenPendingReelRef.current = null;
      goldenDeferredNavigationRef.current = null;
      goldenPendingSessionRef.current = [];
      goldenAnnouncementPendingRef.current = false;
      setGoldenCutscene(null);
      setGoldenReeling(false);
      setGoldenFish(false);
      return;
    }
    if (r !== 'rest' && !goldenCutsceneRef.current && !goldenQueueTimerRef.current) {
      if (reduce) {
        const pending = goldenQueueRef.current.splice(0);
        for (const event of pending) recordGoldenCatch(event);
        if (pending.length > 0) {
          setGoldenFish(true);
          announceGoldenCatch();
        }
      } else {
        const pending = goldenQueueRef.current.shift();
        if (pending) goldenPresenter.current(pending);
      }
    }
  }, [r, reduce]);
  // 걸어가는 동안 끝난 컷신은 배우가 다시 보인 뒤에 더미·reel을 반영한다.
  useEffect(() => {
    if (leg || !goldenPendingReelRef.current) return;
    const event = goldenPendingReelRef.current;
    goldenPendingReelRef.current = null;
    recordGoldenCatch(event);
    setGoldenFish(true);
    startGoldenReelTimer();
  }, [leg]);
  useEffect(() => {
    if (r !== 'focus' || tutorialStep !== 11 || s.session?.status !== 'active') return;
    if (sessionSeconds(s.session, e.now) < 5) return;
    const sessionId = s.session.id;
    const revision = s.tutorialRevision ?? 0;
    const key = `${sessionId}:${revision}`;
    if (tutorialRequest.current === key || e.now < tutorialRetryAt.current) return;
    tutorialRequest.current = key;
    const stillHere = () =>
      tutorialMounted.current &&
      latest.current.r === 'focus' &&
      latest.current.s.session?.id === sessionId &&
      latest.current.s.tutorial?.step === 11 &&
      (latest.current.s.tutorialRevision ?? 0) === revision;
    const showCatch = () => {
      if (stillHere()) setTutorialCatchStart(revision);
    };
    if (experience) {
      const claim = environment.focus?.tutorialExperienceReward;
      const islandId = s.session.islandId;
      const confirmed = () => {
        if (!stillHere()) return;
        environment.dispatch({ type: 'TUTORIAL_EXPERIENCE_REWARD', sessionId });
        showCatch();
      };
      if (!environment.focus) {
        confirmed();
        return;
      }
      claim(islandId)
        .then((reward: { status: string }) => {
          if (!stillHere()) return;
          if (reward.status === 'granted') confirmed();
          else e.setGuideStep(14, { step: 11, revision });
        })
        .catch((error: any) => {
          if (!stillHere()) return;
          tutorialRequest.current = null;
          tutorialRetryAt.current = latest.current.now + 5000;
          e.notify(errorTextOr(error, 'focusFlow.fish.rewardCheckFailed'));
        });
      return;
    }
    if (!e.focus) {
      if (s.records.length > 0) {
        e.setGuideStep(14, { step: 11, revision });
        return;
      }
      e.dispatch({ type: 'TUTORIAL_FISH' });
      showCatch();
      return;
    }
    e.focus
      .tutorialReward(sessionId)
      .then((reward: { status: string }) => {
        if (!stillHere()) return;
        if (reward.status === 'granted') showCatch();
        else if (reward.status === 'unavailable') e.setGuideStep(14, { step: 11, revision });
        else {
          tutorialRequest.current = null;
          tutorialRetryAt.current = e.now + 1000;
        }
      })
      .catch((error: any) => {
        if (!stillHere()) return;
        tutorialRequest.current = null;
        tutorialRetryAt.current = latest.current.now + 5000;
        e.notify(errorTextOr(error, 'focusFlow.fish.rewardCheckFailed'));
      });
  }, [
    e.focus,
    e.dispatch,
    e.setGuideStep,
    e.now,
    r,
    s.session,
    s.records.length,
    s.tutorialRevision,
    tutorialStep,
    reduce,
  ]);
  useEffect(() => {
    if (tutorialStep !== 11) {
      tutorialReelCancel.current?.();
      tutorialReelRevision.current = null;
      setTutorialReeling(false);
      setTutorialCatchStart(null);
      setTutorialCatchRevision(null);
    }
  }, [tutorialStep]);
  // 황금 컷신·reel이 장면을 덮는 동안에는 첫 물고기를 낚는 연출을 시작하지 않고, reel 도중에 덮이면
  // 타이머를 취소했다가 황금 연출이 모두 끝난 뒤 처음부터 다시 보여 준다.
  useEffect(() => {
    const goldenBusy = !!goldenCutscene || goldenReeling;
    if (goldenBusy && tutorialReelRevision.current !== null) {
      const revision = tutorialReelRevision.current;
      tutorialReelCancel.current?.();
      tutorialReelRevision.current = null;
      setTutorialReeling(false);
      setTutorialCatchStart(revision);
      return;
    }
    if (tutorialCatchStart === null || goldenBusy) return;
    const revision = tutorialCatchStart;
    setTutorialCatchStart(null);
    if (tutorialStep !== 11 || (s.tutorialRevision ?? 0) !== revision) return;
    const finishReel = () => {
      tutorialReelRevision.current = null;
      setTutorialReeling(false);
      setTutorialCatchRevision(revision);
    };
    if (reduce) finishReel();
    else {
      tutorialReelRevision.current = revision;
      setTutorialReeling(true);
      tutorialReelCancel.current = afterForegroundMs(finishReel, 2000);
    }
  }, [tutorialCatchStart, goldenCutscene, goldenReeling, reduce, tutorialStep, s.tutorialRevision]);
  // 황금 컷신·reel이 장면을 덮는 동안에는 첫 물고기 대사로 넘어가지 않는다.
  useEffect(() => {
    if (tutorialCatchRevision === null || goldenCutscene || goldenReeling) return;
    setTutorialCatchRevision(null);
    if (tutorialStep === 11 && (s.tutorialRevision ?? 0) === tutorialCatchRevision)
      e.setGuideStep(12, { step: 11, revision: tutorialCatchRevision });
  }, [tutorialCatchRevision, goldenCutscene, goldenReeling, tutorialStep, s.tutorialRevision]);
  // 서버 세션(version 있음)이면 명령이 정본이다 — 성공 응답이 SESSION_SYNC/RESULT 로 state를
  // 갈아 끼운 뒤에만 화면을 옮긴다. 없으면(REVIEW·DEMO 목업) 로컬 reducer 경로를 그대로 쓴다.
  const serverSession = () => e.focus && s.session?.version != null;
  // 서버가 내 집중 세션을 끝냈을 때(강퇴 등) 로컬 세션을 정리하고 화면을 빠져나간다.
  // 완료 이벤트는 정상 종료와 사유가 같아 강퇴로 단정하지 않는 문구를 쓴다.
  const leaveAfterServerEnd = () => {
    e.dispatch({ type: 'SESSION_SYNC', session: null });
    e.notify(t('focusFlow.hud.endedByServer'));
    e.home();
  };
  const finish = () => {
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      const requestedSessionId = s.session?.id;
      setDialog(null);
      goldenDeferredNavigationRef.current = () => {
        const current = latest.current;
        if (
          requestedSessionId &&
          current.s.session?.id === requestedSessionId &&
          (current.r === 'focus' || current.r === 'rest')
        )
          finish();
      };
      return;
    }
    if (serverSession()) {
      // 확인 버튼을 연달아 눌러도 종료 요청은 하나만 보낸다 — 진행 중 플래그를 공유하므로
      // 먼저 끝난 요청이 다른 요청의 플래그까지 내리지 않게 한다.
      if (finishInFlightRef.current) return;
      const session = s.session;
      endedByMeSessionIdRef.current = session?.id ?? null;
      finishInFlightRef.current = true;
      suppressedEndRef.current = false;
      e.focus
        .finish()
        .then(() => {
          advanceTutorial(18, 19);
          e.reset('focusResult');
        })
        .catch(async (error: any) => {
          if (await e.recoverExpiredRestConflict?.(error, session)) return;
          // 종료를 누른 사이 서버가 먼저 세션을 끝냈다면(무시했던 완료 이벤트) 그쪽으로 정리한다.
          if (suppressedEndRef.current) {
            leaveAfterServerEnd();
            return;
          }
          // 응답만 유실돼 서버는 종료를 반영했을 수 있다 — 표식을 풀어 뒤늦게 오는 완료 이벤트가
          // 무시되지 않고 종료 처리되게 한다.
          endedByMeSessionIdRef.current = null;
          e.notify(errorTextOr(error, 'focus.finishFailed'));
        })
        .finally(() => {
          finishInFlightRef.current = false;
          suppressedEndRef.current = false;
        });
      return;
    }
    e.dispatch({ type: 'FINISH' });
    advanceTutorial(18, 19);
    e.reset('focusResult');
  };
  // 내 자리: 옛 저장 좌표(지도 % 밖)는 도착 지점으로 대신한다
  const minePoint =
      s.focusSpot && s.focusSpot.x <= 100 && s.focusSpot.y <= 100 ? s.focusSpot : LANDING,
    mine = castSpot(minePoint);
  if (minePoint.x === DEFAULT_SPOT.x && minePoint.y === DEFAULT_SPOT.y)
    mine.catchPlacement = DEFAULT_CATCH_PLACEMENT;
  // 주민 자리: 서버 모드는 live 스냅숏+이벤트가 정본 — 로딩·실패면 로컬 멤버로 지어내지 않는다.
  const peerMembers: FishingPeer[] = liveIslandId
    ? live.focus
        .filter((m) => m.userId !== myId)
        .map((m) => ({
          userId: m.userId,
          sessionId: m.sessionId,
          name: m.name ?? t('focusFlow.common.resident'),
          color: catColor(m.catColor),
          subject: m.subject,
          seconds:
            m.activeSeconds +
            (m.status === 'active'
              ? Math.max(0, Math.floor((e.now + live.clockOffset - m.anchorMs) / 1000))
              : 0),
          status: m.status,
        }))
    : i.members
        .filter((m) => m.focusing)
        .map((m: any) => ({
          userId: m.id,
          sessionId: m.sessionId ?? m.id,
          name: m.name ?? t('focusFlow.common.resident'),
          color: m.color,
          subject: m.subject ?? null,
          seconds: m.seconds ?? 0,
          status: 'active' as const,
        }));
  useEffect(() => {
    const sessionId = s.session?.id;
    if (
      experience ||
      !GOLDEN_TEST ||
      r !== 'focus' ||
      !sessionId ||
      goldenTestSession.current === sessionId
    )
      return;
    const timeout = setTimeout(() => {
      const current = latest.current;
      if (current.r !== 'focus' || current.s.session?.id !== sessionId) return;
      goldenTestSession.current = sessionId;
      const members = [
        { userId: 'demo-me', sessionId },
        ...i.members
          .filter((member) => member.focusing)
          .map((member: any) => ({
            userId: member.id,
            sessionId: member.sessionId ?? member.id,
          })),
      ];
      goldenPresenter.current({
        eventId: `golden-test-${sessionId}`,
        islandId: i.id,
        drawnAt: new Date().toISOString(),
        reward: members.length,
        sharePerMember: 1,
        members,
      });
    }, 900);
    return () => clearTimeout(timeout);
  }, [experience, r, s.session?.id, i.id, i.members]);
  const peerFlow = useFishingPeerActors({
    members: peerMembers,
    ready: liveIslandId ? live.status === 'ready' : true,
    reduce,
    realtime: liveIslandId !== null,
    snapshotVersion: live.snapshotVersion,
    snapshotTransitions: live.snapshotTransitions,
  });
  transitionHandler.current = (transition) => {
    // 내 낚시 세션이 진행 중이던 중(previous.status === 'active') 서버가 강퇴 등으로
    // 세션을 강제 종료하면(focus.member.updated completed) focus/rest 이벤트만으로는
    // 타이머가 계속 흐른다 — 여기서 내 몫만 감지해 화면을 빠져나간다.
    // finishInFlightRef 는 내가 직접 finish()를 부른 뒤 아직 응답 전인 같은 사건과 구분한다.
    if (
      transition.kind === 'focus' &&
      transition.userId === myId &&
      transition.current === null &&
      transition.previous?.status === 'active' &&
      s.session
    ) {
      if (finishInFlightRef.current) {
        suppressedEndRef.current = true;
      } else if (transition.previous.sessionId !== endedByMeSessionIdRef.current) {
        leaveAfterServerEnd();
        return;
      }
    }
    peerFlow.onTransition(transition);
  };
  const peers = peerFlow.actors.filter((actor) => actor.visible),
    peerSpots = peerFlow.actors.map((actor) => actor.spot),
    peerCatchSpots = peerFlow.actors.filter(fishingPeerCatchVisible).map((actor) => actor.spot),
    fishingPeerSpots = fishingSpotsForActors(peerFlow.actors),
    emoteByUser = new Map(live.emotes.map((em) => [em.userId, em.type]));
  // 걷기: 땅 격자 경로를 따라 지도 폭 11%/초로 걷고, 걷는 중 다시 누르면 지금 위치에서 새 목적지로.
  const walkTo = (to: Point, done: () => void) => {
    const from = position.current,
      cells = landPath(fishingGrid, from, to);
    if (!cells.length) return false;
    let rest = [...cells.slice(1, -1), to],
      p = from,
      left = walker.left;
    const token = ++walkingToken.current;
    const step = () => {
      if (token !== walkingToken.current) return;
      let budget = reduce ? Infinity : 0.44;
      while (rest.length && budget > 0) {
        const q = rest[0],
          dx = q.x - p.x,
          d = Math.hypot(dx, q.y - p.y);
        if (Math.abs(dx) > 0.15) left = dx < 0;
        if (d <= budget) {
          p = q;
          rest = rest.slice(1);
          budget -= d;
        } else {
          p = { x: p.x + (dx / d) * budget, y: p.y + ((q.y - p.y) / d) * budget };
          budget = 0;
        }
      }
      position.current = p;
      setWalker({ p, left, walking: rest.length > 0 });
      if (rest.length) timer.current = setTimeout(step, 40);
      else done();
    };
    step();
    return true;
  };
  // 자리에서 일어나 뗏목까지 걸어간 뒤 next(휴식 항해·귀환 항해)
  const leaveTo = (next: () => void) => {
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      goldenDeferredNavigationRef.current = () => leaveTo(next);
      return;
    }
    position.current = mine;
    setLeg('leave');
    const arrive = () => {
      setLeg(null);
      if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
        goldenDeferredNavigationRef.current = next;
        return;
      }
      next();
    };
    if (!walkTo(LANDING, arrive)) arrive();
  };
  const pause = () => {
    // 첫 물고기 보상·reel을 기다리는 11단계에는 오버레이가 없다 — 이때 전환하면 12~14단계 안내가 누락된다.
    if (tutorialStep === 11) return;
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
      const requestedSessionId = s.session?.id;
      goldenDeferredNavigationRef.current = () => {
        if (
          requestedSessionId &&
          latest.current.r === 'focus' &&
          latest.current.s.session?.id === requestedSessionId
        )
          pause();
      };
      return;
    }
    // 휴식 시간은 누른 순간부터(뗏목까지 걷기·배 이동도 휴식).
    // 서버 세션은 pause 성공 뒤에만 휴식 연출을 시작한다(정책: 이동 연출은 성공 후).
    const go = () =>
      leaveTo(() => {
        setVoyage('toRest');
        const started = e.go('rest', '', () => setVoyage(null));
        if (started === false) setVoyage(null);
      });
    if (serverSession()) {
      e.focus
        .pause()
        .then(() => {
          // 15단계는 실제 rest 화면 도착 후 App의 복구 로직에서 연다.
          go();
        })
        .catch((error: any) => e.notify(errorTextOr(error, 'focusFlow.hud.pauseFailed')));
      return;
    }
    e.dispatch({ type: 'PAUSE' });
    go();
  };
  const result = s.lastResult,
    leave = () => {
      const navigate = () => {
        // 자동 종료 결과는 닫을 때 acknowledge — 확인 전까지 서버가 계속 돌려주므로 실패해도 잃지 않는다
        if (result?.ackId) e.focus?.acknowledge(result.ackId).catch(() => {});
        s.resultFromRest
          ? e.home()
          : leaveTo(() => latest.current.r === 'focusResult' && e.go('returnTravel'));
      };
      if (goldenCutsceneRef.current || goldenQueueTimerRef.current) {
        goldenDeferredNavigationRef.current = navigate;
        return;
      }
      navigate();
    },
    // 결과 다음에 새로 받은 보상이 있으면 보상받기 모달, 없으면 바로 섬으로.
    // 서버 경로는 회차 목록 로딩 중이거나 수령 가능한 퀘스트가 있으면 모달을 연다 —
    // 로딩이 끝났는데 받을 게 없으면 모달 스스로 닫힌다.
    done = () =>
      serverQuests
        ? boardQ.loading || boardQ.quests.some((q) => q.claimable)
          ? setDialog('reward')
          : leave()
        : s.rewards?.some((x) => !x.acknowledged)
          ? setDialog('reward')
          : leave(),
    claimed = (more: boolean) => {
      if (!more) leave();
    };
  const resume = () => {
    if (serverSession()) {
      const session = s.session;
      e.focus
        .resume()
        .then(() => {
          advanceTutorial(15, 16);
          setVoyage('toSpot');
        })
        .catch(async (error: any) => {
          if (await e.recoverExpiredRestConflict?.(error, session)) return;
          e.notify(errorTextOr(error, 'focus.resumeFailed'));
        });
      return;
    }
    advanceTutorial(15, 16);
    setVoyage('toSpot');
  };
  // 뒤로가기: 걷기·항해(낚시섬 오가기 포함) 중에는 막고, 모달은 닫기만, 결과는 '확인'(보상·귀환 흐름)과 같게, 모닥불은 '집중 이어가기'와 같게
  backRef.current = () => {
    if (tutorialStep >= 5 && tutorialStep <= 21) return true;
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) return true;
    if (leg || voyage || walker.walking || r === 'focusTravel' || r === 'returnTravel') return true;
    if (dialog === 'reward') {
      // 서버 수령은 명시적 버튼으로만 — 뒤로가기는 모달을 닫고 나간다
      // (남은 보상은 게시판 상세에서 받을 수 있다).
      if (serverQuests) {
        leave();
        return true;
      }
      const open = (s.rewards ?? []).filter((x) => !x.acknowledged);
      if (open[0]) e.dispatch({ type: 'CLAIM', id: open[0].id });
      claimed(open.length > 1);
      return true;
    }
    if (dialog) {
      setDialog(null);
      return true;
    }
    if (r === 'focusResult') {
      done();
      return true;
    }
    if (r === 'rest' && s.session) {
      resume();
      return true;
    }
    if (r === 'focus' && s.session) {
      setDialog('end');
      return true;
    }
    return false;
  };
  if (r === 'focusTravel')
    return (
      <Sailing
        state={s}
        from={t('focusFlow.common.ourIsland')}
        destination={t('focusFlow.common.fishingIsland')}
        duration={1900}
        onArrive={() => e.replace('fishingArrival')}
      />
    );
  if (r === 'returnTravel')
    return (
      <Sailing
        state={s}
        from={t('focusFlow.common.fishingIsland')}
        destination={t('focusFlow.common.ourIsland')}
        duration={1900}
        onArrive={e.home}
      />
    );
  if (r === 'rest' && voyage)
    return (
      <Sailing
        state={s}
        from={
          voyage === 'toRest'
            ? t('focusFlow.common.fishingIsland')
            : t('focusFlow.common.ourIsland')
        }
        destination={
          voyage === 'toRest'
            ? t('focusFlow.travel.restCampfire')
            : t('focusFlow.travel.fishingSpot')
        }
        duration={1900}
        onArrive={() => {
          setVoyage(null);
          if (voyage === 'toRest' || latest.current.r !== 'rest' || !latest.current.s.session)
            return;
          e.go('focus');
          position.current = LANDING;
          setLeg('comeback');
          const sit = () => {
            setLeg(null);
            // 서버 세션은 RESUME 을 로컬로 흉내 내지 않는다 — resume 명령 성공이 이미 status를 갱신했다
            const latestSession = latest.current.s.session;
            if (latestSession?.status === 'paused' && latestSession.version == null)
              e.dispatch({ type: 'RESUME' });
          };
          if (!walkTo(mine, sit)) sit();
        }}
      />
    );
  if (r === 'rest')
    return (
      <RestGroup
        state={s}
        live={liveIslandId ? live : null}
        home={e.home}
        resume={resume}
        endRest={finish}
        confirming={dialog === 'endRest'}
        setConfirming={(open) => setDialog(open ? 'endRest' : null)}
        tutorial={
          tutorialStep === 15
            ? {
                text: t('focusFlow.tutorial.step15'),
                onSkip: () => e.setGuideStep(99),
              }
            : undefined
        }
      />
    );
  // 정해진 자리 없음: 누른 땅까지 걸어가 앉고 그 자리 위에 집중 준비. 물·닿을 수 없는 곳·다른 주민 자리는 안 됨.
  const spotError = (p: Point): string | null => {
    if (!onLand(fishingGrid, p)) return t('focusFlow.spot.onWater');
    if (occupied(p, peerSpots)) return t('focusFlow.spot.occupied');
    if (i.buildings.includes('gram') && nearGram(p)) return t('focusFlow.spot.nearGram');
    if (nearRaft(p)) return t('focusFlow.spot.nearRaft');
    const catchSpot = castSpot(p);
    if (p.x === DEFAULT_SPOT.x && p.y === DEFAULT_SPOT.y)
      catchSpot.catchPlacement = DEFAULT_CATCH_PLACEMENT;
    if (
      !fishingCatchPlacement(
        catchSpot,
        peerSpots,
        peerCatchSpots,
        i.buildings.includes('gram'),
        PEER_SPOTS,
      )
    )
      return t('focusFlow.spot.noCatchRoom');
    return null;
  };
  const selectSpot = (p: Point) => {
    const error = spotError(p);
    if (error) {
      e.notify(error);
      return;
    }
    const walked = walkTo(p, () => {
      if (latest.current.r !== 'fishingArrival') return;
      e.dispatch({ type: 'FOCUS_SPOT', spot: p });
      advanceTutorial(5, 7);
      advanceTutorial(6, 7);
      e.go('focusSetup');
    });
    // 연못 가운데 섬처럼 뗏목 쪽 땅과 이어지지 않은 곳
    if (!walked) e.notify(t('focusFlow.spot.unreachable'));
  };
  const selectAccessibleSpot = () => {
    const spot = findReachableTutorialSpot(
      fishingGrid,
      walker.p,
      DEFAULT_SPOT,
      (p) => !spotError(p),
    );
    if (spot) selectSpot(spot);
    else e.notify(t('focusFlow.spot.noneFound'));
  };
  // 뗏목: 자리 고르기에서는 뗏목까지 걸어가 본인만 우리 섬으로, 집중 중에는 집중 종료 확인.
  const raft = () => {
    if (tutorialStep >= 5 && tutorialStep <= 21) return;
    if (r === 'fishingArrival') {
      const sail = () => latest.current.r === 'fishingArrival' && e.go('returnTravel');
      if (!walkTo(LANDING, sail)) sail();
    } else if (r === 'focus' && s.session && !leg) setDialog('end');
  };
  const start = () => {
    if (!e.text.trim()) {
      setError(t('focusFlow.setup.subjectRequired'));
      return;
    }
    if (!e.focus && !i.joined) {
      e.notify(t('focusFlow.setup.needsIsland'));
      e.replace('chooseIsland');
      return;
    }
    if (e.focus) {
      // 서버 세션 — islandId·멱등 키·복구는 명령이 챙긴다. 시작 성공 뒤에만 낚시 화면으로 간다
      setError('');
      e.focus
        .start({ subject: e.text.trim() })
        .then(() => {
          advanceTutorial(8, 9);
          e.go('focus');
        })
        .catch((error: any) => setError(errorTextOr(error, 'focusFlow.setup.startFailed')));
      return;
    }
    e.dispatch({ type: 'START', subject: e.text });
    advanceTutorial(8, 9);
    e.go('focus');
  };
  const finishInput = () => {
    if (!e.text.trim()) {
      setError(t('focusFlow.setup.subjectRequired'));
      return;
    }
    Keyboard.dismiss();
    e.setGuideStep(8);
  };
  const skipTutorial = () => e.setGuideStep(99);
  const openEnd = () => {
    if (tutorialStep === 11) return;
    if (tutorialStep === 17) e.setGuideStep(18);
    setDialog('end');
  };
  const cancelEnd = () => {
    setDialog(null);
    if (tutorialStep === 18) e.setGuideStep(17);
  };
  const finishResult = () => {
    if (tutorialStep === 21) e.setGuideStep(22);
    done();
  };
  // 결과창의 퀘스트는 집중을 마친 날 회차 기준(자정을 넘겨 봐도 그날 달성이 남는다)
  const resultAt = result?.at ?? e.now,
    resultDay = dayKey(resultAt),
    focusQuests = i.quests.filter((q) => q.type === 'focus'),
    achieved = focusQuests.filter((q) => q.rounds?.[resultDay]?.achieved.includes('me'));
  const resultModal = (
    <FiModal hidden={dialog === 'reward'}>
      <Text style={[fiTitle(wide ? 19 : 22), { marginBottom: 8 }]}>
        {t('focusFlow.result.title')}
      </Text>
      <Text style={{ fontSize: 19, lineHeight: 30.4, fontWeight: '900', color: INK }}>
        {result?.subject ?? t('focusFlow.result.defaultSubject')}
      </Text>
      <View style={{ gap: 8, marginVertical: wide ? 12 : 18 }}>
        <View
          style={{
            backgroundColor: C.paper,
            borderWidth: 2,
            borderColor: OUTLINE,
            borderRadius: 13,
            paddingTop: 10,
            paddingHorizontal: 8,
            paddingBottom: 8,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontSize: wide ? 32 : 42,
              lineHeight: (wide ? 32 : 42) * 1.1,
              fontWeight: '900',
              letterSpacing: -1.5,
              fontVariant: ['tabular-nums'],
              color: INK,
            }}
          >
            {hms(result?.seconds ?? 0)}
          </Text>
          <Text style={{ fontSize: 11, lineHeight: 22.4, color: INK }}>
            {t('focusFlow.result.durationLabel')}
          </Text>
        </View>
        <View
          style={{
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: 4,
            paddingHorizontal: 12,
            backgroundColor: C.butter,
            borderWidth: 2,
            borderColor: OUTLINE,
            borderRadius: 13,
          }}
        >
          <Image source={art.fish} style={{ width: 26, height: 26 }} />
          <Text style={{ fontSize: 15, lineHeight: 19.5, fontWeight: '900', color: INK }}>
            {t('focusFlow.result.fishCount', { count: result?.fish ?? 0 })}
          </Text>
        </View>
      </View>
      {/* 퀘스트가 여럿이거나 화면이 낮으면 카드(FiModal) 안에서 통째로 스크롤한다 */}
      <View
        style={{
          backgroundColor: C.paper,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 13,
          paddingVertical: 9,
          paddingHorizontal: 12,
        }}
      >
        <Text style={{ fontSize: 11, lineHeight: 17.6, fontWeight: '700', color: '#7C6857' }}>
          {t('focusFlow.result.questsAchievedTitle')}
        </Text>
        <Text style={{ fontSize: 13, lineHeight: 20.8, fontWeight: '800', color: INK }}>
          {serverQuests
            ? // 서버 회차 — 달성은 claimable·claimed 플래그가 정본이다(rate 추정 금지).
              boardQ.loading
              ? t('focusFlow.result.checking')
              : boardQ.error
                ? t('focusFlow.result.checkFailed')
                : boardQ.quests.filter((q) => q.claimable || q.claimed).length
                  ? boardQ.quests
                      .filter((q) => q.claimable || q.claimed)
                      .map((q) => '✓ ' + q.title)
                      .join('\n')
                  : boardQ.quests[0]
                    ? t('focusFlow.result.notYetServerRate', {
                        title: boardQ.quests[0].title,
                        rate:
                          boardQ.quests[0].myRate == null
                            ? t('focusFlow.result.notMeasuredYet')
                            : `${boardQ.quests[0].myRate}%`,
                      })
                    : t('focusFlow.result.notYet')
            : achieved.length
              ? achieved.map((q) => '✓ ' + q.title).join('\n')
              : focusQuests[0]
                ? t('focusFlow.result.notYetLocalRate', {
                    title: focusQuests[0].title,
                    current: Math.floor(
                      ((questMemberRate(s, focusQuests[0], 'me', i.id, resultAt) ?? 0) *
                        focusQuests[0].target) /
                        100,
                    ),
                    target: focusQuests[0].target,
                  })
                : t('focusFlow.result.notYet')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: wide ? 12 : 18 }}>
        <View
          ref={resultTarget.ref}
          collapsable={false}
          onLayout={resultTarget.measure}
          style={{ flex: 1 }}
        >
          <FiButton
            primary
            id="result-done"
            title={
              s.resultFromRest || tutorialStep === 21
                ? t('focusFlow.common.backToIsland')
                : t('focusFlow.result.backByBoat')
            }
            onPress={finishResult}
          />
        </View>
      </View>
    </FiModal>
  );
  const rewardModal =
    dialog === 'reward' &&
    (serverQuests ? (
      <ServerQuestRewardModal e={e} board={boardQ} onDone={claimed} />
    ) : (
      <RewardModal e={e} onClaimed={claimed} />
    ));
  const tutorialNext = (text: string, next: number) => (
    <TutorialSpotlight text={text}>
      <Btn title={t('focusFlow.tutorial.next')} small onPress={() => e.setGuideStep(next)} />
    </TutorialSpotlight>
  );
  const tutorialOverlay = (() => {
    if (leg || voyage || goldenCutscene || goldenReeling) return null;
    // 5·6단계는 땅을 직접 눌러야 넘어간다 — 「다음」 없이 지도를 열어 두고 안내만 띄운다
    if (r === 'fishingArrival' && (tutorialStep === 5 || tutorialStep === 6)) {
      const width = Math.min(L.floatingWidth, 414);
      return (
        <GuideBox
          accessibilityViewIsModal
          text={t(tutorialStep === 5 ? 'focusFlow.tutorial.step5' : 'focusFlow.tutorial.step6')}
          style={{ zIndex: 100, left: (L.width - width) / 2, width, bottom: safe.bottom + 16 }}
          onSkip={skipTutorial}
        >
          {screenReader && (
            <Btn title={t('focusFlow.spot.sitEmptyButton')} onPress={selectAccessibleSpot} />
          )}
        </GuideBox>
      );
    }
    if (r === 'focusSetup' && tutorialStep === 7)
      return (
        <TutorialSpotlight
          target={setupInputTarget.rect}
          error={error}
          accessibleInput={
            <TextInput
              accessibilityLabel={t('focusFlow.common.todayTodo')}
              value={e.text}
              onChangeText={(value) => {
                e.setText(value);
                setError('');
              }}
              maxLength={40}
              onSubmitEditing={finishInput}
              returnKeyType="done"
              style={{ minHeight: componentTokens.input.minHeight, width: '100%', color: C.ink }}
            />
          }
          text={t('focusFlow.tutorial.step7')}
        >
          <Btn
            title={t('focusFlow.tutorial.step7Done')}
            small
            disabled={!e.text.trim()}
            onPress={finishInput}
          />
        </TutorialSpotlight>
      );
    if (r === 'focusSetup' && tutorialStep === 8)
      return (
        <TutorialSpotlight
          target={setupStartTarget.rect}
          error={error}
          text={t('focusFlow.tutorial.step8')}
          action={{ title: t('focus.start'), onPress: start }}
        />
      );
    if (r === 'focus' && tutorialStep === 9) return tutorialNext(t('focusFlow.tutorial.step9'), 10);
    if (r === 'focus' && tutorialStep === 10)
      return tutorialNext(t('focusFlow.tutorial.step10', { name: s.name }), 11);
    if (r === 'focus' && tutorialStep === 12)
      return tutorialNext(t('focusFlow.tutorial.step12'), 14);
    if (r === 'focus' && tutorialStep === 14)
      return (
        <TutorialSpotlight
          target={pauseTarget.rect}
          action={{ title: t('focusFlow.common.pauseFocus'), onPress: pause }}
          text={t('focusFlow.tutorial.step14')}
        />
      );
    if (r === 'focus' && tutorialStep === 16)
      return tutorialNext(t('focusFlow.tutorial.step16'), 17);
    if (r === 'focus' && tutorialStep === 17)
      return (
        <TutorialSpotlight
          target={endTarget.rect}
          action={{ title: t('focusFlow.common.endFocus'), onPress: openEnd }}
          text={t('focusFlow.tutorial.step17')}
        />
      );
    if (r === 'focus' && tutorialStep === 18)
      return (
        <TutorialSpotlight
          target={confirmEndTarget.rect}
          text={t('focusFlow.tutorial.step18')}
          action={{ title: t('focusFlow.common.endFocus'), onPress: finish }}
        >
          <Btn title={t('focusFlow.common.continueAction')} kind="ghost" onPress={cancelEnd} />
        </TutorialSpotlight>
      );
    if (r === 'focusResult' && tutorialStep === 19)
      return tutorialNext(
        t('focusFlow.tutorial.step19'),
        // 서버는 유효 집중 60초당 1마리라 0마리일 수 있다 — 없는 물고기를 확인하라고 안내하지 않는다.
        (result?.fish ?? 0) > 0 ? 20 : 21,
      );
    if (r === 'focusResult' && tutorialStep === 20)
      return tutorialNext(t('focusFlow.tutorial.step20'), 21);
    if (r === 'focusResult' && tutorialStep === 21)
      return (
        <TutorialSpotlight
          target={resultTarget.rect}
          action={{ title: t('focusFlow.common.backToIsland'), onPress: finishResult }}
          text={t('focusFlow.tutorial.step21')}
        />
      );
    return null;
  })();
  const goldenCutsceneOverlay = goldenCutscene ? (
    <GoldenFishCutscene
      key={goldenCutscene.eventId}
      muted={!s.settings.sound}
      volume={s.settings.volume ?? 0.55}
      onFinish={() => {
        const completed = goldenCutscene;
        goldenCutsceneRef.current = null;
        setGoldenCutscene(null);
        if (leg) {
          goldenPendingReelRef.current = completed;
          // 이동 완료 전에도 다음 컷신·화면 전환이 앞지르지 못하게 차단한다.
          goldenQueueTimerRef.current = () => {
            goldenPendingReelRef.current = null;
          };
          return;
        }
        recordGoldenCatch(completed);
        setGoldenFish(true);
        // 실제 포그라운드에서 reel을 2초 노출한 뒤 다음 영상 또는 지연된 이동을 진행한다.
        startGoldenReelTimer();
      }}
    />
  ) : null;
  if (r === 'focusResult' && s.resultFromRest)
    return (
      <TutorialScene style={{ flex: 1 }} overlay={tutorialOverlay} onSkip={skipTutorial}>
        <View
          style={{ flex: 1 }}
          importantForAccessibility={goldenCutscene ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={!!goldenCutscene}
        >
          <RestGroup
            state={s}
            live={liveIslandId ? live : null}
            home={e.home}
            resume={e.home}
            result
            goldenReeling={goldenReeling}
            goldenFishCount={goldenFor(actorUserId, goldenSessionId)?.count ?? 0}
          />
          {!goldenReeling && resultModal}
          {!goldenReeling && rewardModal}
        </View>
        {goldenCutsceneOverlay}
      </TutorialScene>
    );
  const seated = r !== 'fishingArrival' && !leg,
    spots = [...fishingPeerSpots, ...(seated ? [mine] : [])];
  const focusing = r === 'focus' && !!s.session && !leg,
    mySubject = r === 'focusSetup' ? null : (s.session?.subject ?? result?.subject ?? null);
  // 집중 준비 모달은 누른 곳(내 고양이) 위에 붙인다. 위가 좁으면 아래 → 오른쪽 → 왼쪽.
  const setup = (toScreen: (p: Point) => Point, size: number) => {
    const { x, y } = toScreen(mine),
      dw = Math.min(330, L.width - 40),
      { top, left } = anchorCard(
        x,
        y,
        size * 0.077,
        dw,
        setupHeight,
        L.width,
        boxHeight || L.height,
        safe,
      );
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3940' }]} />
        <View
          onLayout={(ev) => setSetupHeight(ev.nativeEvent.layout.height)}
          style={[
            fiCard,
            {
              position: 'absolute',
              top,
              left,
              width: dw,
              paddingTop: 14,
              paddingHorizontal: 16,
              paddingBottom: 16,
              opacity: setupHeight ? 1 : 0,
            },
          ]}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}
          >
            <Text style={fiTitle(18)}>{t('focusFlow.setup.title')}</Text>
            <View style={{ width: 44, height: 44, position: 'relative' }}>
              <View style={{ position: 'absolute', left: 22, top: 36 }}>
                <CatSprite
                  color={s.color}
                  motion="tilt"
                  size={44}
                  reduce={reduce}
                  testID="focus-setup-cat"
                />
              </View>
            </View>
          </View>
          <Text
            style={{
              fontSize: 12,
              lineHeight: 19.2,
              fontWeight: '800',
              color: INK,
              marginBottom: 4,
            }}
          >
            {t('focusFlow.common.todayTodo')}
          </Text>
          <View ref={setupInputTarget.ref} collapsable={false} onLayout={setupInputTarget.measure}>
            <TextInput
              testID="focus-subject"
              accessibilityLabel={t('focusFlow.common.todayTodo')}
              value={e.text}
              onChangeText={(tx: string) => {
                e.setText(tx);
                setError('');
              }}
              maxLength={40}
              placeholder={t('focusFlow.setup.placeholder')}
              placeholderTextColor="#9C8B80"
              returnKeyType="done"
              onSubmitEditing={tutorialStep === 7 ? finishInput : start}
              style={{
                minHeight: 40,
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderWidth: 2,
                borderColor: OUTLINE,
                borderRadius: 13,
                backgroundColor: C.paper,
                fontSize: 14,
                lineHeight: 22.4,
                color: INK,
              }}
            />
          </View>
          {error !== '' && (
            <Text style={{ fontSize: 11, lineHeight: 17, color: '#a65539', marginTop: 5 }}>
              {error}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <FiButton
              title={t('focusFlow.setup.pickAnotherSpot')}
              style={{ flex: 1 }}
              onPress={e.back}
            />
            <View
              ref={setupStartTarget.ref}
              collapsable={false}
              onLayout={setupStartTarget.measure}
              style={{ flex: 1 }}
            >
              <FiButton primary title={t('focus.start')} id="start-focus" onPress={start} />
            </View>
          </View>
        </View>
      </View>
    );
  };
  const sendEmote = (id: string) => {
    setFan(false);
    if (liveIslandId) {
      // 서버 모드는 STOMP SEND 가 유일한 경로 — 브로드캐스트가 돌아올 때만 화면에 뜬다.
      if (!live.sendEmote(id)) e.notify(t('focusFlow.hud.emoteSendFailed'));
      return;
    }
    setEmote(id);
    if (emoteTimer.current) clearTimeout(emoteTimer.current);
    emoteTimer.current = setTimeout(() => setEmote(null), 3000);
  };
  const hudText = {
    color: INK,
    textShadowColor: '#FFFDFA',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  };
  const circle = (d: number, bg: string) => ({
    width: d,
    height: d,
    borderRadius: d / 2,
    borderWidth: 2,
    borderColor: OUTLINE,
    backgroundColor: bg,
    boxShadow: `0px 4px 0px ${OUTLINE}`,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });
  return (
    <TutorialScene
      style={{ flex: 1 }}
      onLayout={(ev) => setBoxHeight(ev.nativeEvent.layout.height)}
      overlay={tutorialOverlay}
      isolateAccessibility={(tutorialStep === 5 || tutorialStep === 6) && !!tutorialOverlay}
      onSkip={skipTutorial}
    >
      <View testID="golden-background" style={{ flex: 1 }} {...a11yHidden(!!goldenCutscene)}>
        <FishingIsland
          focus={r !== 'fishingArrival' ? mine : L.landscape ? { x: 45, y: 58 } : { x: 38, y: 56 }}
          ratio={r === 'focusSetup' ? 0.72 : 0.5}
          spots={spots}
          onTap={r === 'fishingArrival' ? selectSpot : undefined}
          onRaft={raft}
          gram={i.buildings.includes('gram')}
          onGram={focusing ? () => setDialog('music') : undefined}
          seated={seated}
          inert={!!dialog || r === 'focusResult' || !!goldenCutscene}
          overlay={r === 'focusSetup' ? setup : undefined}
          goldenFish={goldenFish}
        >
          {(size, sizeY, zoom) => {
            // 머리 위 과목·시간표가 겹치면 뒤(위쪽) 것을 숨긴다: 내 표시가 먼저, 그다음 앞(아래)쪽.
            // 1배 미만으로 줄이면 다른 주민은 이름만.
            const shown = new Set<string>(),
              kept: ReturnType<typeof labelBox>[] = [];
            [
              ...(seated && mySubject != null
                ? [{ id: 'me', spot: mine, subject: mySubject }]
                : []),
              ...(zoom < 1
                ? []
                : peers
                    .map((actor) => ({
                      id: actor.key,
                      spot: actor.spot,
                      subject: actor.subject ?? '',
                    }))
                    .sort((a, b) => b.spot.y - a.spot.y)),
            ].forEach((l) => {
              const b = labelBox(l.spot, l.subject, size, sizeY);
              if (
                kept.some(
                  (k) =>
                    !(
                      k.right <= b.left ||
                      b.right <= k.left ||
                      k.bottom <= b.top ||
                      b.bottom <= k.top
                    ),
                )
              )
                return;
              kept.push(b);
              shown.add(l.id);
            });
            return (
              <>
                {peers.map((actor) => (
                  <FishingPeerActorView
                    key={actor.key}
                    actor={{ ...actor, subject: shown.has(actor.key) ? actor.subject : null }}
                    size={size}
                    sizeY={sizeY}
                    emote={emoteByUser.get(actor.userId) ?? null}
                    reduce={reduce}
                    goldenFishCount={goldenFor(actor.userId, actor.sessionId)?.count ?? 0}
                    goldenCatchToken={goldenFor(actor.userId, actor.sessionId)?.eventId}
                    onEntered={peerFlow.entered}
                    onCast={peerFlow.cast}
                    onPausedExit={peerFlow.leftForPause}
                    onStretch={peerFlow.stretched}
                    onCompletedExit={peerFlow.leftForComplete}
                  />
                ))}
                {seated ? (
                  <FishingActor
                    spot={mine}
                    size={size}
                    sizeY={sizeY}
                    color={s.color}
                    name={t('focusFlow.common.me')}
                    me
                    subject={shown.has('me') ? mySubject : null}
                    seconds={
                      r === 'focusResult'
                        ? (result?.seconds ?? 0)
                        : sessionSeconds(s.session, e.now)
                    }
                    emote={
                      focusing
                        ? liveIslandId
                          ? (emoteByUser.get(myId ?? '') ?? null)
                          : emote
                        : null
                    }
                    motion={
                      r === 'focusSetup'
                        ? 'tilt'
                        : r === 'focusResult'
                          ? 'stretch'
                          : tutorialReeling
                            ? 'reel'
                            : undefined
                    }
                    reduce={reduce}
                    goldenFishCount={goldenFor(actorUserId, goldenSessionId)?.count ?? 0}
                    tutorialFish={s.session?.tutorialFish === true}
                    caughtFish={
                      r === 'focusResult'
                        ? result?.fish
                        : experience
                          ? s.session?.tutorialFish
                            ? 1
                            : 0
                          : undefined
                    }
                    goldenCatchToken={goldenFor(actorUserId, goldenSessionId)?.eventId}
                    catchAvoidSpots={peerSpots}
                    catchVisibleSpots={peerCatchSpots}
                    catchGramVisible={i.buildings.includes('gram')}
                    catchFuturePeerSpots={PEER_SPOTS}
                  />
                ) : (
                  <FishingWalker
                    p={walker.p}
                    size={size}
                    sizeY={sizeY}
                    color={s.color}
                    walking={walker.walking}
                    left={walker.left}
                    reduce={reduce}
                  />
                )}
              </>
            );
          }}
        </FishingIsland>
        {liveIslandId && live.status === 'error' && (
          <View
            style={{
              position: 'absolute',
              zIndex: 5,
              top: Math.max(56, safe.top + 8),
              left: Math.max(18, safe.left + 8),
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('focusFlow.hud.residentsReloadA11y')}
              onPress={live.retry}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: OUTLINE,
                borderRadius: 14,
                backgroundColor: '#FFFDFAD9',
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ fontSize: 12, lineHeight: 19.2, fontWeight: '800', color: INK }}>
                {t('focusFlow.hud.residentsLoadFailed')}
              </Text>
            </Pressable>
          </View>
        )}
        {focusing && (
          <>
            <View
              pointerEvents="none"
              {...a11yHidden(!!dialog || !!goldenCutscene)}
              style={{
                position: 'absolute',
                zIndex: 5,
                top: wide ? Math.max(14, safe.top + 14) : Math.max(100, safe.top + 48),
                left: Math.max(18, safe.left),
                right: Math.max(18, safe.right),
                alignItems: 'center',
              }}
            >
              <Text
                numberOfLines={1}
                style={[hudText, { fontSize: 16, lineHeight: 25.6, fontWeight: '900' }]}
              >
                {s.session!.subject}
              </Text>
              <Text
                style={[
                  hudText,
                  {
                    fontSize: wide ? 32 : 42,
                    lineHeight: (wide ? 32 : 42) * 1.15,
                    fontWeight: '900',
                    letterSpacing: -1.5,
                    fontVariant: ['tabular-nums'],
                  },
                ]}
              >
                {hms(sessionSeconds(s.session, e.now))}
              </Text>
            </View>
            <View
              {...a11yHidden(!!dialog || !!goldenCutscene)}
              style={{
                position: 'absolute',
                zIndex: 5,
                bottom: wide ? Math.max(18, safe.bottom) : Math.max(36, safe.bottom + 4),
                ...(wide
                  ? { right: Math.max(24, safe.right), width: 340 }
                  : { left: Math.max(18, safe.left), right: Math.max(18, safe.right) }),
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {fan && (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 64,
                    flexDirection: 'row',
                    gap: 6,
                  }}
                >
                  {['hello', 'cheer', 'sleepy', 'laugh', 'hearts'].map((id, n) => (
                    <Pressable
                      key={id}
                      testID={`emote-${id}`}
                      accessibilityRole="button"
                      accessibilityLabel={
                        [
                          t('focusFlow.hud.emote.hello'),
                          t('focusFlow.hud.emote.cheer'),
                          t('focusFlow.hud.emote.sleepy'),
                          t('focusFlow.hud.emote.laugh'),
                          t('focusFlow.hud.emote.hearts'),
                        ][n]
                      }
                      onPress={() => sendEmote(id)}
                      style={circle(46, C.paper)}
                    >
                      <Image source={art[`emote/${id}`]} style={{ width: 30, height: 30 }} />
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable
                testID="emote-fab"
                accessibilityRole="button"
                accessibilityLabel={t('focusFlow.hud.emoteFab')}
                accessibilityState={{ expanded: fan }}
                onPress={() => setFan(!fan)}
                style={circle(52, C.butter)}
              >
                <Image
                  source={art[`emote/${emote ?? 'hello'}`]}
                  style={{ width: 32, height: 32 }}
                />
              </Pressable>
              <View
                ref={pauseTarget.ref}
                collapsable={false}
                onLayout={pauseTarget.measure}
                style={{ flex: 1 }}
              >
                <FiButton
                  primary
                  title={t('focusFlow.common.pauseFocus')}
                  id="pause-focus"
                  onPress={pause}
                />
              </View>
              <View
                ref={endTarget.ref}
                collapsable={false}
                onLayout={endTarget.measure}
                style={{ flex: 1 }}
              >
                <FiButton title={t('focusFlow.common.endFocus')} id="end-focus" onPress={openEnd} />
              </View>
            </View>
            {dialog === 'end' && !goldenReeling && (
              <FiModal>
                <Text style={fiTitle(wide ? 19 : 22)}>{t('focusFlow.hud.endConfirmTitle')}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: wide ? 12 : 18 }}>
                  <FiButton
                    title={t('focusFlow.common.continueAction')}
                    style={{ flex: 1 }}
                    onPress={cancelEnd}
                  />
                  <View
                    ref={confirmEndTarget.ref}
                    collapsable={false}
                    onLayout={confirmEndTarget.measure}
                    style={{ flex: 1 }}
                  >
                    <FiButton
                      primary
                      title={t('focusFlow.common.endFocus')}
                      id="confirm-finish"
                      onPress={finish}
                    />
                  </View>
                </View>
              </FiModal>
            )}
            {dialog === 'music' && !goldenReeling && (
              <FiModal>
                <Text style={[fiTitle(wide ? 19 : 22), { marginBottom: 8 }]}>
                  {t('focusFlow.music.title')}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    lineHeight: 20.8,
                    color: '#7C6857',
                    marginBottom: wide ? 10 : 15,
                  }}
                >
                  {t('focusFlow.music.subtitle')}
                </Text>
                <View style={{ gap: 8 }}>
                  {i.sharedOwned.filter(hasBundledAudio).map((id) => (
                    <FiButton
                      key={id}
                      left
                      primary={i.track === id}
                      title={trackNames[id]}
                      onPress={() => {
                        if (!e.playback) e.dispatch({ type: 'TRACK', value: id });
                        else
                          e.playback
                            .update({ trackId: id, playing: true })
                            .catch((thrown: unknown) =>
                              e.notify(errorTextOr(thrown, 'focusFlow.music.changeFailed')),
                            );
                      }}
                    />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', marginTop: wide ? 12 : 18 }}>
                  <FiButton
                    primary
                    title={t('focusFlow.music.backToSpot')}
                    style={{ flex: 1 }}
                    onPress={() => setDialog(null)}
                  />
                </View>
              </FiModal>
            )}
          </>
        )}
        {r === 'focusResult' && !leg && !goldenReeling && resultModal}
        {!leg && !goldenReeling && rewardModal}
      </View>
      {goldenCutsceneOverlay}
    </TutorialScene>
  );
}
// 퀘스트 보상받기(갤러리 49 보상 모달): 결과창 다음에 한 번. 받으면 다음 보상이 없을 때 섬으로.
function RewardModal({
  e,
  onClaimed,
  rewardIslandId,
}: {
  e: any;
  onClaimed?: (more: boolean) => void;
  rewardIslandId?: string;
}) {
  const s: State = e.state,
    wide = useAppLayout().width >= 600,
    open = pendingQuestRewards(s.rewards, rewardIslandId),
    reward = open[0];
  if (!reward) return null;
  const owner = s.islands.find((i) => i.id === reward.islandId),
    title = owner?.quests.find((q) => q.id === reward.questId)?.title ?? '퀘스트',
    // 받침 있는 글자 뒤에는 '을'
    particle = (title.charCodeAt(title.length - 1) - 0xac00) % 28 > 0 ? '을' : '를';
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 20, justifyContent: 'center' }]}
      accessibilityViewIsModal
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3966' }]} />
      <View
        style={{
          marginHorizontal: wide ? 157 : 24,
          backgroundColor: C.paper,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 24,
          paddingTop: wide ? 14 : 20,
          paddingHorizontal: 20,
          paddingBottom: wide ? 14 : 18,
          gap: wide ? 10 : 14,
          boxShadow: `0px 6px 0px ${OUTLINE}`,
          alignItems: 'center',
        }}
      >
        <Image source={art.fish} style={{ width: 72, height: 72 }} />
        <Txt kind="h">{reward.kind === 'bonus' ? '모두 해냈어요!' : '퀘스트 달성!'}</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          {reward.kind === 'bonus'
            ? `섬에 보너스 ${reward.amount}마리가 쌓였어요`
            : `${title}${particle} 달성했어요.\n물고기 ${reward.amount}마리를 추가로 받았어요!`}
        </Txt>
        <Btn
          title={reward.kind === 'bonus' ? '좋아요' : '보상받기'}
          id="claim-reward"
          style={{ alignSelf: 'stretch' }}
          onPress={() => {
            e.dispatch({ type: 'CLAIM', id: reward.id });
            onClaimed?.(open.length > 1);
          }}
        />
      </View>
    </View>
  );
}
// 서버 퀘스트 수령 모달 (GROMO-2014): 개인 몫만 POST claims 로 받는다. 지급량은 서버가
// 판정해 응답으로 주고, 성공 뒤 훅이 목록·지갑을 다시 읽는다 — 여기서 로컬 재화를 만지지 않는다.
// 전원 달성 보너스는 수령 버튼이 따로 없고, 서버가 함께 적립한 만큼만 알린다.
function ServerQuestRewardModal({
  e,
  board,
  onDone,
}: {
  e: any;
  board: ReturnType<typeof useBoardNotices>;
  onDone?: (more: boolean) => void;
}) {
  const wide = useAppLayout().width >= 600;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reward = board.quests.find((q) => q.claimable);
  const rewardId = reward?.id;
  // 읽기가 끝났는데(또는 못 읽었는데) 받을 게 없으면 흐름을 닫는다 — 수령은 게시판 상세에도 있다.
  useEffect(() => {
    if ((board.error || !board.loading) && !rewardId) onDone?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.error, board.loading, rewardId]);
  if (board.loading && !reward)
    return (
      <FiModal>
        <Txt kind="h">퀘스트 보상</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          받을 수 있는 보상을 확인하고 있어요…
        </Txt>
      </FiModal>
    );
  if (!reward) return null;
  const title = reward.title,
    // 받침 있는 글자 뒤에는 '을'
    particle = (title.charCodeAt(title.length - 1) - 0xac00) % 28 > 0 ? '을' : '를';
  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 20, justifyContent: 'center' }]}
      accessibilityViewIsModal
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#493B3966' }]} />
      <View
        style={{
          marginHorizontal: wide ? 157 : 24,
          backgroundColor: C.paper,
          borderWidth: 2,
          borderColor: OUTLINE,
          borderRadius: 24,
          paddingTop: wide ? 14 : 20,
          paddingHorizontal: 20,
          paddingBottom: wide ? 14 : 18,
          gap: wide ? 10 : 14,
          boxShadow: `0px 6px 0px ${OUTLINE}`,
          alignItems: 'center',
        }}
      >
        <Image source={art.fish} style={{ width: 72, height: 72 }} />
        <Txt kind="h">퀘스트 달성!</Txt>
        <Txt style={{ color: '#796256', textAlign: 'center' }}>
          {`${title}${particle} 달성했어요.\n물고기 ${reward.reward.amount}마리를 받을 수 있어요!`}
        </Txt>
        {!!error && <Txt style={{ color: '#994C3E', textAlign: 'center' }}>{error}</Txt>}
        <Btn
          title={busy ? '받는 중…' : '보상받기'}
          id="claim-server-reward"
          style={{ alignSelf: 'stretch' }}
          disabled={busy}
          onPress={() => {
            if (busy) return;
            setBusy(true);
            setError('');
            board.claimQuest(reward).then(
              (result) => {
                setBusy(false);
                if (result.bonusAdded > 0)
                  e?.notify?.(`전원 달성 보너스 ${result.bonusAdded}마리도 섬에 함께 쌓였어요`);
                onDone?.(
                  board.quests.some((q) => q.claimable && q.occurrenceId !== reward.occurrenceId),
                );
              },
              (err: unknown) => {
                setBusy(false);
                setError(
                  err instanceof ApiError && err.message
                    ? err.message
                    : '받지 못했어요. 다시 시도해 주세요.',
                );
              },
            );
          }}
        />
      </View>
    </View>
  );
}
function Tower({ e }: any) {
  return <RedesignScreens e={e} />;
}
function Social({ e }: any) {
  const s: State = e.state,
    r = e.route,
    [query, setQuery] = useState(''),
    friends = s.friends ?? [];
  if (r === 'boat' || r === 'mainIsland' || r === 'currentIsland')
    return (
      // 내 뗏목·메인 섬 변경·친구 관리는 v2 시트 구현(Screens.tsx)이 그린다
      <RedesignScreens e={e} />
    );
  if (r === 'friends' || r === 'friendSearch')
    return (
      // 친구 요청 수락·거절·취소, 친구 ··· 삭제, 닉네임 정확히 일치 검색
      <RedesignScreens e={e} />
    );
  return null;
}
function ShopMusic({ e }: any) {
  return <RedesignScreens e={e} />;
}
