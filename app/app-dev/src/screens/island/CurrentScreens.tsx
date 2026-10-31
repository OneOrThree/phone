import { FishingFocusHud } from '@/screens/focus/FishingFocusHud';
import {
  clearVerificationResult,
  verificationResult,
} from '@/services/studyVerification/sessionResult';
import { DeveloperNoticesScreen } from '@/screens/island/DeveloperNoticesScreen';
import { useAccountGuides } from '@/screens/island/useAccountGuides';
import { useConstructionAnnouncements } from '@/screens/island/useConstructionAnnouncements';
import { BuildingGuide, BuildingCompletionGuide } from '@/screens/island/NpcGuide';
import { AndroidAppPicker } from '@/components/AndroidAppPicker';
import { screenTimeNative } from '@/services/ScreenTimeModule';
import { PermissionsAndroid } from 'react-native';
import { VisitorBoard } from '@/screens/island/VisitorBoard';
import { confirmLeaveVisit, useVisitorJoin } from '@/screens/island/useVisitorJoin';
import { sessionGeneration } from '@/services/api/session';
import {
  BUNDLED_AUDIO_TRACK_IDS,
  DEFAULT_FREE_AUDIO_TRACK_IDS,
  hasBundledAudio,
} from '@/constants/audio';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, getLocale, t } from '@/i18n';
import { ownCatName } from '@/i18n/format';
import { findReachableTutorialSpot } from '@/services/tutorial';
import {
  isTutorialExperience,
  tutorialExperienceScene,
  tutorialExperienceAction,
} from '@/services/tutorialExperience';
import { syncAndroidScreenTime } from '@/services/screentimeSync';
import { pushPermissionStatus, requestPushPermission, type PushPermission } from '@/services/push';
import { captureProductEvent } from '@/services/posthog';
import { Ticking } from '@/hooks/useNow';
import {
  VERIFY_SPIKE,
  VerificationSpike,
  VerificationToggle,
} from '@/screens/focus/VerificationSpike';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
  AppState,
  Image,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Circle as SvgCircle,
  Defs as SvgDefs,
  LinearGradient as SvgLinearGradient,
  Path as SvgPath,
  Polygon as SvgPolygon,
  Rect as SvgRect,
  Stop as SvgStop,
  Svg,
} from 'react-native-svg';
import {
  State,
  Building,
  Color,
  Route,
  displayIsland as currentIsland,
  viewIsland,
  serverHome,
  serverVisit,
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
  trackNames,
  products,
  canBuy,
  SERVER_VISIT_ROUTES,
} from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { ApiError } from '@/services/api/client';
import { useBoardNotices } from '@/screens/interiors/useBoardNotices';
import { getSession } from '@/services/api/session';
import { catColor, useIslandPresence } from '@/screens/focus/useIslandPresence';
import { lookOf } from '@/services/memberAppearance';
import {
  isGoldenFishParticipant,
  memberArrivedText,
  type GoldenFishEvent,
} from '@/services/islandRealtime';
import {
  fishingSpotsForActors,
  useFishingPeerActors,
  type FishingPeer,
  type FishingPeerActor,
} from '@/screens/focus/useFishingPeerActors';
import { GoldenFishCutscene } from '@/screens/focus/GoldenFishCutscene';
import { RestGroup } from '@/screens/focus/RestGroup';
import { FocusResultSummary } from '@/screens/focus/FocusResultSummary';
import { Sailing } from '@/screens/world/WorldViews';
import { DepartureStory } from '@/screens/world/DepartureStory';
import {
  FiButton,
  FiModal,
  FishingActor,
  FishingCatArt,
  FishingIsland,
  FishingPeerActorView,
  FishingWalker,
  INK,
  a11yHidden,
  anchorCard,
  labelBox,
  DEFAULT_SPOT,
  LANDING,
  OUTLINE,
  castSpot,
  fishingPeerCatchVisible,
  fiCard,
  fiTitle,
  fishingGrid,
  hms,
  DEFAULT_CATCH_PLACEMENT,
  seatProblem,
} from '@/screens/focus/FishingIsland';
import { Text, TextInput } from '@/design-system/typography';
import { Point, landPath, nearestLand, onLand } from '@/utils/world-grid';
import { RedesignScreens } from '@/screens/island/Screens';
import { outfitOf, type Outfit } from '@/components/CatOutfitLayers';
import { FinalIsland } from '@/screens/island/WorldMap';
import {
  GuideBox,
  TutorialScene,
  useScreenReaderEnabled,
  TutorialSpotlight,
  useSpotlightTarget,
} from '@/screens/island/NpcGuide';
import { useBoardHomeIndicator } from '@/screens/island/useBoardHomeIndicator';
import { useShop } from '@/screens/island/useShop';
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
  NavBtn,
} from '@/design-system/patterns';
import { IslandSheet, IslandPopup } from '@/screens/island/IslandSheet';
import { RaftDestinations } from '@/screens/island/RaftDestinations';
import { SeaVoyageHost } from '@/screens/sea/SeaVoyageHost';
import { seaAssets } from '@/screens/sea/seaAssets';
import { Telescope } from '@/screens/island/Telescope';
import { MagazineReader } from '@/screens/magazine/MagazineReader';
import { PromotionEditor } from '@/screens/magazine/PromotionEditor';
import { useMagazineToday } from '@/screens/magazine/useMagazineToday';
import { usePromotionNewsToast } from '@/screens/magazine/usePromotionNewsToast';
import { mockFlags } from '@/services/api/magazineMock';
import { isMockMode } from '@/services/demoMode';
import { josa } from '@/i18n/format';
import { InteriorRoute } from '@/screens/interiors/BuildingInteriors';
import { IslandChatSheet } from '@/screens/island/IslandChatSheet';
import { useIslandChat } from '@/screens/island/useIslandChat';
import { Library } from '@/screens/island/Library';
import { Hall } from '@/screens/island/Hall';
import { useFriendsScreen, type FriendsScreenState } from '@/screens/island/useFriendsScreen';
import { CatInfoPopup, FriendActionContext } from '@/screens/island/CatInfoPopup';
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
  // 바다 표류 HUD(GROMO-2404)도 홈처럼 요청 배지를 보여 같은 freshness 경계에 둔다
  const friendsSafetyRouteActive =
    friendsRouteActive || e.route === 'boat' || e.route === 'home' || e.route === 'sea';
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

  const owner =
    serverIslands && e.accountDataReady !== false ? (getSession()?.userId ?? null) : null;
  const guides = useAccountGuides(owner, e.state, dispatch);
  useEffect(() => {
    if (guides.data?.focusDone && e.route === 'guide') e.reset('home');
  }, [guides.data?.focusDone, e.route, e.reset]);
  const { joined, built } = memberGate(e.state, !!serverIslands);
  const islandId = e.state.serverIslands?.currentIslandId ?? null;
  const announcements = useConstructionAnnouncements(
    owner,
    islandId,
    built?.join(',') ?? '',
    !!owner &&
      joined &&
      !e.state.visitingIslandId &&
      !e.state.session &&
      e.route === 'home' &&
      (!e.state.tutorial || e.state.tutorial.step >= 22),
  );
  const completion =
    guides.data &&
    announcements.find((b) => !guides.data!.completions.includes(`${islandId}:${b}`));
  // construction_completed 는 완공 안내를 "확인(ack)"하는 순간에만 발행한다(아래 onDone).
  // 안내가 뜨는 시점이 아니라 영속 저장(guides.done)되는 ack 시점에 쏴야, 확인 전 강제 종료 후
  // 재실행해도 같은 완공이 중복 발행되지 않는다. Set 은 같은 세션 안 재시도의 이중 발행만 막는다.
  const announcedCompletions = useRef<Set<string>>(new Set());
  const routeBuildings: Partial<Record<Route, Building>> = {
    hall: 'hall',
    board: 'board',
    sound: 'gram',
    library: 'library',
    mail: 'mail',
    tower: 'tower',
    shop: 'shop',
  };
  // 건물 내부는 안내가 끝날 때까지 마운트하지 않는다. 고양이의 도착 요청만 보관한다.
  const generation = sessionGeneration();
  const [entry, setEntry] = useState<{
    owner: string;
    generation: number;
    islandId: string | null;
    building: Building;
    route: Route;
    args: any[];
  } | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const eligible =
    !!owner && joined && !e.state.visitingIslandId && !e.state.session && e.route === 'home';
  const pending =
    eligible &&
    entry?.owner === owner &&
    entry.generation === generation &&
    entry.islandId === islandId &&
    built?.includes(entry.building)
      ? entry
      : null;
  useEffect(() => {
    if (entry && !pending) {
      entryRef.current = null;
      setEntry(null);
    }
  }, [entry, pending]);
  useEffect(() => {
    if (!pending || !guides.data?.buildings.includes(pending.building)) return;
    // 저장 성공 후에만 진입한다. 섬·계정이 바뀐 요청은 위에서 폐기한다.
    if (entryRef.current !== pending || sessionGeneration() !== pending.generation) return;
    entryRef.current = null;
    setEntry(null);
    e.go(pending.route, ...pending.args);
  }, [pending, guides.data, e.go]);
  const go = (route: Route, ...args: any[]) => {
    const building = routeBuildings[route];
    if (eligible && building && built?.includes(building)) {
      if (entryRef.current) return false;
      if (!guides.data || !guides.data.buildings.includes(building)) {
        const next = { owner: owner!, generation, islandId, building, route, args };
        entryRef.current = next;
        setEntry(next);
        return false;
      }
    }
    return e.go(route, ...args);
  };
  const cancelEntry = () => {
    entryRef.current = null;
    setEntry(null);
  };
  if (
    owner &&
    !guides.data &&
    (e.route === 'guide' || (e.route === 'home' && e.state.tutorial && e.state.tutorial.step < 22))
  )
    return (
      <Overlay close={e.home}>
        <Txt>{guides.error || '안내 이력을 확인하고 있어요.'}</Txt>
        {!!guides.error && <Btn title="다시 시도" onPress={guides.retry} />}
      </Overlay>
    );
  if (owner && guides.data?.focusDone && e.route === 'guide') return null;
  return (
    <>
      {/* 다른 고양이 정보창(GROMO-2474)의 친구 행동 — 친구 관리와 같은 서버 상태, 목업은 로컬 친구 목록 */}
      <FriendActionContext.Provider
        value={{
          friendsScreen: serverIslands ? friendsScreen : null,
          conversion: e.conversion,
          friends: e.state.friends,
          dispatch,
        }}
      >
        <CurrentScreensContent e={{ ...e, go, friendsScreen }} />
      </FriendActionContext.Provider>
      {pending && !guides.data && (
        <Modal
          transparent
          animationType="none"
          testID="building-entry-pending"
          onRequestClose={cancelEntry}
        >
          <View style={{ flex: 1, justifyContent: 'center', padding: semanticTokens.spacing.page }}>
            <GuideBox
              text={guides.error || '안내 이력을 확인하고 있어요.'}
              style={{ position: 'relative' }}
            >
              {!!guides.error && <Btn title="다시 시도" onPress={guides.retry} />}
              <Btn title={t('common.close')} kind="sec" onPress={cancelEntry} />
            </GuideBox>
          </View>
        </Modal>
      )}
      {completion && (
        <BuildingCompletionGuide
          key={`${owner}:${islandId}:${completion}`}
          building={completion}
          blocked={e.routeTransitionShielded}
          saving={guides.saving}
          error={guides.error}
          onDone={() => {
            const completionKey = `${islandId}:${completion}`; // 영속 저장 키(계정별 guides)
            // 확인(ack)으로 완공 이력을 영속 저장하는 순간 1회 — 재시작 후에도 중복 없음.
            // 세션 내 중복 방지 키엔 owner 를 포함한다 — 같은 기기에서 계정이 바뀌어도(CurrentScreens 유지)
            // 다른 계정의 정상 완공 확인을 억제하지 않게.
            const dedupKey = `${owner}:${completionKey}`;
            if (!announcedCompletions.current.has(dedupKey)) {
              announcedCompletions.current.add(dedupKey);
              captureProductEvent('construction_completed', { building_id: completion });
            }
            void guides.done({ completions: [completionKey] });
          }}
        />
      )}
      {pending &&
        guides.data &&
        !completion &&
        !guides.data.buildings.includes(pending.building) && (
          <BuildingGuide
            key={`${owner}:${islandId}:${pending.building}`}
            building={pending.building}
            blocked={e.routeTransitionShielded}
            saving={guides.saving}
            error={guides.error}
            onDone={() => void guides.done({ buildings: [pending.building] })}
          />
        )}
    </>
  );
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
    // 스냅샷 전에는 섬장인지 모른다 — false(주민)와 구분해 undefined 로 둔다(주민 소식 토스트가 섬장에게 새지 않게)
    host: facts ? facts.home.island.role === 'host' : undefined,
  };
}
// 초 단위로 흐르는 시간을 쓰는 화면(집중 경과·실시간 주민 시간·공사 완공 확인)만 ms 마다 다시 그린다 —
// App 은 분이 바뀔 때만 다시 그린다(GROMO-2372). e.now 와 이 시계 중 늦은 값을 넘겨 시각을 직접 주는 호출부도 그대로 둔다.
function everySecond(base: any, screen: (timed: any) => React.ReactNode, ms: number | null = 1000) {
  return (
    <Ticking ms={ms}>{(now) => screen({ ...base, now: Math.max(base.now ?? 0, now) })}</Ticking>
  );
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
  // 우리 섬 채팅방(GROMO-2499) — 우체통 밖으로 꺼냈다. 서버 모드의 내 섬에서만 읽고, 구경 중에는 부르지 않는다.
  // 홈 왼쪽 아래 최근 채팅 줄(GROMO-2501)도 같은 훅을 써서 홈 ↔ 채팅방을 오갈 때 다시 불러오지 않는다
  const islandChat = useIslandChat({
    islandId:
      e.islands && !state.visitingIslandId ? (state.serverIslands?.currentIslandId ?? null) : null,
    active: r === 'chat' || r === 'home',
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
    'promotionEditor',
  ];
  const { joined, built, host } = memberGate(state, !!e.islands);
  // 주민 소식 토스트(C3) — 내 섬 홈에 들어올 때, 섬장이 아닌 주민에게만(목업 QA 는 EXPO_PUBLIC_MAGAZINE_MOCK=member).
  // 서버 홈 스냅샷이 오기 전에는 host 가 undefined 라 섬장인지 모른다 — 주민으로 확인된(false) 뒤에만 읽는다
  usePromotionNewsToast({
    active:
      r === 'home' &&
      joined &&
      !state.visitingIslandId &&
      (host === false || (isMockMode() && mockFlags().has('member'))),
    islandId: e.islands ? (state.serverIslands?.currentIslandId ?? null) : i.id,
    notify: e.notify,
  });
  // 오늘 고양이 잡지(GROMO-2289) — 섬 홈(펠리컨 배달·우체통 빨간 점)과 우체통(잡지 보기 버튼)이 같이 본다. 구경 중에는 읽지 않는다.
  // 먼바다(GROMO-2314)도 표류 중 펠리컨·뗏목 옆 잡지 물건에 쓴다
  const magazine = useMagazineToday(
    (['home', 'mail'].includes(r) && !state.visitingIslandId) || r === 'sea',
  );
  const endServerVisit = () => {
    e.dispatch({ type: 'END_VISIT' });
    e.reset(state.serverIslands?.currentIslandId ? 'home' : 'sea');
  };
  const visitMap = () => e.replace('visitIsland', state.visitingIslandId);
  const closeFacility = e.islands && state.visitingIslandId ? visitMap : e.home;
  // 바다 항해 집중(GROMO-2310) — 섬 소속·구경 여부와 무관한 바다 화면이라 아래 섬 관문보다 먼저 연다.
  // 계정이 바뀌면 사용자 ID 를 key 로 화면(바다 방 연결 포함)을 새로 만든다.
  if (r === 'sea' || r === 'seaArrival')
    return everySecond({ ...e, magazineToday: magazine.today }, (timed) => (
      <SeaVoyageHost key={getSession()?.userId ?? ''} e={timed} />
    ));
  // 바다에서 펼친 오늘 호(GROMO-2314) — 배경은 먼바다, 칸에 망원경 동그라미. 소속 섬이 없어도 열린다
  if (r === 'seaMagazine')
    return (
      <MagazineReader
        key={e.detail}
        e={e}
        place="SEA"
        background={
          <Image
            testID="sea-magazine-background"
            source={seaAssets.background}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
        }
      />
    );
  // 섬 없음 안내는 회색 단색 대신 바다 장면 위에 띄운다(GROMO-2412). 버튼이 갈 곳을 말하니 부연 문장은 두지 않는다
  if (!joined && !state.visitingIslandId && memberRoutes.includes(r))
    return (
      <Overlay
        close={() => e.reset('sea')}
        background={
          <Image
            testID="no-island-background"
            source={seaAssets.background}
            resizeMode="cover"
            style={noIslandScene.fill}
          />
        }
      >
        <Txt kind="h17">가입한 섬이 없어요</Txt>
        <Btn title="바다로 가기" onPress={() => e.reset('sea')} />
      </Overlay>
    );
  // 구경 중에는 구경하는 섬의 홈·회관 정보·게시판 열람과 돌아가는 배만 연다(허용 목록).
  // 나머지는 내 섬 화면이 섞이거나 섬 상태가 꼬이지 않게 모두 막는다
  if (
    state.visitingIslandId &&
    !(
      e.islands
        ? SERVER_VISIT_ROUTES
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
            'raft',
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
        <Txt kind="h17">
          {t('home.lock.missing', {
            // 한국어는 건물명 받침에 맞춰 이/가(전망대가·축음기가). 영어 단어에는 조사를 붙이지 않는다
            building:
              getLocale() === 'ko'
                ? josa(buildingNames[required], '이', '가')
                : buildingNames[required],
          })}
        </Txt>
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
        e={e}
      />
    );
  }
  if (r === 'visit') return <Visit e={e} />;
  if (['arrival', 'travel'].includes(r)) return <Travel e={e} />;
  if (r === 'focusVisit') return everySecond(e, (timed) => <FocusVisit e={timed} />);
  if (r === 'visitIsland')
    return <VisitIsland e={screenE} onReturnFromVisit={e.islands ? endServerVisit : undefined} />;
  if (r === 'visitIslandFocus')
    return everySecond(e, (timed) => (
      <FocusVisit
        e={timed}
        islandId={e.detail || state.visitingIslandId}
        onBack={e.islands ? visitMap : e.back}
      />
    ));
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
    // 항해 연출·모닥불 휴식은 FocusFlow 가 시간을 쓰지 않는다(휴식 시간 글자는 RestGroup 이 스스로 센다)
    return everySecond(
      e,
      (timed) => <FocusFlow e={timed} />,
      ['focusTravel', 'returnTravel', 'rest'].includes(r) ? null : 1000,
    );
  if (['library', 'diary', 'stats'].includes(r)) return <Library e={e} />;
  // 회관은 공사 화면만 초 단위(남은 시간·완공 확인 재조회)다
  if (['hall', 'manage', 'members', 'ledger', 'construction'].includes(r))
    return everySecond(
      e,
      (timed) => (
        <Hall
          key={r}
          e={
            e.islands && state.visitingIslandId
              ? { ...timed, back: visitMap, home: visitMap }
              : timed
          }
        />
      ),
      r === 'construction' ? 1000 : null,
    );
  // 게시판·우체통은 건물 안 장면(BuildingInteriors)으로 그린다. 게시판은 진행 중 집중 달성률·공사 진행률·완공 확인이 초 단위다
  if (['board', 'notice', 'noticeEdit', 'quest', 'questEdit'].includes(r))
    return (
      <>
        {everySecond(screenE, (timed) => (
          <InteriorRoute e={timed} modalAboveBoard={rewardModalOpen} />
        ))}
        {/* 보상은 내 섬 퀘스트 몫이라 구경 중에는 띄우지 않는다 */}
        {!state.visitingIslandId && <RewardModal e={e} rewardIslandId={rewardIslandId} />}
      </>
    );
  if (['mail', 'friendMail'].includes(r))
    return <InteriorRoute e={{ ...e, magazineToday: magazine.today }} />;
  // 우리 섬 채팅방 — 우체통이 없어도 섬 홈 위 시트로 연다(GROMO-2499). 뒤 섬 홈은 스크린리더에서 숨긴다
  if (r === 'chat')
    return (
      <>
        <View
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        </View>
        <IslandChatSheet e={e} chat={islandChat} />
      </>
    );
  if (['tower', 'explore'].includes(r)) return <Tower e={e} />;
  if (r === 'raft') return <RaftDestinations e={e} />;
  if (r === 'telescope') return <Telescope e={e} />;
  if (r === 'promotionEditor') return <PromotionEditor e={e} />;
  // 섬에서 펼친 잡지 — 배경은 섬 홈(A4). 끝 쪽 「우리 섬도 실어 볼까요?」 안내는 내 섬 섬장만(쓰기 입구는 마을회관)
  if (r === 'magazine')
    return (
      <MagazineReader
        key={e.detail}
        e={e}
        host={host && !state.visitingIslandId}
        background={
          <FinalIsland
            state={state}
            go={e.go}
            build={e.build}
            showActions={false}
            boardStatus={boardStatus}
          />
        }
      />
    );
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
  if (r === 'developerNotices' || r === 'developerNotice') return <DeveloperNoticesScreen e={e} />;
  if (r === 'blockedUsers' && e.islands) return <BlockedUsersScreen e={e} />;
  return <RedesignScreens e={{ ...screenE, magazineToday: magazine.today, islandChat }} />;
}

async function openScreenTimeSettings(notify: (message: string) => void) {
  try {
    if (Platform.OS === 'android') {
      if (!(await screenTime.openUsageAccessSettings())) throw new Error('SETTINGS_UNAVAILABLE');
    } else {
      await Linking.openSettings();
    }
  } catch {
    notify(t('settings.permissions.errors.settingsOpen'));
  }
}

function ScreenTimePermissionHelp() {
  return (
    <Txt kind="meta">
      {Platform.OS === 'android'
        ? t('settings.permissions.help.android')
        : t('settings.permissions.help.ios')}
    </Txt>
  );
}

const focusBlockingIntroStyles = StyleSheet.create({
  characterStage: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  character: {
    width: '100%',
    height: '100%',
  },
  appLogo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: componentTokens.focusBlockingIntro.logoRadius,
    borderWidth: semanticTokens.stroke.strong,
    borderColor: C.brown,
    backgroundColor: C.paper,
    boxShadow: componentTokens.focusBlockingIntro.logoShadow,
  },
  title: { paddingRight: semanticTokens.size.tapMin },
  guide: { position: 'relative' },
});

function InstagramLogo() {
  return (
    <Svg width="68%" height="68%" viewBox="0 0 48 48">
      <SvgDefs>
        <SvgLinearGradient id="instagram-gradient" x1="4" y1="44" x2="44" y2="4">
          <SvgStop offset="0" stopColor="#FFD600" />
          <SvgStop offset="0.48" stopColor="#FF0169" />
          <SvgStop offset="1" stopColor="#D300C5" />
        </SvgLinearGradient>
      </SvgDefs>
      <SvgRect width="48" height="48" rx="12" fill="url(#instagram-gradient)" />
      <SvgRect
        x="11"
        y="11"
        width="26"
        height="26"
        rx="8"
        fill="none"
        stroke="#FFF"
        strokeWidth="3.5"
      />
      <SvgCircle cx="24" cy="24" r="6.5" fill="none" stroke="#FFF" strokeWidth="3.5" />
      <SvgCircle cx="33" cy="15" r="2.2" fill="#FFF" />
    </Svg>
  );
}

function YouTubeLogo() {
  return (
    <Svg width="72%" height="72%" viewBox="0 0 48 48">
      <SvgRect x="3" y="9" width="42" height="30" rx="9" fill="#FF0033" />
      <SvgPolygon points="20,17 33,24 20,31" fill="#FFF" />
    </Svg>
  );
}

const TIKTOK_PATH =
  'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

function TikTokLogo() {
  return (
    <Svg width="66%" height="66%" viewBox="-2 -2 28 28">
      <SvgPath d={TIKTOK_PATH} fill="#25F4EE" transform="translate(-0.65 0.55)" />
      <SvgPath d={TIKTOK_PATH} fill="#FE2C55" transform="translate(0.65 0)" />
      <SvgPath d={TIKTOK_PATH} fill="#121212" />
    </Svg>
  );
}

function FloatingAppLogo({
  testID,
  size,
  style,
  children,
}: {
  testID: string;
  size: number;
  style: any;
  children: React.ReactNode;
}) {
  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[focusBlockingIntroStyles.appLogo, { width: size, height: size }, style]}
    >
      {children}
    </View>
  );
}

export function FocusBlockingIntro({
  e,
}: {
  e: {
    onClose: () => void;
    onLater: () => void;
    onAllow: () => void;
    busy?: boolean;
  };
}) {
  const layout = useAppLayout();
  const characterSize = Math.min(
    layout.compact ? 160 : 288,
    layout.width - semanticTokens.spacing.page * 2,
    layout.height * 0.34,
  );
  const logoSize = layout.compact ? 42 : 56;
  return (
    <IslandPopup onClose={e.onClose}>
      <Txt kind="h17" accessibilityRole="header" style={focusBlockingIntroStyles.title}>
        {t('settings.permissions.focusBlockingIntro.title')}
      </Txt>
      <View
        style={[
          focusBlockingIntroStyles.characterStage,
          { minHeight: Math.max(characterSize, layout.height * (layout.compact ? 0.3 : 0.4)) },
        ]}
      >
        <FloatingAppLogo
          testID="focus-blocking-logo-instagram"
          size={logoSize}
          style={{ left: 4, top: '12%', transform: [{ rotate: '-8deg' }] }}
        >
          <InstagramLogo />
        </FloatingAppLogo>
        <FloatingAppLogo
          testID="focus-blocking-logo-youtube"
          size={logoSize}
          style={{ right: 2, top: '24%', transform: [{ rotate: '7deg' }] }}
        >
          <YouTubeLogo />
        </FloatingAppLogo>
        <FloatingAppLogo
          testID="focus-blocking-logo-tiktok"
          size={logoSize}
          style={{ left: 20, bottom: '10%', transform: [{ rotate: '-5deg' }] }}
        >
          <TikTokLogo />
        </FloatingAppLogo>
        <Image
          testID="focus-blocking-character"
          source={art['cat/black/phone']}
          accessible={false}
          resizeMode="contain"
          style={[
            focusBlockingIntroStyles.character,
            { width: characterSize, height: characterSize },
          ]}
        />
      </View>
      <GuideBox
        character={null}
        text={t('settings.permissions.focusBlockingIntro.dialogue')}
        style={focusBlockingIntroStyles.guide}
        onSkip={e.onLater}
        skipTitle={t('settings.permissions.focusBlockingIntro.later')}
      >
        <Btn
          small
          title={
            e.busy
              ? t('settings.permissions.gate.requesting')
              : t('settings.permissions.focusBlockingIntro.allow')
          }
          disabled={e.busy}
          onPress={e.onAllow}
        />
      </GuideBox>
    </IslandPopup>
  );
}

function AppPermissionManager({ e }: any) {
  const supportsFocusShield =
    Platform.OS !== 'android' || screenTimeNative?.supportsFocusShield !== false;
  const [status, setStatus] = useState<ScreenTimeAuthorization | 'loading'>('loading');
  const [selection, setSelection] = useState<ScreenTimeSelection | null>(null);
  const [selectionStatus, setSelectionStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [allowSafari, setAllowSafari] = useState(false);
  const [allowedCount, setAllowedCount] = useState(0);
  const [allowedPicker, setAllowedPicker] = useState(false);
  const [overlayGranted, setOverlayGranted] = useState(false);
  // 알림 권한(GROMO-2526) — iOS 이고 푸시 브리지가 든 바이너리에서만 `unavailable` 이 아니다. 아니면 알림 섹션을 그리지 않는다.
  const [pushPermission, setPushPermission] = useState<PushPermission>('unavailable');
  // 알림 행은 알림을 다시 켜는 자리다 — 권한이 허용됐는데 앱 설정 「알림」이 꺼져 있으면 함께 켠다(꺼진 채로는 푸시 동기화가
  // 등록하지 않는다). 팝업·시스템 설정을 다녀온 뒤(앞선 렌더의 클로저)에도 최신 값을 보도록 설정 값은 ref 로 읽는다.
  const pushSettingOff = useRef(false);
  pushSettingOff.current = e.state.settings.notifications === false;
  // 알림 행에서 시스템 설정으로 나갔는가 — 돌아와 다시 읽은 권한이 허용이면 앱 설정도 켠다(한 번뿐, 어느 쪽이든 지운다).
  const pushSettingsOpened = useRef(false);
  // 권한 읽기마다 번호를 매긴다(읽기를 시작할 때 올린다) — 표시는 가장 새 읽기의 결과만 정한다(옛 결과는 버린다). 눌러서 시스템
  // 설정으로 나간 때의 번호도 적어 두고, 그보다 새로 시작한 읽기만 「나감」 표시를 소비한다 — 나가기 전에 시작한 읽기가 나가
  // 있는 동안 늦게 끝나도(거부) 표시를 지우지 못해, 돌아와 읽은 허용이 앱 설정을 켠다.
  const pushReadSeq = useRef(0);
  const pushOpenedAtSeq = useRef(0);
  const enablePushSetting = () => {
    if (pushSettingOff.current) e.dispatch({ type: 'SETTING', key: 'notifications', value: true });
  };
  const unavailable = !isScreenTimeAvailable || status === 'unavailable';
  const approved = status === 'approved';
  const selectedCount = selectionCount(selection);
  const selectionDescription =
    selectionStatus === 'loading'
      ? t('settings.permissions.status.checking')
      : selectionStatus === 'error'
        ? t('settings.permissions.status.failed')
        : selection?.allApps
          ? t(
              selection.pending
                ? 'settings.permissions.status.allAppsPending'
                : 'settings.permissions.status.allApps',
            )
          : selectedCount
            ? t(
                selection?.pending
                  ? 'settings.permissions.status.selectedCountPending'
                  : 'settings.permissions.status.selectedCount',
                { count: selectedCount },
              )
            : t('settings.permissions.status.none');
  const pushDescription =
    pushPermission === 'granted'
      ? t('settings.permissions.notifications.granted')
      : pushPermission === 'denied'
        ? t('settings.permissions.notifications.denied')
        : pushPermission === 'error'
          ? t('settings.permissions.notifications.error')
          : t('settings.permissions.notifications.undetermined');
  // 누르면 일어날 일(changePush 와 같은 갈래) — 제목·부제만으로는 안 읽히니 힌트로 덧붙인다.
  const pushHint =
    pushPermission === 'undetermined'
      ? t('settings.permissions.notifications.hint.ask')
      : pushPermission === 'granted' && e.state.settings.notifications === false
        ? t('settings.permissions.notifications.hint.enable')
        : pushPermission === 'granted' || pushPermission === 'denied'
          ? t('settings.permissions.notifications.hint.openSettings')
          : pushPermission === 'error'
            ? t('settings.permissions.notifications.hint.recheck')
            : undefined;
  const permissionDescription =
    status === 'loading'
      ? t('settings.permissions.status.permissionChecking')
      : approved
        ? t('settings.permissions.connected')
        : unavailable
          ? t('settings.permissions.unavailable')
          : t('settings.permissions.needed');

  useEffect(() => {
    let active = true;
    const syncPermissionState = () => {
      if (Platform.OS === 'android' && supportsFocusShield) {
        void screenTimeNative
          ?.canDrawOverlays?.()
          .then((value) => {
            if (active) setOverlayGranted(value);
          })
          .catch(() => {});
        void screenTimeNative
          ?.getAllowedPackages?.()
          .then((value) => {
            if (active) setAllowedCount(value.length);
          })
          .catch(() => {});
      }
      const readSeq = ++pushReadSeq.current;
      void pushPermissionStatus().then((next) => {
        if (!active) return;
        if (readSeq === pushReadSeq.current) setPushPermission(next);
        // 확인하지 못한 읽기('error')·브리지 없음은 결과가 아니다 — 「나감」 표시를 소비하지 않고 다음 읽기에 넘긴다.
        if (next === 'error' || next === 'unavailable') return;
        if (!pushSettingsOpened.current || readSeq <= pushOpenedAtSeq.current) return;
        pushSettingsOpened.current = false;
        if (next === 'granted') enablePushSetting();
      });
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
        .getMeasurementSelectionForEditing()
        .then((nextSelection) => {
          if (!active) return;
          setSelection(nextSelection);
          setSelectionStatus('ready');
        })
        .catch(() => active && setSelectionStatus('error'));
    };
    if (supportsFocusShield) {
      void screenTime
        .getFocusAllowSafariWeb()
        .then((value) => {
          if (active) setAllowSafari(value);
        })
        .catch(() => {
          if (active) e.notify(t('settings.permissions.errors.safariCheck'));
        });
      void screenTime
        .getAllowedSelectionCounts()
        .then((value) => {
          if (active) setAllowedCount(selectionCount(value));
        })
        .catch(() => {
          if (active) e.notify(t('settings.permissions.errors.allowedCheck'));
        });
    }
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
      e.notify(t('settings.permissions.errors.unavailable'));
      return false;
    }
    if (busy) return;
    setBusy(true);
    try {
      await screenTime.requestAuthorization();
      const nextStatus = await screenTime.getAuthorizationStatus();
      setStatus(nextStatus);
      e.dispatch({ type: 'SETTING', key: 'permission', value: nextStatus === 'approved' });
      if (nextStatus !== 'approved')
        e.notify(
          Platform.OS === 'android'
            ? t('settings.permissions.errors.grantAndroid')
            : t('settings.permissions.errors.grantIos'),
        );
      return nextStatus === 'approved';
    } catch {
      e.notify(t('settings.permissions.errors.requestFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeConnection = async (next: boolean) => {
    if (next) {
      if (await requestConnection()) e.go('screenTimeApps', 'settings-auto');
      return;
    }
    // Family Controls 권한은 앱에서 직접 철회할 수 없어 시스템 설정으로 보낸다.
    await openSystemSettings();
  };

  const openSystemSettings = () => openScreenTimeSettings(e.notify);

  // 아직 안 물음이면 시스템 팝업, 이미 허용인데 앱 설정 「알림」만 꺼져 있으면 바로 켠다. 그 밖(거부, 끄려는 허용)은 시스템
  // 설정으로 보낸다 — 이미 정해진 알림 권한은 앱에서 바꿀 수 없다. 읽지 못했던('error') 권한은 먼저 다시 읽고, 읽힌 값으로
  // 위를 그대로 이어 간다(그래도 못 읽으면 아무것도 하지 않는다).
  const changePush = async () => {
    let current = pushPermission;
    if (current === 'error') {
      const readSeq = ++pushReadSeq.current;
      current = await pushPermissionStatus();
      if (readSeq === pushReadSeq.current) setPushPermission(current);
    }
    if (current === 'undetermined') {
      const readSeq = ++pushReadSeq.current;
      const next = await requestPushPermission();
      if (readSeq === pushReadSeq.current) setPushPermission(next);
      if (next === 'granted') enablePushSetting();
      return;
    }
    if (current === 'granted' && pushSettingOff.current) {
      enablePushSetting();
      return;
    }
    if (current !== 'granted' && current !== 'denied') return;
    pushOpenedAtSeq.current = pushReadSeq.current;
    pushSettingsOpened.current = true;
    // 알림은 Android 의 사용 정보 접근 설정과 별개다. 앱 알림 권한 화면으로 연다.
    await Linking.openSettings().catch(() =>
      e.notify(t('settings.permissions.errors.settingsOpen')),
    );
  };

  const openMeasuredApps = async () => {
    if (!(approved || (await requestConnection()))) return;
    e.go('screenTimeApps', 'settings');
  };

  if (supportsFocusShield && allowedPicker)
    return (
      <Sheet e={e} title={t('settings.permissions.sheet.allowedApps')}>
        <AndroidAppPicker
          mode="allowed"
          notify={e.notify}
          onDone={() => {
            setAllowedPicker(false);
            void screenTimeNative
              ?.getAllowedPackages?.()
              .then((value) => setAllowedCount(value.length))
              .catch(() => {});
          }}
        />
      </Sheet>
    );
  return (
    <Sheet e={e} title={t('settings.permissionManage')}>
      <Txt kind="section">{t('settings.permissions.screenTime.title')}</Txt>
      <Group>
        <Row
          title={t('settings.permissions.screenTime.connect')}
          sub={t('settings.permissions.screenTime.sub', { description: permissionDescription })}
          tail={
            <Toggle
              label={t('settings.permissions.screenTime.connect')}
              value={approved}
              disabled={busy || status === 'loading' || unavailable}
              onChange={(next: boolean) => {
                void changeConnection(next);
              }}
            />
          }
        />
        <Row
          title={t('settings.permissions.measuredApps.title')}
          sub={selectionDescription}
          accessibilityLabel={t('settings.permissions.measuredApps.a11y', {
            description: selectionDescription,
          })}
          chevron
          onPress={openMeasuredApps}
        />
      </Group>
      <Txt kind="meta">{t('settings.permissions.disconnectNote')}</Txt>
      {supportsFocusShield && (
        <>
          <Txt kind="section">{t('settings.permissions.allowed.section')}</Txt>
          <Group>
            <Row
              title={t('settings.permissions.allowed.title')}
              sub={t('settings.permissions.allowed.count', { count: allowedCount })}
              chevron
              disabled={busy}
              onPress={async () => {
                if (!(approved || (await requestConnection()))) return;
                if (Platform.OS === 'android') {
                  setAllowedPicker(true);
                  return;
                }
                setBusy(true);
                try {
                  const picked = await screenTime.presentAllowedAppManager();
                  if (picked) setAllowedCount(selectionCount(picked));
                } catch {
                  e.notify(t('settings.permissions.errors.allowedChange'));
                } finally {
                  setBusy(false);
                }
              }}
            />
            {Platform.OS === 'ios' && (
              <Row
                title={t('settings.permissions.safari.title')}
                sub={t('settings.permissions.safari.sub')}
                tail={
                  <Toggle
                    label={t('settings.permissions.safari.a11y')}
                    value={allowSafari}
                    disabled={busy || !approved}
                    onChange={async (value: boolean) => {
                      setBusy(true);
                      try {
                        await screenTime.setFocusAllowSafariWeb(value);
                        setAllowSafari(value);
                      } catch {
                        e.notify(t('settings.permissions.errors.safariChange'));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                }
              />
            )}
          </Group>
        </>
      )}
      {Platform.OS === 'android' && supportsFocusShield && (
        <Group>
          <Row
            title={t('settings.permissions.android.overlay.title')}
            sub={
              overlayGranted
                ? t('settings.permissions.android.overlay.on')
                : t('settings.permissions.android.overlay.off')
            }
            chevron
            onPress={() =>
              screenTimeNative
                ?.requestOverlayPermission?.()
                .catch(() => e.notify(t('settings.permissions.errors.overlayOpen')))
            }
          />
          <Row
            title={t('settings.permissions.android.notice.title')}
            sub={t('settings.permissions.android.notice.sub')}
            chevron
            onPress={async () => {
              if (Number(Platform.Version) >= 33) {
                const result = await PermissionsAndroid.request(
                  PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
                );
                if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
                  await Linking.openSettings();
              } else await Linking.openSettings();
            }}
          />
        </Group>
      )}
      {pushPermission !== 'unavailable' && (
        <>
          <Txt kind="section">{t('settings.notifications')}</Txt>
          <Group>
            <Row
              title={t('settings.permissions.notifications.title')}
              sub={pushDescription}
              accessibilityLabel={t('settings.permissions.notifications.a11y', {
                description: pushDescription,
              })}
              accessibilityHint={pushHint}
              chevron
              onPress={changePush}
            />
          </Group>
        </>
      )}
    </Sheet>
  );
}

function ScreenTimePermission({ e }: any) {
  const [status, setStatus] = useState<ScreenTimeAuthorization | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [requestAttempted, setRequestAttempted] = useState(false);
  const gateParts = String(e.detail).split('|');
  const boardFirst = gateParts[0] === 'board-first';
  const gateRoute = (gateParts[1] || 'board') as Route;
  const gateDetail = decodeURIComponent(gateParts[2] || '');
  const measuredApps = e.detail === 'measured-apps';
  const finish = () => {
    if (boardFirst) {
      e.replace('screenTimeApps', e.detail);
    } else {
      e.replace('screenTimeApps', 'settings-auto');
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
    if (busy) return;
    setBusy(true);
    setRequestAttempted(true);
    try {
      await screenTime.requestAuthorization();
      const next = await syncStatus();
      if (next === 'approved') finish();
    } catch {
      e.notify(t('settings.permissions.errors.requestFailed'));
    } finally {
      setBusy(false);
    }
  };
  if (status === 'loading')
    return (
      <Sheet
        e={e}
        title={t('settings.permissions.gate.title')}
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
      title={t('settings.permissions.gate.title')}
      onBack={boardFirst ? skip : undefined}
      onClose={boardFirst ? skip : undefined}
    >
      <Pic id="cat/black/sitting" w={82} />
      <Txt kind="h17">{t('settings.permissions.gate.heading')}</Txt>
      <Txt>{t('settings.permissions.gate.sub')}</Txt>
      <Group flat>
        <Row
          title={t('settings.permissions.gate.row')}
          sub={
            unavailable
              ? t('settings.permissions.gate.rowUnavailable')
              : status === 'approved'
                ? t('settings.permissions.connected')
                : status === 'denied'
                  ? t('settings.permissions.gate.rowDenied')
                  : t('settings.permissions.gate.rowNone')
          }
        />
      </Group>
      {Platform.OS === 'android' && status === 'approved' && (
        <Btn
          title={t('settings.permissions.gate.openUsage')}
          kind="sec"
          onPress={async () => {
            if (!(await screenTime.openUsageAccessSettings()))
              e.notify(t('settings.permissions.errors.usageOpenFailed'));
          }}
        />
      )}
      {status === 'approved' ? (
        <Btn
          title={
            boardFirst
              ? t('settings.permissions.measuredApps.pick')
              : measuredApps
                ? t('settings.permissions.gate.continue')
                : t('settings.permissions.gate.done')
          }
          onPress={finish}
        />
      ) : !unavailable && (status === 'denied' || requestAttempted) ? (
        <>
          <ScreenTimePermissionHelp />
          <Btn
            title={
              busy
                ? t('settings.permissions.gate.requesting')
                : t('settings.permissions.gate.retry')
            }
            disabled={busy}
            onPress={request}
          />
          <Btn
            title={t('settings.permissions.gate.openSystem')}
            kind="sec"
            disabled={busy}
            onPress={() => openScreenTimeSettings(e.notify)}
          />
          <Btn
            title={boardFirst ? t('settings.permissions.gate.laterBoard') : t('common.later')}
            kind="ghost"
            onPress={skip}
          />
        </>
      ) : unavailable ? (
        <Btn
          title={boardFirst ? t('settings.permissions.gate.openBoard') : t('common.ok')}
          onPress={skip}
        />
      ) : (
        <>
          <Btn
            title={
              busy
                ? t('settings.permissions.gate.requesting')
                : t('settings.permissions.gate.connectBtn')
            }
            disabled={busy}
            onPress={request}
          />
          {boardFirst && (
            <Btn title={t('settings.permissions.gate.laterBoard')} kind="ghost" onPress={skip} />
          )}
        </>
      )}
      <Txt kind="meta">{t('settings.permissions.gate.note')}</Txt>
    </Sheet>
  );
}

function MeasuredAppPicker({ e }: any) {
  if (Platform.OS === 'android') {
    const parts = String(e.detail).split('|');
    const finish = () => {
      if (parts[0] === 'board-first') {
        e.dispatch({ type: 'SETTING', key: 'screenTimeBoardPromptSeen', value: true });
        e.replace(parts[1] || 'board', decodeURIComponent(parts[2] || ''));
      } else e.back();
    };
    return (
      <Sheet
        e={e}
        title={t('settings.permissions.measuredApps.title')}
        onBack={finish}
        onClose={finish}
      >
        <AndroidAppPicker mode="measured" notify={e.notify} onDone={finish} />
      </Sheet>
    );
  }
  return <IOSMeasuredAppPicker e={e} />;
}

function IOSMeasuredAppPicker({ e }: any) {
  const [busy, setBusy] = useState(true);
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
      const picked = await screenTime.presentAppPicker();
      if (!picked) {
        finish();
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
        e.notify(t('settings.permissions.errors.appliedNow', { count }));
      } else {
        e.notify(t('settings.permissions.errors.appliedTomorrow', { count }));
      }
      finish();
    } catch {
      e.notify(t('settings.permissions.errors.pickerOpen'));
    } finally {
      pickerInFlight.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    // 이전 시스템 권한창·앱 화면 전환이 닫힌 뒤 한 번만 네이티브 선택기를 띄운다.
    autoTimer.current = setTimeout(openPicker, 450);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, []);
  return (
    <Sheet
      e={e}
      title={t('settings.permissions.measuredApps.title')}
      onBack={boardFirst ? finish : undefined}
      onClose={boardFirst ? finish : undefined}
    >
      {busy ? (
        <ActivityIndicator color={C.ink} />
      ) : (
        <Btn title={t('settings.permissions.measuredApps.pick')} onPress={openPicker} />
      )}
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
const visitScene = StyleSheet.create({ fill: { flex: 1 } });
// 웹 Image 는 크기를 안 주면 원본 크기로 그린다 — 오버레이 배경 칸을 꽉 채운다
const noIslandScene = StyleSheet.create({ fill: { width: '100%', height: '100%' } });
function VisitIsland({ e, onReturnFromVisit }: any) {
  const s: State = e.state,
    islandId = e.detail || s.visitingIslandId;
  // 서버 방문(GROMO-2259) — 구경하는 섬의 집중 중 인원·오늘 집중·하단 가입 버튼. 목업은 기존 화면 그대로.
  // 방문 스냅샷이 visitingIslandId 와 같은 섬의 것일 때만 쓴다 — HUD·presence·가입이 같은 섬을 본다.
  const visit = e.islands ? serverVisit(s) : null;
  const live = useIslandPresence({ active: !!visit, islandId: visit?.island.id ?? null });
  const join = useVisitorJoin(e, s, viewIsland(s, visit?.island.id ?? islandId), e.notify);
  // 섬장 인사말 말풍선(GROMO-2263) — 이번 방문(리듀서 visitGreeted)에 한 번만 띄운다. 게시판·낚시 구경에서 돌아와
  // 이 화면이 다시 마운트돼도 안 뜬다. 구서버는 greeting 이 없어 띄우지 않는다.
  const greeting = visit?.island.greeting?.trim();
  const [greetingOpen, setGreetingOpen] = useState(false);
  useEffect(() => {
    if (!greeting || s.visitGreeted) return;
    e.dispatch({ type: 'VISIT_GREETED' });
    setGreetingOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- e 는 매 렌더 새 객체다. 방문 여부(visitGreeted)만 본다
  }, [greeting, s.visitGreeted]);
  const showGreeting = greetingOpen && !!greeting;
  // 안드로이드 뒤로 가기: 인사말 팝업이 떠 있는 동안은 방문 종료(App 의 visitIsland 분기) 대신 팝업만 닫는다.
  // App 의 뒤로 가기 핸들러가 방문 분기보다 먼저 e.backOverride 를 본다(VisitorBoard 와 같은 방식).
  useEffect(() => {
    if (!showGreeting || !e.backOverride) return;
    const close = () => {
      setGreetingOpen(false);
      return true;
    };
    e.backOverride.current = close;
    return () => {
      // 이미 다른 화면이 자기 처리를 걸었으면 건드리지 않는다
      if (e.backOverride.current === close) e.backOverride.current = null;
    };
  }, [showGreeting, e.backOverride]);
  return (
    <>
      {/* 인사말 팝업이 열려 있는 동안 뒤 지도·가입 버튼은 스크린리더에서 숨긴다(DESIGN.md §11). iOS 는 팝업이 모달이라
          VoiceOver 가 이미 무시하고, 형제를 못 가리는 Android(TalkBack)를 이 래퍼가 맡는다. */}
      <View
        testID="visit-scene"
        style={visitScene.fill}
        accessibilityElementsHidden={showGreeting}
        importantForAccessibility={showGreeting ? 'no-hide-descendants' : 'auto'}
        aria-hidden={showGreeting}
      >
        <FinalIsland
          state={s}
          go={e.go}
          build={e.build}
          boardStatus={e.boardStatus}
          viewingIslandId={s.visitingIslandId ? undefined : islandId}
          notify={e.notify}
          dispatch={e.dispatch}
          onReturnFromVisit={onReturnFromVisit}
          visitHud={
            visit
              ? {
                  // HUD 는 지금 집중 중(active)만 센다. 응원 수신자는 서버 기준 진행 중(active·paused)이라 FocusVisit 와 다르다
                  focusCount:
                    live.status === 'ready'
                      ? live.focus.filter((m) => m.status === 'active').length
                      : null,
                  onFocusPress: () => e.go('visitIslandFocus', visit.island.id),
                  todayMinutes: visit.focusToday?.minutes,
                }
              : undefined
          }
          visitJoin={
            visit
              ? {
                  label: join.label,
                  disabled: join.disabled,
                  onPress: () => void join.serverJoin(),
                  // 「다시 바다로」(GROMO-2405) — 소속 섬 유무와 관계없이 구경을 끝내고 바다로. 가입하지 않은 사람에겐
                  // 뗏목 행선지와 같은 확인창을 한 번 띄운다. 소속 섬으로는 뗏목의 「< 소속 섬으로」가 있다.
                  onLeave: () =>
                    confirmLeaveVisit(e, s, visit, join, () => {
                      e.dispatch({ type: 'END_VISIT' });
                      e.reset('sea');
                    }),
                  // 가입 요청이 진행 중이면 떠나지 못하게 — 늦게 성공한 가입이 바다로 간 사용자를 홈으로 끌어오지 않게
                  leaveDisabled: join.busy,
                }
              : undefined
          }
        />
      </View>
      {showGreeting && (
        <IslandPopup onClose={() => setGreetingOpen(false)}>
          <Txt kind="meta">{t('islandVisit.greetingTitle')}</Txt>
          <Txt testID="visit-greeting" kind="h17">
            {greeting}
          </Txt>
        </IslandPopup>
      )}
    </>
  );
}
/** 응원 이모트 부채꼴 + 버튼 — 주민 집중 화면(FocusFlow)에서만 쓴다. 부모가 위치를 잡는다. `disabled` 는 지금 넘기는 곳이 없다(방문자 구경 화면에서 쓰던 모양, DESIGN.md §8.3). */
function EmoteFab({
  fan,
  setFan,
  emote,
  onSend,
  disabled = false,
  onDisabledPress,
}: {
  fan: boolean;
  setFan: (v: boolean) => void;
  emote: string | null;
  onSend: (id: string) => void;
  /** 보낼 수 없는 상태 — 흐리게 그리고, 누르면 부채꼴 대신 onDisabledPress(안내)만 부른다. */
  disabled?: boolean;
  onDisabledPress?: () => void;
}) {
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
  // 비활성이 되는 순간 접는다 — 부채꼴은 숨겨도 fan 이 true 로 남으면 다시 활성이 될 때 저절로 펼쳐진다.
  useEffect(() => {
    if (disabled) setFan(false);
  }, [disabled, setFan]);
  return (
    <>
      {fan && !disabled && (
        <View style={{ position: 'absolute', left: 0, bottom: 64, flexDirection: 'row', gap: 6 }}>
          {['hello', 'cheer', 'sleepy', 'laugh', 'hearts'].map((id) => (
            <Pressable
              key={id}
              testID={`emote-${id}`}
              accessibilityRole="button"
              accessibilityLabel={t(`focusFlow.hud.emote.${id}`)}
              onPress={() => onSend(id)}
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
        accessibilityHint={disabled ? t('focusFlow.hud.emoteNoOneFocusing') : undefined}
        accessibilityState={{ expanded: fan, disabled }}
        onPress={() => (disabled ? onDisabledPress?.() : setFan(!fan))}
        style={[
          circle(52, C.butter),
          disabled && { opacity: componentTokens.button.disabledOpacity, boxShadow: 'none' },
        ]}
      >
        <Image source={art[`emote/${emote ?? 'hello'}`]} style={{ width: 32, height: 32 }} />
      </Pressable>
    </>
  );
}
/** 방문 낚시 구경이 주민 스냅숏(외양 포함)을 다시 읽는 간격. */
const VISIT_RESYNC_MS = 30_000;
function FocusVisit({ e, islandId, onBack }: any) {
  const s: State = e.state,
    i = viewIsland(s, islandId ?? s.serverIslands?.currentIslandId ?? s.islandId),
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
  // 방문자는 응원을 보내지도 받지도 않는다(2026-10-16 결정) — visitor 를 넘기지 않아 emotes 채널을 열지 않는다.
  // 서버의 방문자 경로(GROMO-2258)는 남아 있지만 앱이 노출하지 않는다.
  const live = useIslandPresence({
    active: liveIslandId !== null,
    islandId: liveIslandId,
    // 방문(islandId 있음)은 주민이 아니라 구독하면 ERROR 로 소켓이 닫힌다 — 내 소속 섬 보기에서만 켠다
    events: !islandId,
    onMemberArrived: (event) => e.notify(memberArrivedText(event)),
    onSendError: e.notify,
    onTransition: (transition) => transitionHandler.current(transition),
  });
  // 다른 섬 방문은 소속원이 아니라 events 토픽(member.appearance.updated)을 구독할 수 없다(서버: 소속 주민만, 아니면 ERROR+연결 종료).
  // 그래서 방문 화면은 focus-members 를 주기적으로 다시 읽어 갈아입은 외양을 반영한다.
  const resyncLive = live.resync;
  useEffect(() => {
    if (!visiting || liveIslandId === null) return;
    const id = setInterval(resyncLive, VISIT_RESYNC_MS);
    return () => clearInterval(id);
  }, [visiting, liveIslandId, resyncLive]);
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
          seat: m.seat,
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
  // 누른 주민 정보창(GROMO-2474) — 누른 순간의 모습을 쥔다(그 사이 자리를 떠나도 창은 그대로)
  const [catInfo, setCatInfo] = useState<FishingCatInfoTarget | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <FishingIsland
        focus={{ x: 50, y: 50 }}
        spots={spots}
        onRaft={close}
        raftLabel={visiting ? t('focusFlow.common.raftLabelVisiting') : undefined}
        gram={i.buildings.includes('gram')}
        inert={!!catInfo}
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
          return peers.map((actor) => {
            const outfit = lookOf(
              live.looks,
              actor.userId,
              live.focus.find((m) => m.userId === actor.userId),
            );
            return (
              <FishingPeerActorView
                key={actor.key}
                actor={{ ...actor, subject: shown.has(actor.key) ? actor.subject : null }}
                outfit={outfit}
                size={size}
                sizeY={sizeY}
                reduce={reduce}
                onEntered={peerFlow.entered}
                onCast={peerFlow.cast}
                onPausedExit={peerFlow.leftForPause}
                onStretch={peerFlow.stretched}
                onCompletedExit={peerFlow.leftForComplete}
                onPress={() => setCatInfo({ actor, outfit })}
              />
            );
          });
        }}
      </FishingIsland>
      <View
        {...a11yHidden(!!catInfo)}
        style={{
          position: 'absolute',
          zIndex: 30,
          top: L.landscape ? Math.max(14, safe.top + 8) : Math.max(64, safe.top + 12),
          left: Math.max(18, safe.left + 8),
        }}
      >
        {/* 건물 안과 같은 ‹ 동그라미(DESIGN §7.14). 내 낚시섬은 홈(e.home), 구경은 그 섬 지도(visitMap)로 — 둘 다 섬으로 돌아간다 */}
        <NavBtn
          testID="close-focus-visit"
          label={t('focusFlow.common.backToIsland')}
          onPress={close}
        />
      </View>
      {liveIslandId && live.status === 'loading' ? (
        <View
          pointerEvents="none"
          {...a11yHidden(!!catInfo)}
          style={[
            StyleSheet.absoluteFill,
            { zIndex: 5, alignItems: 'center', justifyContent: 'center' },
          ]}
        >
          <ActivityIndicator color={INK} />
        </View>
      ) : liveIslandId && live.status === 'error' ? (
        <View
          {...a11yHidden(!!catInfo)}
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
          {...a11yHidden(!!catInfo)}
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
      {catInfo && <FishingCatInfo target={catInfo} onClose={() => setCatInfo(null)} />}
    </View>
  );
}
type FishingCatInfoTarget = { actor: FishingPeerActor; outfit?: Outfit };
/** 집중섬 다른 주민 정보창(GROMO-2474) — 낚시 자리와 같은 낚시 자세로 그린다. 주민 집중·낚시 구경이 같이 쓴다. */
function FishingCatInfo({
  target,
  onClose,
}: {
  target: FishingCatInfoTarget;
  onClose: () => void;
}) {
  const { actor, outfit } = target;
  return (
    <CatInfoPopup
      key={actor.userId}
      userId={actor.userId}
      name={actor.name}
      catColor={actor.color}
      art={
        <FishingCatArt
          spot={actor.spot}
          color={actor.color}
          outfit={outfit}
          size={componentTokens.catInfoPopup.catSize}
        />
      }
      onClose={onClose}
    />
  );
}
function FocusVolume({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [width, setWidth] = useState(1);
  const latest = useRef({ value, onChange, width });
  latest.current = { value, onChange, width };
  const setFromTouch = (locationX: number) =>
    latest.current.onChange(Math.max(0, Math.min(1, locationX / latest.current.width)));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => setFromTouch(event.nativeEvent.locationX),
      onPanResponderMove: (event) => setFromTouch(event.nativeEvent.locationX),
    }),
  ).current;
  const thumbSize = semanticTokens.spacing.section;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={t('focusFlow.music.deviceVolume')}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        onChange(
          Math.max(
            0,
            Math.min(1, value + (event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)),
          ),
        )
      }
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...pan.panHandlers}
      style={{ height: semanticTokens.size.tapMin, justifyContent: 'center' }}
    >
      <View
        style={{
          height: componentTokens.progress.height,
          borderRadius: semanticTokens.radius.full,
          backgroundColor: componentTokens.progress.track,
        }}
      >
        <View
          style={{
            height: componentTokens.progress.height,
            width: `${value * 100}%`,
            borderRadius: semanticTokens.radius.full,
            backgroundColor: componentTokens.progress.fill,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: width * value - thumbSize / 2,
          top: (semanticTokens.size.tapMin - thumbSize) / 2,
          width: thumbSize,
          height: thumbSize,
          borderRadius: semanticTokens.radius.full,
          borderWidth: semanticTokens.stroke.strong,
          borderColor: semanticTokens.color.outline,
          backgroundColor: semanticTokens.color.surface,
        }}
      />
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
  // 낚시섬의 내 고양이에 입힐 장착 그림(GROMO-2382)
  const myOutfit = outfitOf(s);
  const screenReader = useScreenReaderEnabled();
  const advanceTutorial = (from: number, to: number) => {
    if (tutorialStep === from)
      e.setGuideStep(to, { step: from, revision: s.tutorialRevision ?? 0 });
  };
  const setupInputTarget = useSpotlightTarget(tutorialStep === 7),
    setupStartTarget = useSpotlightTarget(tutorialStep === 8),
    pauseTarget = useSpotlightTarget(tutorialStep === 14),
    endTarget = useSpotlightTarget(tutorialStep === 17 || tutorialStep === 18),
    resultTarget = useSpotlightTarget(tutorialStep === 21);
  const [fan, setFan] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [dialog, setDialog] = useState<'music' | 'reward' | null>(null),
    [soundPurchase, setSoundPurchase] = useState<{
      kind: 'confirm' | 'success' | 'error';
      product: any;
    } | null>(null),
    // 누른 주민 정보창(GROMO-2474)
    [catInfo, setCatInfo] = useState<FishingCatInfoTarget | null>(null),
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
  const [verificationPreviewOpen, setVerificationPreviewOpen] = useState(false);
  const returningFromArrival = useRef(false);
  // 보상을 확인하는 동안에도 결과 화면에서 고른 다음 목적지를 유지한다.
  const resultDestination = useRef<'island' | 'focus'>('island');
  useEffect(() => {
    if (r !== 'fishingArrival') returningFromArrival.current = false;
  }, [r]);
  // 자리 고르기·집중 화면을 떠나면(준비·휴식·결과) 열린 정보창을 닫는다
  useEffect(() => setCatInfo(null), [r]);
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
  const musicRoute = ['fishingArrival', 'focusSetup', 'focus'].includes(r);
  // 집중섬 축음기는 세션 시작 전에도 구매·곡 변경이 가능하다. 일반 섬 축음기와 달리
  // 판매 목록·공동 인벤토리·지갑을 함께 읽되, 실제 기기 재생은 App 의 active 세션 gate 가 맡는다.
  const focusShop = useShop({
    active: !!e.islands && musicRoute && i.buildings.includes('gram'),
    islandId: liveIslandId,
    route: 'sound',
    category: 'personal',
    orderScope: 'personal',
    productId: null,
    dispatch: e.dispatch,
  });
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
    events: true, // 내 소속 섬 화면 — 주민만 구독할 수 있다(GROMO-2311)
    onMemberArrived: (event) => e.notify(memberArrivedText(event)),
    onSendError: e.notify,
    // 방문자가 보낸 응원은 말풍선 대신 알림으로 — 이름은 서버가 주지 않는다
    onVisitorEmote: () => e.notify(t('focusFlow.visitorCheered')),
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
    const own = () => backRef.current();
    e.backOverride.current = own;
    return () => {
      // 이미 다른 화면이 자기 처리를 걸었으면 건드리지 않는다
      if (e.backOverride.current === own) e.backOverride.current = null;
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
    if (tutorialStep === 11) return;
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
          advanceTutorial(tutorialStep === 17 ? 17 : 18, 19);
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
    advanceTutorial(tutorialStep === 17 ? 17 : 18, 19);
    e.reset('focusResult');
  };
  // 내 자리: 진행 중 세션은 서버가 기억한 내 seat 가 정본 — 다른 기기에서 시작한 세션을 복구하면 focusSpot 은 지난
  // 세션 좌표다(SESSION_SYNC 는 focusSpot 을 바꾸지 않음). 내 항목은 아래 peerMembers 에서 거르므로 거르기 전에 꺼낸다.
  // 서버 seat 가 없으면(옛 앱으로 시작) 로컬 focusSpot, 없거나 유효하지 않으면 보상을 놓을 수 있는 기본 자리로 대신한다
  const liveSeat = s.session
    ? live.focus.find((m) => m.userId === myId && m.sessionId === s.session?.id)?.seat
    : null;
  // 결과 화면·다른 기기 종료(SESSION_SYNC 가 세션을 먼저 지움)에선 서버가 내 항목을 지우므로 이번 세션에서 마지막으로
  // 받은 seat 를 이어 쓴다. 세션 id 를 알면 일치할 때만, 모르면(세션·결과 id 없음) 그대로 — 새 세션은 자리 고르기·준비를
  // 거치며 비운다
  const lastServerSeat = useRef<{ sessionId: string; seat: Point } | null>(null);
  // 서버는 0~100 범위만 검사하므로 물 위 seat 는 쓰지 않고 로컬 focusSpot/DEFAULT_SPOT 으로 대체한다
  if (s.session && liveSeat && onLand(fishingGrid, liveSeat))
    lastServerSeat.current = { sessionId: s.session.id, seat: liveSeat };
  else if (r === 'focusSetup' || r === 'fishingArrival') lastServerSeat.current = null;
  const knownSessionId = s.session?.id ?? resultSessionId,
    serverSeat =
      (r === 'focus' || r === 'rest' || r === 'focusResult') &&
      lastServerSeat.current &&
      (knownSessionId == null || lastServerSeat.current.sessionId === knownSessionId)
        ? lastServerSeat.current.seat
        : null,
    localSpot = s.focusSpot && s.focusSpot.x <= 100 && s.focusSpot.y <= 100 ? s.focusSpot : null,
    // 격자가 바뀌기 전(티켓 2516)에 고른 자리는 물·나무·바위 칸일 수 있다 — 가장 가까운 걸을 수 있는 칸에 앉힌다
    minePoint =
      serverSeat ??
      (localSpot
        ? onLand(fishingGrid, localSpot)
          ? localSpot
          : nearestLand(fishingGrid, localSpot)
        : DEFAULT_SPOT),
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
          seat: m.seat,
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
    // 내 자리는 이번 흐름에서 고른 뒤(준비·집중·휴식·결과)에만 비켜 준다 — 자리 고르기 중의 focusSpot 은
    // 지난 세션 좌표라 예약하면 그 자리에 앉은 주민의 seat 가 밀려난다
    mine:
      r === 'focusSetup' || r === 'focus' || r === 'rest' || r === 'focusResult'
        ? minePoint
        : undefined,
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
    canRestartFocus =
      !!result &&
      !s.session &&
      !experience &&
      !(tutorialStep >= 5 && tutorialStep <= 21) &&
      !!(s.serverIslands ? s.serverIslands.currentIslandId : i.joined),
    leave = () => {
      const navigate = () => {
        clearVerificationResult(result?.id);
        // 자동 종료 결과는 닫을 때 acknowledge — 확인 전까지 서버가 계속 돌려주므로 실패해도 잃지 않는다
        if (result?.ackId) e.focus?.acknowledge(result.ackId).catch(() => {});
        if (resultDestination.current === 'focus' && canRestartFocus) {
          setDialog(null);
          setError('');
          // 복구한 서버 자리도 새 준비 화면에 이어 쓴다. 실제 새 세션은 시작 버튼에서 만든다.
          e.dispatch({ type: 'FOCUS_SPOT', spot: minePoint });
          e.reset('focusSetup');
          // reset이 입력을 비우므로 과목은 화면을 바꾼 뒤 채운다.
          e.setText(result?.subject ?? '');
          return;
        }
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
    // 결과 다음에 새로 받은 보상이 있으면 보상받기 모달, 없으면 선택한 목적지로.
    // 서버 경로는 회차 목록 로딩 중이거나 수령 가능한 퀘스트가 있으면 모달을 연다 —
    // 로딩이 끝났는데 받을 게 없으면 모달 스스로 닫힌다.
    done = (destination: 'island' | 'focus' = 'island') => {
      resultDestination.current = destination;
      return serverQuests
        ? boardQ.loading || boardQ.quests.some((q) => q.claimable)
          ? setDialog('reward')
          : leave()
        : s.rewards?.some((x) => !x.acknowledged)
          ? setDialog('reward')
          : leave();
    },
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
  const returnFromArrival = () => {
    if (
      r !== 'fishingArrival' ||
      returningFromArrival.current ||
      (tutorialStep >= 5 && tutorialStep <= 21) ||
      goldenCutsceneRef.current ||
      goldenQueueTimerRef.current
    )
      return;
    // 자리로 걷던 중에도 귀환할 수 있다. 기존 걷기 콜백을 취소하고 뗏목으로 향한다.
    returningFromArrival.current = true;
    const sail = () => latest.current.r === 'fishingArrival' && e.go('returnTravel');
    if (!walkTo(LANDING, sail)) sail();
  };
  const activeFocus = r === 'focus' && s.session?.status === 'active' && !leg;
  const focusAudioProducts: any[] = e.islands
    ? focusShop.items
    : products.filter((product) => product.kind === 'audio');
  const focusOwnedTrackIds = (
    e.islands && focusShop.shared ? focusShop.shared.audio : i.sharedOwned
  ).filter(hasBundledAudio);
  const focusTrackIds = [
    ...focusOwnedTrackIds,
    ...focusAudioProducts
      .map((product) => product.id)
      .filter((id) => !focusOwnedTrackIds.includes(id)),
  ];
  const focusTrackLabel = (id: string) =>
    trackNames[id] ??
    focusShop.titles[id] ??
    focusAudioProducts.find((p) => p.id === id)?.title ??
    id;
  const changeFocusTrack = async (trackId: string) => {
    if (!e.playback) {
      e.dispatch({ type: 'TRACK_SELECT', value: trackId });
      return true;
    }
    try {
      // 곡 선택과 재생은 별개다. 집중 전에도 선택할 수 있지만 실제 재생은 active 집중에서만 한다.
      await e.playback.update({ trackId });
      return true;
    } catch (thrown) {
      e.notify(errorTextOr(thrown, 'focusFlow.music.changeFailed'));
      return false;
    }
  };
  const changeFocusPlaying = async (playing: boolean) => {
    if (!activeFocus) return;
    if (!e.playback) {
      e.dispatch({ type: 'PLAY', value: playing });
      return;
    }
    try {
      await e.playback.update({ playing });
    } catch (thrown) {
      e.notify(errorTextOr(thrown, 'focusFlow.music.changeFailed'));
    }
  };
  const buyFocusTrack = async () => {
    const product = soundPurchase?.product;
    if (!product) return;
    if (e.islands) {
      try {
        await focusShop.buy(product);
        setSoundPurchase({ kind: 'success', product });
      } catch (thrown) {
        if (e.conversion?.offer(thrown)) {
          setSoundPurchase(null);
          return;
        }
        if (thrown instanceof ApiError && thrown.code === 'INSUFFICIENT_FUNDS') {
          setSoundPurchase({ kind: 'error', product });
          return;
        }
        setSoundPurchase(null);
        e.notify(errorTextOr(thrown, 'focusFlow.music.purchaseFailed'));
      }
      return;
    }
    if (canBuy(s, product)) {
      setSoundPurchase({ kind: 'error', product });
      return;
    }
    e.dispatch({ type: 'BUY', id: product.id });
    setSoundPurchase({ kind: 'success', product });
  };
  const closeMusic = () => {
    setSoundPurchase(null);
    setDialog(null);
  };
  const musicHintStyle = {
    fontSize: semanticTokens.typography.label,
    lineHeight: semanticTokens.typography.label * 1.6,
    color: semanticTokens.color.textMuted,
  };
  const musicModal =
    dialog === 'music' && !goldenReeling ? (
      <FiModal>
        <Text
          style={[
            fiTitle(semanticTokens.typography.title),
            { marginBottom: semanticTokens.spacing.control },
          ]}
        >
          {t('focusFlow.music.title')}
        </Text>
        <Text
          style={[
            musicHintStyle,
            {
              marginBottom: wide
                ? semanticTokens.spacing.control
                : semanticTokens.spacing.component,
            },
          ]}
        >
          {t(activeFocus ? 'focusFlow.music.activeSubtitle' : 'focusFlow.music.inactiveSubtitle')}
        </Text>
        {soundPurchase ? (
          <View style={{ gap: semanticTokens.spacing.control }}>
            <Text style={[fiTitle(semanticTokens.typography.title), { textAlign: 'center' }]}>
              {soundPurchase.kind === 'confirm'
                ? t('focusFlow.music.purchaseConfirm', { title: soundPurchase.product.title })
                : soundPurchase.kind === 'success'
                  ? t('focusFlow.music.purchaseSuccess')
                  : t('focusFlow.music.insufficientFish')}
            </Text>
            {soundPurchase.kind === 'confirm' && (
              <Text style={[musicHintStyle, { textAlign: 'center' }]}>
                {t('focusFlow.music.sharedPurchaseHint')}
              </Text>
            )}
            {soundPurchase.kind === 'confirm' ? (
              <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                <FiButton
                  title={t('common.cancel')}
                  style={{ flex: 1 }}
                  onPress={() => setSoundPurchase(null)}
                />
                <FiButton
                  primary
                  title={t('focusFlow.music.buyForFish', {
                    price: soundPurchase.product.price,
                  })}
                  style={{ flex: 1 }}
                  onPress={buyFocusTrack}
                />
              </View>
            ) : soundPurchase.kind === 'success' ? (
              <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                <FiButton
                  title={t('common.later')}
                  style={{ flex: 1 }}
                  onPress={() => setSoundPurchase(null)}
                />
                <FiButton
                  primary
                  title={t('focusFlow.music.switchTrack')}
                  style={{ flex: 1 }}
                  onPress={async () => {
                    if (!(await changeFocusTrack(soundPurchase.product.id))) return;
                    setSoundPurchase(null);
                  }}
                />
              </View>
            ) : (
              <FiButton primary title={t('common.ok')} onPress={() => setSoundPurchase(null)} />
            )}
          </View>
        ) : (
          <>
            {activeFocus && (
              <View
                style={{
                  gap: semanticTokens.spacing.control,
                  marginBottom: semanticTokens.spacing.control,
                }}
              >
                <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                  <FiButton
                    primary={i.playing}
                    title={t('focusFlow.music.play')}
                    style={{ flex: 1 }}
                    onPress={() => void changeFocusPlaying(true)}
                  />
                  <FiButton
                    primary={!i.playing}
                    title={t('focusFlow.music.stop')}
                    style={{ flex: 1 }}
                    onPress={() => void changeFocusPlaying(false)}
                  />
                </View>
                <View>
                  <Text style={musicHintStyle}>{t('focusFlow.music.deviceVolume')}</Text>
                  <FocusVolume
                    value={s.settings.volume ?? 0.55}
                    onChange={(value) => e.dispatch({ type: 'SETTING', key: 'volume', value })}
                  />
                </View>
              </View>
            )}
            {e.islands && focusShop.error ? (
              <View style={{ gap: semanticTokens.spacing.control }}>
                <Text style={musicHintStyle}>{t('focusFlow.music.loadFailed')}</Text>
                <FiButton title={t('common.retry')} onPress={focusShop.retry} />
              </View>
            ) : e.islands && focusShop.loading ? (
              <Text style={musicHintStyle}>{t('focusFlow.music.loading')}</Text>
            ) : (
              <View style={{ gap: semanticTokens.spacing.control }}>
                {focusTrackIds.map((id) => {
                  const owned = focusOwnedTrackIds.includes(id);
                  const product = focusAudioProducts.find((item) => item.id === id);
                  const bundled = BUNDLED_AUDIO_TRACK_IDS.includes(
                    id as (typeof BUNDLED_AUDIO_TRACK_IDS)[number],
                  );
                  if (
                    !owned &&
                    (!bundled || product?.available === false || product?.price == null)
                  )
                    return null;
                  const status = owned
                    ? DEFAULT_FREE_AUDIO_TRACK_IDS.includes(id)
                      ? t('focusFlow.music.free')
                      : t('focusFlow.music.owned')
                    : t('focusFlow.music.buyForFish', { price: product.price });
                  return (
                    <FiButton
                      key={id}
                      left
                      primary={owned && i.track === id}
                      title={`${focusTrackLabel(id)} · ${status}`}
                      onPress={() => {
                        if (owned) void changeFocusTrack(id);
                        else setSoundPurchase({ kind: 'confirm', product });
                      }}
                    />
                  );
                })}
              </View>
            )}
            <View
              style={{
                marginTop: wide ? semanticTokens.spacing.control : semanticTokens.spacing.component,
              }}
            >
              <FiButton primary title={t('focusFlow.music.backToSpot')} onPress={closeMusic} />
            </View>
          </>
        )}
      </FiModal>
    ) : null;
  // 뒤로가기: 자리 선택 중에는 귀환하고, 나머지 걷기·항해 중에는 막는다. 모달은 닫기만, 결과는 '확인'(보상·귀환 흐름)과 같게, 모닥불은 '집중 이어가기'와 같게
  backRef.current = () => {
    if (tutorialStep >= 5 && tutorialStep <= 21) return true;
    if (goldenCutsceneRef.current || goldenQueueTimerRef.current) return true;
    if (r === 'fishingArrival') {
      returnFromArrival();
      return true;
    }
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
    if (soundPurchase) {
      setSoundPurchase(null);
      return true;
    }
    if (dialog) {
      closeMusic();
      return true;
    }
    if (r === 'focusResult') {
      done();
      return true;
    }
    if (r === 'rest' && s.session?.status === 'paused') {
      resume();
      return true;
    }
    if (r === 'focus' && s.session) {
      e.notify(t('focusFlow.common.holdEndHint'));
      return true;
    }
    return false;
  };
  if (r === 'focusTravel')
    return (
      <DepartureStory
        color={s.color}
        outfit={s.equipped}
        destination={t('focusFlow.common.fishingIsland')}
        onComplete={() => e.replace('fishingArrival')}
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
  // 정해진 자리 없음: 땅을 누르면 걸어가기만 하고, 하단 [집중 시작]을 누른 자리에서 집중할 수 있는지 본다.
  const spotError = (p: Point): string | null => {
    const problem = seatProblem(p, peerSpots, i.buildings.includes('gram'));
    return problem ? t(`focusFlow.spot.${problem}`) : null;
  };
  // 물·이어지지 않은 땅은 홈 섬처럼 조용히 무시한다. 걷는 중 다시 누르면 지금 위치에서 새 목적지로.
  const walkOnly = (p: Point) => {
    if (returningFromArrival.current || !onLand(fishingGrid, p)) return;
    walkTo(p, () => {});
  };
  // 자리 검사 → 자리 저장 → 준비 카드. 실패하면 이유만 알리고 제자리.
  const startAt = (p: Point) => {
    if (returningFromArrival.current || latest.current.r !== 'fishingArrival') return;
    const error = spotError(p);
    if (error) {
      e.notify(error);
      return;
    }
    e.dispatch({ type: 'FOCUS_SPOT', spot: p });
    advanceTutorial(5, 7);
    advanceTutorial(6, 7);
    e.go('focusSetup');
  };
  // [집중 시작]: 걷는 중이면 그 자리에 멈춰 선 채로 검사한다.
  const startHere = () => {
    // 뗏목으로 돌아가는 중이면 귀환 걷기를 끊지 않는다(끊으면 귀환 콜백이 사라져 화면에 갇힌다)
    if (returningFromArrival.current) return;
    if (walker.walking) {
      walkingToken.current++;
      setWalker((w) => ({ ...w, walking: false }));
    }
    startAt(position.current);
  };
  // 스크린리더: 걸어갈 수 있는 빈 땅을 골라 걸어간 뒤 바로 준비 카드까지 연다.
  const selectAccessibleSpot = () => {
    // 뗏목으로 돌아가는 중이면 귀환 걷기를 끊지 않는다(startHere 와 같은 이유)
    if (returningFromArrival.current) return;
    const spot = findReachableTutorialSpot(
      fishingGrid,
      walker.p,
      DEFAULT_SPOT,
      (p) => !spotError(p),
    );
    if (!spot) {
      e.notify(t('focusFlow.spot.noneFound'));
      return;
    }
    // 걸어갈 길이 없는 곳(뗏목 쪽 땅과 이어지지 않은 땅)
    if (!walkTo(spot, () => startAt(spot))) e.notify(t('focusFlow.spot.unreachable'));
  };
  // 뗏목: 자리 고르기에서는 뗏목까지 걸어가 본인만 우리 섬으로, 집중 중에는 집중 종료 확인.
  const raft = () => {
    if (tutorialStep >= 5 && tutorialStep <= 21) return;
    if (r === 'fishingArrival') {
      returnFromArrival();
    } else if (r === 'focus' && s.session && !leg) e.notify(t('focusFlow.common.holdEndHint'));
  };
  const start = () => {
    const subject = e.text.trim() || t('focusFlow.setup.defaultSubject');
    Keyboard.dismiss();
    if (!e.focus && !i.joined) {
      e.notify(t('focusFlow.setup.needsIsland'));
      e.replace('sea');
      return;
    }
    if (e.focus) {
      // 서버 세션 — islandId·멱등 키·복구는 명령이 챙긴다. 시작 성공 뒤에만 낚시 화면으로 간다.
      // 고른 자리(focusSpot)를 함께 보내 다른 주민 화면에도 같은 자리에 앉는다(GROMO-2478)
      setError('');
      e.focus
        .start({ subject, seat: s.focusSpot })
        .then(() => {
          advanceTutorial(8, 9);
          e.go('focus');
        })
        .catch((error: any) => setError(errorTextOr(error, 'focusFlow.setup.startFailed')));
      return;
    }
    e.dispatch({ type: 'START', subject });
    advanceTutorial(8, 9);
    e.go('focus');
  };
  const finishInput = () => {
    Keyboard.dismiss();
    e.setGuideStep(8);
  };
  const closeSetup = () => {
    Keyboard.dismiss();
    setError('');
    if (tutorialStep === 7 || tutorialStep === 8) e.setGuideStep(5);
    e.replace('fishingArrival');
  };
  const skipTutorial = () => e.setGuideStep(99);
  const finishResult = () => {
    if (tutorialStep === 21) e.setGuideStep(22);
    done();
  };
  // 결과창의 퀘스트는 집중을 마친 날 회차 기준(자정을 넘겨 봐도 그날 달성이 남는다)
  const resultAt = result?.at ?? e.now,
    resultDay = dayKey(resultAt),
    focusQuests = i.quests.filter((q) => q.type === 'focus'),
    achieved = focusQuests.filter((q) => q.rounds?.[resultDay]?.achieved.includes('me'));
  const achievedQuestTitles = serverQuests
    ? boardQ.quests.filter((q) => q.claimable || q.claimed).map((q) => q.title)
    : achieved.map((q) => q.title);
  const resultModal = (
    <FiModal
      hidden={dialog === 'reward'}
      footer={
        <View style={{ gap: semanticTokens.spacing.control }}>
          {canRestartFocus && (
            <FiButton
              primary
              id="result-restart"
              multiline
              title={t('focusFlow.result.restart')}
              onPress={() => done('focus')}
            />
          )}
          <View ref={resultTarget.ref} collapsable={false} onLayout={resultTarget.measure}>
            <FiButton
              primary={!canRestartFocus}
              id="result-done"
              multiline
              title={
                s.resultFromRest || tutorialStep === 21
                  ? t('focusFlow.common.backToIsland')
                  : t('focusFlow.result.backByBoat')
              }
              onPress={finishResult}
            />
          </View>
        </View>
      }
    >
      <FocusResultSummary
        subject={result?.subject ?? t('focusFlow.result.defaultSubject')}
        seconds={result?.seconds ?? 0}
        verifiedSeconds={
          VERIFY_SPIKE ? verificationResult(result?.id, result?.seconds ?? 0) : undefined
        }
        fish={result?.fish ?? 0}
        questTitles={achievedQuestTitles}
        recordId={result?.id}
        // 집중 보상은 세션당 최대 1개다(2301 정산) — 첫 아이템만 보인다
        rewardId={result?.rewards?.[0]}
        rewardNew={!!result?.rewards && !!result.newRewards?.includes(result.rewards[0])}
      />
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
          {screenReader ? (
            <Btn title={t('focusFlow.spot.sitEmptyButton')} onPress={selectAccessibleSpot} />
          ) : (
            <FiButton
              title={t('focusFlow.spot.start')}
              id="focus-start"
              primary
              onPress={startHere}
            />
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
            title={t(e.text.trim() ? 'focusFlow.tutorial.step7Done' : 'focusFlow.setup.skip')}
            small
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
    if (r === 'focus' && (tutorialStep === 17 || tutorialStep === 18))
      return (
        <TutorialSpotlight target={endTarget.rect} text={t('focusFlow.tutorial.step17')}>
          {(screenReader || !endTarget.rect) && (
            <FiButton
              title={t('focusFlow.common.endFocus')}
              holdToConfirm
              haptics={s.settings.haptics}
              onPress={finish}
            />
          )}
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
  const focusing = activeFocus,
    mySubject = r === 'focusSetup' ? null : (s.session?.subject ?? result?.subject ?? null);
  const verificationIntro =
    s.focusGuideDone && !experience && !dialog && !catInfo && !leg && !voyage && !goldenCutscene
      ? 'automatic'
      : undefined;
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
            <Pressable
              testID="close-focus-setup"
              accessibilityRole="button"
              accessibilityLabel={t('focusFlow.setup.close')}
              onPress={closeSetup}
              style={{
                minWidth: semanticTokens.size.tapMin,
                minHeight: semanticTokens.size.tapMin,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={fiTitle(semanticTokens.typography.title)}>×</Text>
            </Pressable>
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
            <View
              ref={setupStartTarget.ref}
              collapsable={false}
              onLayout={setupStartTarget.measure}
              style={{ flex: 1 }}
            >
              <FiButton
                primary
                title={t(e.text.trim() ? 'focus.start' : 'focusFlow.setup.skipAndStart')}
                id="start-focus"
                onPress={start}
              />
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
          onTap={r === 'fishingArrival' ? walkOnly : undefined}
          onSitAccessible={r === 'fishingArrival' ? selectAccessibleSpot : undefined}
          onRaft={raft}
          gram={i.buildings.includes('gram')}
          onGram={musicRoute ? () => setDialog('music') : undefined}
          seated={seated}
          inert={!!dialog || r === 'focusResult' || !!goldenCutscene || !!catInfo}
          overlayBlocksMap={r === 'focusSetup'}
          overlay={
            r === 'focusSetup'
              ? setup
              : r === 'fishingArrival' && !(tutorialStep >= 5 && tutorialStep <= 21)
                ? (toScreen) => (
                    <>
                      <View
                        testID="focus-arrival-hint"
                        pointerEvents="none"
                        accessibilityLiveRegion="polite"
                        style={{
                          position: 'absolute',
                          top: Math.min(
                            toScreen({ x: 50, y: 100 }).y + semanticTokens.spacing.control,
                            (boxHeight || L.height) -
                              safe.bottom -
                              componentTokens.focusArrival.bottomReserve,
                          ),
                          left: safe.left + semanticTokens.spacing.page,
                          right: safe.right + semanticTokens.spacing.page,
                        }}
                      >
                        <Text
                          style={{
                            ...hudText,
                            textAlign: 'center',
                            fontSize: componentTokens.focusArrival.fontSize,
                            lineHeight: componentTokens.focusArrival.lineHeight,
                            fontWeight: componentTokens.focusArrival.fontWeight,
                          }}
                        >
                          {t('focusFlow.spot.pickPrompt')}
                        </Text>
                      </View>
                      {/* 하단 [집중 시작]: 지금 선 자리에서 집중할 수 있는지 검사해 준비 카드를 연다 */}
                      <View
                        testID="focus-start-bar"
                        pointerEvents="box-none"
                        style={{
                          position: 'absolute',
                          bottom: safe.bottom + semanticTokens.spacing.page,
                          left: safe.left + semanticTokens.spacing.page,
                          right: safe.right + semanticTokens.spacing.page,
                          alignItems: 'center',
                        }}
                      >
                        <FiButton
                          title={t('focusFlow.spot.start')}
                          id="focus-start"
                          primary
                          onPress={startHere}
                        />
                      </View>
                    </>
                  )
                : undefined
          }
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
                {focusing && (
                  <FishingFocusHud
                    subject={s.session!.subject}
                    seconds={sessionSeconds(s.session, e.now)}
                    size={size}
                    sizeY={sizeY}
                    textStyle={hudText}
                  />
                )}
                {peers.map((actor) => {
                  const outfit = lookOf(
                    live.looks,
                    actor.userId,
                    live.focus.find((m) => m.userId === actor.userId),
                  );
                  return (
                    <FishingPeerActorView
                      key={actor.key}
                      actor={{ ...actor, subject: shown.has(actor.key) ? actor.subject : null }}
                      outfit={outfit}
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
                      onPress={
                        (r === 'focus' || r === 'fishingArrival') && !dialog
                          ? () => setCatInfo({ actor, outfit })
                          : undefined
                      }
                    />
                  );
                })}
                {seated ? (
                  <FishingActor
                    spot={mine}
                    size={size}
                    sizeY={sizeY}
                    color={s.color}
                    name={ownCatName(s.name)}
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
                    outfit={myOutfit}
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
                    outfit={myOutfit}
                    name={ownCatName(s.name)}
                  />
                )}
              </>
            );
          }}
        </FishingIsland>
        {r === 'fishingArrival' && !(tutorialStep >= 5 && tutorialStep <= 21) && (
          <View
            pointerEvents="box-none"
            {...a11yHidden(!!catInfo)}
            style={{
              position: 'absolute',
              top: safe.top + semanticTokens.spacing.control,
              left: safe.left + semanticTokens.spacing.page,
              right: safe.right + semanticTokens.spacing.page,
              gap: semanticTokens.spacing.control,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <FiButton
              title={t('focusFlow.spot.backToMainIsland')}
              id="leave-fishing-arrival"
              onPress={returnFromArrival}
            />
            {VERIFY_SPIKE && (
              <VerificationToggle
                onPreviewChange={setVerificationPreviewOpen}
                intro={verificationIntro}
                on={s.settings.studyVerification === true}
                cameraPosition={s.settings.studyVerificationCamera}
                onChange={(value, position) => {
                  e.dispatch({ type: 'SETTING', key: 'studyVerificationCamera', value: position });
                  e.dispatch({ type: 'SETTING', key: 'studyVerification', value });
                }}
              />
            )}
          </View>
        )}
        {VERIFY_SPIKE &&
          !experience &&
          r === 'fishingArrival' &&
          !(tutorialStep >= 5 && tutorialStep <= 21) && (
            <View
              pointerEvents="box-none"
              {...a11yHidden(!!catInfo || !!dialog)}
              style={{
                position: 'absolute',
                top:
                  safe.top +
                  semanticTokens.spacing.control * 2 +
                  componentTokens.verificationSetup.buttonSize,
                left: safe.left + semanticTokens.spacing.page,
              }}
            >
              <VerificationSpike
                enabled={s.settings.studyVerification === true}
                previewVisible={verificationPreviewOpen}
                onCameraPositionChange={(position) =>
                  e.dispatch({ type: 'SETTING', key: 'studyVerificationCamera', value: position })
                }
                cameraPosition={s.settings.studyVerificationCamera}
                textStyle={hudText}
              />
            </View>
          )}
        {liveIslandId && live.status === 'error' && (
          <View
            {...a11yHidden(!!catInfo)}
            style={{
              position: 'absolute',
              zIndex: 5,
              ...(r === 'fishingArrival'
                ? { bottom: safe.bottom + semanticTokens.spacing.page }
                : { top: Math.max(56, safe.top + 8) }),
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
            {VERIFY_SPIKE && !experience && !(tutorialStep >= 5 && tutorialStep <= 21) && (
              <View
                pointerEvents="box-none"
                {...a11yHidden(!!dialog || !!goldenCutscene || !!catInfo)}
                style={{
                  position: 'absolute',
                  zIndex: 5,
                  top: safe.top + semanticTokens.spacing.control,
                  left: Math.max(18, safe.left),
                }}
              >
                <VerificationSpike
                  key={s.session!.id}
                  sessionId={s.session!.id}
                  enabled={s.settings.studyVerification === true}
                  previewVisible={verificationPreviewOpen}
                  onCameraPositionChange={(position) =>
                    e.dispatch({ type: 'SETTING', key: 'studyVerificationCamera', value: position })
                  }
                  textStyle={hudText}
                  cameraPosition={s.settings.studyVerificationCamera}
                />
              </View>
            )}
            {VERIFY_SPIKE && !experience && !(tutorialStep >= 5 && tutorialStep <= 21) && (
              <View
                testID="focus-camera-toggle"
                {...a11yHidden(!!dialog || !!goldenCutscene || !!catInfo)}
                style={{
                  position: 'absolute',
                  zIndex: 5,
                  top: safe.top + semanticTokens.spacing.control,
                  right: safe.right + semanticTokens.spacing.page,
                }}
              >
                <VerificationToggle
                  onPreviewChange={setVerificationPreviewOpen}
                  inSession
                  intro={verificationIntro}
                  on={s.settings.studyVerification === true}
                  cameraPosition={s.settings.studyVerificationCamera}
                  onChange={(value, position) => {
                    e.dispatch({
                      type: 'SETTING',
                      key: 'studyVerificationCamera',
                      value: position,
                    });
                    e.dispatch({ type: 'SETTING', key: 'studyVerification', value });
                  }}
                />
              </View>
            )}
            <View
              {...a11yHidden(!!dialog || !!goldenCutscene || !!catInfo)}
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
              <EmoteFab fan={fan} setFan={setFan} emote={emote} onSend={sendEmote} />
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
                <FiButton
                  title={t('focusFlow.common.endFocus')}
                  id="end-focus"
                  key={s.session?.id}
                  holdToConfirm
                  haptics={s.settings.haptics}
                  onPress={finish}
                />
              </View>
            </View>
          </>
        )}
        {musicModal}
        {r === 'focusResult' && !leg && !goldenReeling && resultModal}
        {!leg && !goldenReeling && rewardModal}
        {catInfo && <FishingCatInfo target={catInfo} onClose={() => setCatInfo(null)} />}
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
