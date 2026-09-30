import { Text } from '@/design-system/typography';
import { useAppLayout } from '@/utils/layout';
import { useRouteOrientation } from '@/utils/orientation';
import { Btn as NativeButton, Overlay, Txt as NativeText } from '@/design-system/patterns';
import { CurrentScreens as RedesignScreens } from '@/screens/island/CurrentScreens';
import React, { useState, useReducer, useEffect, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  Image,
  ImageBackground,
  Pressable,
  Switch,
  Modal,
  Animated,
  BackHandler,
  Platform,
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Keyboard,
  Share,
  AccessibilityInfo,
  FlatList,
  Linking,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useSoundPlayer } from '@/hooks/useSoundPlayer';
import { useIslandPlayback } from '@/screens/island/useIslandPlayback';
import { useBuildingIndicators } from '@/screens/island/useBuildingIndicators';
import { bundledAudioSource } from '@/constants/audio';
import { playbackSeekSeconds } from '@/services/api/playback';
import { screenTime, selectionCount } from '@/services/screenTime';
import {
  endLiveActivities,
  shouldPollExpiredRest,
  shouldReconcileExpiredRest,
  syncLiveActivity,
} from '@/services/liveActivity';
import { syncAndroidScreenTime } from '@/services/screentimeSync';
import { shouldGateScreenTimeBoard } from '@/services/screenTimeFlow';
import { reconcileTutorial } from '@/services/tutorial';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import {
  C,
  S,
  T,
  H,
  Card,
  Button,
  Avatar,
  Field,
  Progress,
  Art,
  Menu,
  Tabs,
  MotionContext,
  useScreenInsets,
} from '@/design-system/primitives';
import { primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { assets, cat } from '@/constants/assets';
import {
  Scarf,
  Flag,
  BoatPortrait,
  IslandDecor,
  IslandPreview,
} from '@/screens/cosmetics/Cosmetics';
import { InviteEntry } from '@/screens/discovery/InviteEntry';
import { IslandDiscovery } from '@/screens/discovery/IslandDiscovery';
import { IslandHome } from '@/screens/island/IslandHome';
import { Welcome, SceneHero, RestWorld, Sailing } from '@/screens/world/WorldViews';
import { FocusSea, clock } from '@/screens/focus/FocusSea';
import {
  initialState,
  demoState,
  reducer,
  currentIsland,
  viewIsland,
  sessionSeconds,
  questRate,
  canBuild,
  canBuy,
  products,
  costs,
  buildMinutes,
  buildingCost,
  buildingNames,
  buildingOrder,
  colors,
  colorNames,
  State,
  Route,
  Building,
  Quest,
  Member,
  dayKey,
} from '@/services/model';
import {
  checkSession,
  guestLogin,
  login as apiLogin,
  logout,
  prepareLogout,
  type Account,
  type LoginResult,
  type Provider,
} from '@/services/api/auth';
import { loginProviders } from '@/services/loginProviders';
import { TERMS_VERSION } from '@/services/termsVersion';
import { PolicyLinks } from '@/components/PolicyLink';
import { isSocialLoginCancellation, socialCredential } from '@/services/socialLogin';
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  CLIENT_STALE_SESSION,
  CLIENT_TIMEOUT,
  uuid,
} from '@/services/api/client';
import { loadHomeSnapshot } from '@/services/homeSnapshot';
import {
  getLastSessionUserId,
  getSession,
  rememberLocalDataOwner,
  restoreSession,
  setSessionLostHandler,
  sessionGeneration,
  subscribeSession,
} from '@/services/api/session';
import { createIslandCommands } from '@/services/islandCommands';
import { createSessionCommands } from '@/services/sessionCommands';
import { decideBootRoute } from '@/services/islandBoot';
import { createShieldedRouteTransition } from '@/services/routeTransition';
import { parseAppDeepLink, subscribeToAppLinks } from '@/services/appDeepLink';
import {
  BUILDING_TRANSITION_DURATION_MS,
  BUILDING_TRANSITION_RETURN_TARGET,
  createBuildingTransitionController,
  cancelBuildingTransition,
  clearBuildingTransitionRouteCovers,
  isBuildingTransitionActive,
  isBuildingTransitionRouteCovered,
  subscribeBuildingTransitionActivity,
  subscribeBuildingTransitionRouteCover,
  type BuildingTransitionTarget,
  type BuildingTransitionState,
} from '@/services/buildingTransition';
import { BuildingTransitionOverlay } from '@/screens/island/BuildingTransitionOverlay';
import { RouteTransitionShield } from '@/components/RouteTransitionShield';
import { adoptSignedInAccount, createMemberConversion } from '@/services/memberConversion';
import { trackDatadogView } from '@/services/datadog';
import {
  captureProductEvent,
  identifyPostHogUser,
  resetPostHogUser,
  trackPostHogScreen,
} from '@/services/posthog';
const REVIEW =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('review');
const DEMO =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('demo');
// GROMO-1926 TestFlight에서 건물별 기능을 바로 확인하기 위한 임시 QA 빌드 설정.
const TESTFLIGHT_ALL_BUILDINGS = true;
const STORAGE = 'gromo-r61-user-v2';
// 채택 도중 세션 세대가 바뀌면(401 정리·다른 로그인) 남은 적용을 버리는 내부 신호. 호출부에는
// 오류로 드러내지 않는다 — 새 세션의 화면이 이미 자기 흐름을 진행 중이다.
const STALE_ADOPTION = Symbol('staleAdoption');
const PROVIDER_LABEL: Record<Provider, string> = {
  apple: 'Apple로 계속하기',
  google: 'Google로 계속하기',
  kakao: 'Kakao로 계속하기',
  line: 'LINE으로 계속하기',
};
const titles: Record<Route, string> = {
  login: 'GROMO',
  character: '내 고양이',
  chooseIsland: '첫 섬 선택',
  createIsland: '새 섬 만들기',
  joinIsland: '섬 찾기',
  approval: '가입 승인 대기',
  arrival: '섬에 도착했어요',
  home: '우리 섬',
  guide: '몽돌 안내',
  focusSetup: '낚시 집중 준비',
  focus: '함께 낚시 집중',
  rest: '모닥불',
  focusResult: '이번 집중 결과',
  hall: '마을회관',
  stats: '우리 섬 기록',
  manage: '섬 관리',
  members: '함께하는 주민',
  ledger: '공동 자원 내역',
  construction: '다음 건물 선택',
  board: '게시판',
  notice: '공지',
  noticeEdit: '공지 작성·수정',
  quest: '그룹원 달성률',
  questEdit: '퀘스트 만들기',
  tower: '전망대',
  explore: '다른 섬 둘러보기',
  visit: '바다 건너 섬',
  visitIsland: '다른 섬 구경',
  visitIslandFocus: '다른 섬 낚시 구경',
  travel: '섬 사이 이동',
  mail: '우리 섬 편지방',
  shop: '강아지 상점',
  product: '상품 상세',
  orders: '구매 내역',
  boat: '내 배',
  mainIsland: '내 메인 섬 변경하기',
  profile: '내 정보',
  settings: '앱 설정',
  blockedUsers: '차단한 사용자',
  wardrobe: '내 꾸미기',
  sound: '꽃나팔 방송기',
  library: '도서관',
  diary: '일기장',
  friends: '친구 관리',
  friendSearch: '친구 찾기',
  friendMail: '친구 편지',
  chat: '우리 섬 편지방',
  fishingArrival: '낚시섬 도착',
  focusVisit: '낚시섬 구경',
  focusTravel: '낚시섬으로',
  returnTravel: '우리 섬으로',
  permission: '측정 권한',
  screenTimeApps: '측정 앱',
  demo: '목업 체험 도구',
};
function Bubble({ text, mine }: { text: string; mine: boolean }) {
  const [size, setSize] = useState({ w: 240, h: 60 });
  const w = size.w,
    h = size.h,
    r = 17;
  return (
    <View
      onLayout={(e) =>
        setSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
      style={{ position: 'relative', padding: 13, maxWidth: 260, minWidth: 90 }}
    >
      <Svg
        width={w}
        height={h}
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
      >
        <Path
          d={`M -3 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V 10 Q 0 7 -2 5 Q -7 0 -3 0 Z`}
          transform={mine ? `translate(${w} 0) scale(-1 1)` : undefined}
          fill={mine ? C.soft : C.paper}
          stroke={C.brown}
          strokeWidth={1.3}
          strokeLinejoin="round"
        />
      </Svg>
      <T>{text}</T>
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Gromo />
    </SafeAreaProvider>
  );
}
// 딥링크를 보관만 하는 화면 — 로그인과 계정·섬 온보딩 단계, 첫 섬 합류 뒤의 필수 안내(guide).
// 안내 중에 링크를 소비하면 온보딩과 마찬가지로 첫 튜토리얼을 건너뛴다.
const DEEP_LINK_HOLD_ROUTES: Route[] = [
  'login',
  'character',
  'chooseIsland',
  'createIsland',
  'joinIsland',
  'approval',
  'guide',
];

function Gromo() {
  const layout = useAppLayout();
  const insets = useScreenInsets();
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    DEMO ? demoState() : initialState(),
  );
  const [loaded, setLoaded] = useState(false),
    [storageOwnerReady, setStorageOwnerReady] = useState(true),
    // 부팅 섬 동기화 실패 — chooseIsland가 명시 오류+재시도를 보여줄 플래그(로컬 폴백 금지)
    [islandBootError, setIslandBootError] = useState(false),
    [hasServerSession, setHasServerSession] = useState(
      () => !REVIEW && !DEMO && getSession() !== null,
    ),
    [route, setRoute] = useState<Route>(DEMO ? 'home' : 'login'),
    [routeTransitionShielded, setRouteTransitionShielded] = useState(false),
    [history, setHistory] = useState<
      {
        route: Route;
        detail: string;
        tab: string;
        text: string;
        body: string;
      }[]
    >([]),
    [detail, setDetail] = useState(''),
    [tab, setTab] = useState(''),
    [text, setText] = useState(''),
    [body, setBody] = useState(''),
    [windowStart, setWindowStart] = useState('00:00'),
    [windowEnd, setWindowEnd] = useState('24:00'),
    [search, setSearch] = useState(''),
    [terms, setTerms] = useState(false),
    [guestBusy, setGuestBusy] = useState(false),
    [guestError, setGuestError] = useState(''),
    [socialBusy, setSocialBusy] = useState<Provider | null>(null),
    [socialError, setSocialError] = useState(''),
    [approval, setApproval] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [now, setNow] = useState(Date.now()),
    [toast, setToast] = useState(''),
    // 편지 쓰기 등 키보드가 떠 있는 화면에서 알림 토스트가 소프트 키보드 밑에 가려지지 않게(GROMO-2169)
    [keyboardHeight, setKeyboardHeight] = useState(0),
    [modal, setModal] = useState<{
      title: string;
      text: string;
      action: () => void;
      // 확인 버튼 글자(기본 '확인') · 파괴적 확인이면 빨간 버튼
      ok?: string;
      destructive?: boolean;
    } | null>(null),
    // 회원 전환(GROMO-2005) — 게이트 거절(403 SOCIAL_LOGIN_REQUIRED)이 여는 공통 시트.
    // busy 는 진행 중인 제공자, error 는 시트 안에 보여 줄 마지막 실패다.
    [convUi, setConvUi] = useState<{
      busy: Provider | null;
      error: string | null;
      termsAccepted: boolean;
    } | null>(null),
    // 기존 계정 충돌(409 SOCIAL_ACCOUNT_ALREADY_LINKED) 확인창 — 승인·취소는 switchResolve 가 돌려준다.
    [switchAsk, setSwitchAsk] = useState(false),
    [visited, setVisited] = useState('strawberry'),
    [previewAudio, setPreviewAudio] = useState(false),
    [failNext, setFailNext] = useState(false),
    [walkRequest, setWalkRequest] = useState<Route | null>(null),
    [restTravel, setRestTravel] = useState(false),
    [reviewEpoch, setReviewEpoch] = useState(0);
  const guideStep = state.tutorial?.step ?? 0;
  const setGuideStep = (step: number, expected?: { step: number; revision: number }) =>
    dispatch({ type: 'GUIDE_STEP', step, expected });
  const tutorialBootReconciled = useRef(false);
  const previousTutorialRoute = useRef(route);
  const [liveCounts, setLiveCounts] = useState<{
    sessionId: string;
    islandId: string;
    focus: number;
    rest: number;
  } | null>(null);
  const storageOwnerReadyRef = useRef(storageOwnerReady);
  const userStorageWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const setStorageOwnerGate = (ready: boolean) => {
    // state render 전에 도착한 저장 effect도 새 gate 값을 보도록 ref를 먼저 바꾼다.
    storageOwnerReadyRef.current = ready;
    setStorageOwnerReady(ready);
  };
  const [incomingAppLink, setIncomingAppLink] = useState<string | null>(null);
  const socialLoginAttempt = useRef<{
    provider: Provider;
    credential: string;
    attemptId: string;
    generation: number;
  } | null>(null);
  const socialAttemptGeneration = useRef(sessionGeneration());
  const conversionLoginAttempt = useRef<{
    provider: Provider;
    credential: string;
    generation: number;
  } | null>(null);
  const conversionSessionTransition = useRef<{
    provider: Provider;
    credential: string;
    userId: string;
    generation: number;
  } | null>(null);
  const deferredOwnerState = useRef<{ userId: string; state: State } | null>(null);
  const conversionAdoptionAborted = useRef(false);
  // owner 불일치 부팅에서 첫 섬 동기화가 실패하면 소유자 전환을 여기 보류했다가,
  // 화면의 동기화 재시도가 성공한 뒤 마저 끝낸다.
  const pendingBootOwnerTransfer = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => trackDatadogView(route, titles[route]), [route]);
  const transition = useRef(new Animated.Value(1)).current,
    boatTravel = useRef(new Animated.Value(-180)).current,
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    emoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mailRef = useRef<FlatList>(null),
    // 화면이 뒤로가기를 먼저 처리하면(true) 아래 기본 동작을 건너뛴다(낚시섬 걷기·항해·모달·결과 흐름)
    backOverride = useRef<(() => boolean) | null>(null),
    switchResolve = useRef<((ok: boolean) => void) | null>(null);
  const guestLoginFlight = useRef(false);
  const transitionRoute = useRef(
    createShieldedRouteTransition(setRouteTransitionShielded, setRoute),
  ).current;
  const fireTransitionController = useRef(createBuildingTransitionController()).current;
  const [fireTransition, setFireTransition] = useState<BuildingTransitionState>({
    phase: 'idle',
    target: null,
    direction: null,
    generation: 0,
  });
  const [buildingRouteCovered, setBuildingRouteCovered] = useState(
    isBuildingTransitionRouteCovered,
  );
  const [buildingTransitionActive, setBuildingTransitionActive] = useState(
    isBuildingTransitionActive,
  );
  useEffect(
    () => fireTransitionController.subscribe(setFireTransition),
    [fireTransitionController],
  );
  useEffect(() => subscribeBuildingTransitionActivity(setBuildingTransitionActive), []);
  useEffect(() => subscribeBuildingTransitionRouteCover(setBuildingRouteCovered), []);
  useEffect(() => () => fireTransitionController.dispose(), [fireTransitionController]);
  // 편지 쓰기처럼 키보드가 떠 있는 화면에서 실패 알림(e.notify)이 키보드 밑에 가려지지 않게
  // 키보드 높이를 추적해 토스트를 그만큼 띄운다(GROMO-2169).
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (ev) =>
      setKeyboardHeight(ev.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const island = currentIsland(state),
    qaBuildingsReady =
      !TESTFLIGHT_ALL_BUILDINGS ||
      !state.onboarded ||
      (buildingOrder.every((building) => island.buildings.includes(building)) &&
        !island.buildingQuest &&
        !island.construction &&
        !island.nextBuilding &&
        !island.completed),
    record = state.lastResult;
  const player = useSoundPlayer((message) => notify(message));
  const notify = (s: string) => {
    setToast(s);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  };
  const playback = useIslandPlayback({
    active: !REVIEW && !DEMO && hasServerSession && island.buildings.includes('gram'),
    islandId: state.serverIslands?.currentIslandId ?? null,
    dispatch,
  });
  const performGo = (r: Route, id = '', options: { sessionIsAlreadyPaused?: boolean } = {}) => {
    const gateBoard = shouldGateScreenTimeBoard(r, {
      isIOS: Platform.OS === 'ios',
      promptSeen: !!state.settings.screenTimeBoardPromptSeen,
    });
    const nextRoute: Route = gateBoard ? 'permission' : r;
    const nextDetail = gateBoard ? `board-first|${r}|${encodeURIComponent(id)}` : id;
    if (r === 'rest') setRestTravel(route === 'focus');
    if (r === 'home' || route === 'home') setWalkRequest(null);
    if (r === 'rest' && !options.sessionIsAlreadyPaused && state.session?.status === 'active')
      dispatch({ type: 'PAUSE' });
    setDetail(nextDetail);
    setTab('');
    setText('');
    setBody('');
    setSearch('');
    setHistory((h) => [...h, { route, detail, tab, text, body }]);
    transitionRoute(nextRoute);
    if (state.settings.haptics && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  };
  const go = (r: Route, id = '', onTransitionCancel?: () => void) => {
    const direction =
      route === 'focus' && r === 'rest'
        ? 'enter'
        : route === 'rest' && r === 'focus'
          ? 'return'
          : null;
    if (!direction) return performGo(r, id);
    return fireTransitionController.start(
      'fire',
      direction,
      state.settings.reduceMotion,
      () => performGo(r, id),
      BUILDING_TRANSITION_DURATION_MS,
      () => {
        onTransitionCancel?.();
        // 휴식 진입 전 pause는 이미 끝났다. 뒤로가기로 진입만 취소하면 집중을 다시 켜야 한다.
        if (route === 'focus' && r === 'rest') resumeSession();
      },
    );
  };
  const returnToIsland = (target: BuildingTransitionTarget, done: () => void) =>
    fireTransitionController.start(target, 'return', state.settings.reduceMotion, done);
  const replace = (r: Route, id = '') => {
    setDetail(id);
    setTab('');
    setText('');
    setBody('');
    setSearch('');
    transitionRoute(r);
  };
  const reset = (r: Route, id = '') => {
    cancelBuildingTransition();
    clearBuildingTransitionRouteCovers();
    setHistory([]);
    setDetail(id);
    setTab('');
    setText('');
    setBody('');
    setSearch('');
    transitionRoute(r);
  };
  const back = () => {
    if (modal) {
      setModal(null);
      return;
    }
    if (cancelBuildingTransition()) return;
    if (backOverride.current?.()) return;
    if (route === 'focus' && state.session) {
      confirm('집중을 마칠까요?', '이번 집중을 기록해요.', () => finishSession());
      return;
    }
    if (route === 'rest' && state.session) {
      resumeSession();
      return;
    }
    if (history.length) {
      const previous = history[history.length - 1];
      const restorePrevious = () => {
        transitionRoute(previous.route);
        setDetail(previous.detail);
        setTab(previous.tab);
        setText(previous.text);
        setBody(previous.body);
        setHistory((h) => h.slice(0, -1));
      };
      const target = BUILDING_TRANSITION_RETURN_TARGET[route];
      if (previous.route === 'home' && target) {
        returnToIsland(target, restorePrevious);
        return;
      }
      restorePrevious();
    } else transitionRoute(state.onboarded ? 'home' : 'chooseIsland');
  };
  const home = () => {
    const finish = () => {
      setWalkRequest(null);
      setHistory([]);
      transitionRoute('home');
    };
    const target = BUILDING_TRANSITION_RETURN_TARGET[route];
    if (target) returnToIsland(target, finish);
    else finish();
  };
  const confirm = (
    title: string,
    txt: string,
    action: () => void,
    opts: { ok?: string; destructive?: boolean } = {},
  ) => setModal({ title, text: txt, action, ...opts });
  // ── 섬 서버 명령(GROMO-2006) ──
  // 오케스트레이션은 services/islandCommands.ts — 멱등 키·초대 token은 거기 세대 격리
  // 저장소에만 둔다(State/AsyncStorage 저장 금지). 매 렌더의 최신 함수·state는 ref로 넘긴다.
  const stateRef = useRef(state);
  stateRef.current = state;
  const routeRef = useRef(route);
  routeRef.current = route;
  const goRef = useRef(go);
  goRef.current = go;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => subscribeToAppLinks((url) => setIncomingAppLink(url)), []);
  useEffect(() => {
    if (!loaded || !incomingAppLink) return;
    const target = parseAppDeepLink(incomingAppLink);
    if (!target) {
      setIncomingAppLink(null);
      return;
    }
    // 앱 부팅 전이나 로그인 중 받은 링크는 보관했다가 세션이 준비된 뒤에만 연다.
    // 딥링크가 로그인 화면을 우회해 회원 전용 화면을 노출하지 않게 한다.
    // 로그인 응답으로 session store만 먼저 바뀌는 틈이 있다. 채택 완료로 login route가
    // 벗어난 뒤 처리해야 이후 /me·온보딩 경로 판정이 링크 목적지를 덮지 않는다.
    // 인증 완료와 계정·섬 온보딩 완료는 별개다. 캐릭터·섬 선택 중에 링크를 소비하면 필수
    // 온보딩을 건너뛰므로, 온보딩이 끝나 해당 화면들을 벗어날 때까지 보관한다.
    // 지원하지 않는 초대·그룹 링크도 같은 guard 뒤에서 홈 이동과 안내를 함께 처리한다.
    // 첫 안내 초반(3단계 이하)의 홈은 튜토리얼 effect 가 같은 렌더에서 guide 로 되돌린다. 여기서 링크를
    // 소비하면 목적지 이동이 덮여 링크가 사라지므로 안내 화면과 같이 보관한다.
    const tutorialForcesGuide = route === 'home' && !!state.tutorial && state.tutorial.step <= 3;
    if (
      !hasServerSession ||
      !state.onboarded ||
      DEEP_LINK_HOLD_ROUTES.includes(route) ||
      tutorialForcesGuide
    )
      return;
    setIncomingAppLink(null);
    if (target.kind === 'unsupported') {
      goRef.current('home');
      notifyRef.current('이 초대·그룹 링크는 현재 버전에서 지원하지 않아 홈으로 이동했어요.');
      return;
    }
    goRef.current(target.route);
  }, [loaded, incomingAppLink, hasServerSession, state.onboarded, state.tutorial, route]);
  const islandCmds = useRef<ReturnType<typeof createIslandCommands> | null>(null);
  islandCmds.current ??= createIslandCommands({
    dispatch,
    go: (r, id) => goRef.current(r as Route, id),
    getSnap: () => stateRef.current?.serverIslands,
    setBootError: setIslandBootError,
  });
  const islandCommands = islandCmds.current.commands,
    syncIslands = islandCmds.current.syncIslands;
  const islands = useMemo(
    () => ({
      ...islandCommands,
      sync: async () => {
        const my = await islandCommands.sync();
        const transfer = pendingBootOwnerTransfer.current;
        if (transfer) {
          pendingBootOwnerTransfer.current = null;
          try {
            await transfer();
          } catch (error) {
            // 재시도가 다시 실패하면 다음 재시도에서 전환을 이어서 시도한다.
            pendingBootOwnerTransfer.current ??= transfer;
            throw error;
          }
        }
        return my;
      },
    }),
    [islandCommands],
  );
  // ── 서버 모드 홈 스냅샷(GROMO-2138) ──
  // 홈에 들어올 때마다(그리고 current 가 바뀌면) 불러 홈이 서버 값을 직접 그린다.
  // 실패는 홈이 재시도로 띄운다 — 로컬 목업 섬으로 대신 그리지 않는다.
  const [homeError, setHomeError] = useState(false),
    [homeReload, setHomeReload] = useState(0);
  const serverCurrent =
    !REVIEW && !DEMO && hasServerSession ? (state.serverIslands?.currentIslandId ?? null) : null;
  const onHome = route === 'home' || route === 'guide';
  const buildingIndicators = useBuildingIndicators({
    active: !!serverCurrent,
    islandId: serverCurrent,
    onHome,
    refreshKey: homeReload,
  });
  useEffect(() => {
    if (!loaded || !serverCurrent || !onHome) return;
    let live = true;
    setHomeError(false);
    loadHomeSnapshot({ date: dayKey(), timezone: 'Asia/Seoul', isCurrent: () => live })
      .then((r) => {
        if (!live) return;
        // current 없음(서버 409) 또는 응답이 로컬이 아는 current 와 다른 섬(전환 경합) —
        // 둘 다 이 스냅샷을 그대로 적용하지 않고 소속 동기화로 반영해 chooseIsland 로 보낸다.
        const current = stateRef.current?.serverIslands?.currentIslandId;
        if (r.status !== 'loaded' || r.facts.islandId !== current) {
          // 동기화가 실패하거나 current 를 바꾸지 못하면 effect 가 다시 돌지 않는다 — 스피너에 갇히지
          // 않게 재시도 화면으로 떨어뜨린다. current 가 바뀌면 effect 가 새로 불러오고 chooseIsland 는 App 이 연다
          syncIslands()
            .then((my) => {
              if (live && my.currentIslandId === current) setHomeError(true);
            })
            .catch(() => {
              if (live) setHomeError(true);
            });
          return;
        }
        dispatch({ type: 'SERVER_HOME', facts: r.facts });
      })
      .catch((thrown) => {
        if (live && !(thrown instanceof ApiError && thrown.code === CLIENT_STALE_SESSION))
          setHomeError(true);
      });
    return () => {
      live = false;
    };
  }, [loaded, serverCurrent, onHome, homeReload]);
  // ── 집중 세션 서버 명령(GROMO-2009) ──
  // 섬 명령과 같은 저장소 규칙 — 멱등 키는 세대 격리 ref, state·세션은 최신 ref로 읽는다.
  const focusCmds = useRef<ReturnType<typeof createSessionCommands> | null>(null);
  focusCmds.current ??= createSessionCommands({
    dispatch,
    getSession: () => stateRef.current?.session ?? null,
    getSnap: () => stateRef.current?.serverIslands,
  });
  const focus = focusCmds.current.commands;
  const restRecovery = useRef<{
    sessionId: string;
    at: number;
    promise: Promise<boolean> | null;
  } | null>(null);
  const applyRecoveredRestRoute = (sessionId: string, recovered: Route | null): boolean => {
    const current = stateRef.current.session;
    if (
      current &&
      (current.id !== sessionId || (current.status === 'active' && recovered !== 'focus'))
    )
      return false;
    if (recovered === 'focusResult') reset('focusResult');
    else if (recovered === 'focus') reset('focus');
    else if (recovered === null) home();
    else return false;
    return true;
  };
  const recoverExpiredRest = (sessionId: string, force = false): Promise<boolean> => {
    const previous = restRecovery.current;
    if (previous?.sessionId === sessionId && previous.promise) {
      // 버튼 충돌은 진행 중인 조회가 서버 자동 종료 직전 상태를 읽었을 수도 있어 한 번 더 확인한다.
      return force
        ? previous.promise.then((handled) => handled || recoverExpiredRest(sessionId, true))
        : previous.promise;
    }
    const at = Date.now();
    if (!force && !shouldPollExpiredRest(stateRef.current.session, at, previous))
      return Promise.resolve(false);
    const promise = focus
      .recover()
      .then((recovered) => applyRecoveredRestRoute(sessionId, recovered))
      .catch(() => false)
      .finally(() => {
        if (restRecovery.current?.sessionId === sessionId) restRecovery.current.promise = null;
      });
    restRecovery.current = { sessionId, at, promise };
    return promise;
  };
  const recoverExpiredRestConflict = (
    error: unknown,
    session: State['session'],
  ): Promise<boolean> => {
    if (
      !session ||
      !shouldReconcileExpiredRest(session, Date.now()) ||
      !(error instanceof ApiError) ||
      !['STATE_CONFLICT', 'VERSION_CONFLICT', 'NOT_FOUND', 'GROUP_NOT_FOUND'].includes(error.code)
    )
      return Promise.resolve(false);
    return recoverExpiredRest(session.id, true);
  };
  // 서버 세션(버전 있음)이면 명령이 정본 — 없으면 목업 로컬 reducer 경로다.
  const serverSession = () => hasServerSession && stateRef.current?.session?.version != null;
  const finishSession = () => {
    const session = stateRef.current.session;
    if (!serverSession()) {
      dispatch({ type: 'FINISH' });
      reset('focusResult');
      return;
    }
    focus
      .finish()
      .then(() => reset('focusResult'))
      .catch(async (error) => {
        if (await recoverExpiredRestConflict(error, session)) return;
        notify(error instanceof Error ? error.message : '집중을 마치지 못했어요.');
      });
  };
  const resumeSession = () => {
    const session = stateRef.current.session;
    if (!serverSession()) {
      dispatch({ type: 'RESUME' });
      if (route !== 'focus') transitionRoute('focus');
      return;
    }
    focus
      .resume()
      .then(() => {
        if (route !== 'focus') transitionRoute('focus');
      })
      .catch(async (error) => {
        if (await recoverExpiredRestConflict(error, session)) return;
        notify(error instanceof Error ? error.message : '집중을 이어가지 못했어요.');
        if (routeRef.current === 'focus' && stateRef.current.session?.status === 'paused') {
          performGo('rest', '', { sessionIsAlreadyPaused: true });
        }
      });
  };
  // ── 회원 전환(GROMO-2005) ──
  // 오케스트레이션은 services/memberConversion.ts — 친구·편지·구매의 403 SOCIAL_LOGIN_REQUIRED 를
  // 받은 호출부가 e.conversion.offer(error) 로 시트를 연다. 진행 중인 대기 확인은 취소로 정리한다.
  const settleSwitch = (ok: boolean) => {
    setSwitchAsk(false);
    switchResolve.current?.(ok);
    switchResolve.current = null;
  };
  // 화면 이동까지 끝난 뒤 owner 기록이 일시 실패하면, 같은 세션이 유지되는 동안 백오프로 다시
  // 기록한다. 성공해야 저장 gate가 열린다 — 실패를 로그인 화면에만 남기면 사용자는 이후 변경이
  // 저장되지 않는 줄 모른다.
  const recordOwnerWithRetry = async (
    userId: string,
    gen: number,
    attempt = 0,
  ): Promise<boolean> => {
    if (sessionGeneration() !== gen) return false;
    if (await rememberLocalDataOwner(userId, gen).catch(() => false)) {
      if (sessionGeneration() === gen) setStorageOwnerGate(true);
      return true;
    }
    if (sessionGeneration() !== gen) return false;
    if (attempt === 0)
      notify('기기 저장소 문제로 변경 내용이 아직 저장되지 않아요. 자동으로 다시 시도할게요.');
    setTimeout(
      () => void recordOwnerWithRetry(userId, gen, attempt + 1),
      Math.min(30_000, 1_000 * 2 ** attempt),
    );
    return false;
  };
  // 반환값 null = 세대가 바뀌어 조용히 중단했다(상태·화면·소유자 기록 모두 적용하지 않음).
  const adoptSession = async (
    result: LoginResult,
    previousUserId: string | null,
  ): Promise<Account | null> => {
    // 채택 시작 시점의 세대를 잡아 두고 모든 await 뒤·상태 적용 전에 같은지 확인한다.
    const adoptionGen = sessionGeneration();
    const isCurrent = () => sessionGeneration() === adoptionGen;
    const ensureCurrent = () => {
      if (!isCurrent()) throw STALE_ADOPTION;
    };
    const changingOwner = previousUserId !== result.userId;
    // 채택이 중단되면 gate 는 닫힌 채로 남는다 — 다음 채택 성공이나 부팅이 owner 기록 뒤에 연다.
    // 소유자 확인 전 저장을 막는 보수적 동작이며 의도된 것이다.
    if (changingOwner) setStorageOwnerGate(false);
    let account: Account;
    try {
      account = await adoptSignedInAccount(result, previousUserId, {
        resetLocal: async () => {
          // /me 응답을 기다리는 사이 세션이 바뀌었으면 이전 사용자의 저장본도 지우지 않는다.
          ensureCurrent();
          // 사용자 귀속 blob 전체를 지우고 빈 상태로 — 이전 계정의 섬·친구·진행이 섞이지 않는다.
          // settings 만 기기 귀속(정책 A15)이라 보존한다.
          // 이미 시작된 A 저장도 먼저 끝낸 다음 지워야 late write가 삭제 뒤에 A blob을 부활시키지 않는다.
          setStorageOwnerGate(false);
          await userStorageWriteQueue.current;
          // 큐를 기다리는 사이 이 채택이 중단(로그아웃·재로그인)됐다면, 지우려는 STORAGE 는 이미
          // 새 세션의 저장본일 수 있다. 삭제 직전에 세대를 다시 확인한다.
          ensureCurrent();
          await AsyncStorage.removeItem(STORAGE);
          deferredOwnerState.current = null;
          ensureCurrent();
          dispatch({
            type: 'LOAD',
            state: {
              ...(DEMO ? demoState() : initialState()),
              settings: stateRef.current.settings,
            },
            now: Date.now(),
          });
        },
        applyAccount: (account) => {
          ensureCurrent();
          const deferred = deferredOwnerState.current;
          if (
            previousUserId === result.userId &&
            account.id === result.userId &&
            deferred?.userId === result.userId
          ) {
            // 같은 owner 재채택이면 앞선 오프라인 부팅이 보류한 데이터를 복구한다.
            // LOAD를 LOGIN/PROFILE보다 먼저 dispatch해 새 세션의 계정 표기가 덮지 않게 한다.
            dispatch({ type: 'LOAD', state: deferred.state, now: Date.now() });
            deferredOwnerState.current = null;
          }
          dispatch({ type: 'LOGIN', linkedProviders: account.linkedProviders });
          if (account.name || account.catColor)
            dispatch({
              type: 'PROFILE',
              name: account.name ?? undefined,
              color: account.catColor ?? undefined,
            });
        },
        navigate: async (account) => {
          // 부팅과 같은 판정 — 새 계정의 /me/islands 를 다시 조회해 화면을 고른다. 세대가
          // 바뀌었으면(그 사이 로그아웃·재로그인) 늦은 판정을 쓰지 않는다.
          ensureCurrent();
          const next = await decideBootRoute({
            saved: null,
            account,
            rejected: false,
            serverMode: true,
            bootGen: adoptionGen,
            generation: sessionGeneration,
            syncIslands,
            onBootError: setIslandBootError,
          });
          ensureCurrent();
          if (next) reset(next);
        },
      });
    } catch (thrown) {
      if (thrown === STALE_ADOPTION) return null;
      throw thrown;
    }
    if (!isCurrent()) return null;
    // /me 와 화면 판정이 끝난 뒤에만 소유자를 바꾼다. 그 전에 실패하면 기존 ID가 재시도 기준이다.
    // 이미 화면을 옮긴 뒤의 기록 실패는 로그인 실패로 되돌리지 않고 알림 + 자동 재시도로 복구한다.
    // 현재 세대가 아니라 채택 시작 세대를 넘긴다 — 그 사이 바뀐 세션에 이 계정을 소유자로 적지 않는다.
    await recordOwnerWithRetry(account.id, adoptionGen);
    return account;
  };
  const conversionRef = useRef<ReturnType<typeof createMemberConversion> | null>(null);
  conversionRef.current ??= createMemberConversion({
    termsVersion: TERMS_VERSION,
    login: (provider, credential, termsVersion, options) =>
      apiLogin(provider, credential, termsVersion, {
        ...options,
        onSessionPublished: (session, generation) => {
          conversionSessionTransition.current = {
            provider,
            credential,
            userId: session.userId,
            generation,
          };
        },
      }),
    openPrompt: () => {
      if (TERMS_VERSION) setConvUi({ busy: null, error: null, termsAccepted: false });
    },
    confirmSwitch: () =>
      new Promise<boolean>((resolve) => {
        switchResolve.current = resolve;
        setSwitchAsk(true);
      }),
    adopt: async (result, previousUserId) => {
      // 세대가 바뀌어 채택을 중단했으면 전환 완료 안내·이벤트도 남기지 않는다(pickProvider).
      conversionAdoptionAborted.current = (await adoptSession(result, previousUserId)) === null;
    },
  });
  const startGuest = async () => {
    if (guestLoginFlight.current) return;
    socialLoginAttempt.current = null;
    conversionLoginAttempt.current = null;
    conversionRef.current?.clearPending();
    setConvUi(null);
    setTerms(false);
    settleSwitch(false);
    const previousUserId = REVIEW || DEMO ? null : getLastSessionUserId();
    guestLoginFlight.current = true;
    setGuestBusy(true);
    setGuestError('');
    try {
      const result = await guestLogin();
      // 채택 도중 세션이 바뀌어 중단됐으면(null) 완료 이벤트를 남기지 않는다.
      if (await adoptSession(result, previousUserId)) captureProductEvent('guest_login_completed');
    } catch (error) {
      setGuestError(
        error instanceof ApiError && error.message
          ? error.message
          : '게스트 계정을 열지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
    } finally {
      guestLoginFlight.current = false;
      setGuestBusy(false);
    }
  };
  const memberConversion = conversionRef.current;
  const conversionAdoptionPending = memberConversion.hasPendingAdoption();
  const closeMemberConversion = () => {
    // 서버 세션 발급 후 앱 채택(/me·로컬 상태 반영)이 실패한 경우 재시도 결과가
    // memberConversion 안에 보관돼 있다. 이 상태에서 닫으면 복구 자격을 잃는다.
    if (memberConversion.hasPendingAdoption()) return;
    conversionLoginAttempt.current = null;
    conversionSessionTransition.current = null;
    memberConversion.clearPending();
    setConvUi(null);
    setTerms(false);
    settleSwitch(false);
  };
  const getCredential = socialCredential;
  const startSocial = async (provider: Provider) => {
    if (!TERMS_VERSION || socialBusy || guestBusy || !terms) return;
    const previousUserId = REVIEW || DEMO ? null : getLastSessionUserId();
    const generation = sessionGeneration();
    if (
      socialLoginAttempt.current?.provider !== provider ||
      socialLoginAttempt.current.generation !== generation
    )
      socialLoginAttempt.current = null;
    setSocialBusy(provider);
    setSocialError('');
    try {
      let attempt = socialLoginAttempt.current;
      if (!attempt) {
        const credential = await getCredential(provider);
        if (generation !== sessionGeneration()) return;
        attempt = { provider, credential, attemptId: uuid(), generation };
        socialLoginAttempt.current = attempt;
      }
      const result = await apiLogin(provider, attempt.credential, TERMS_VERSION, {
        attemptId: attempt.attemptId,
      });
      socialLoginAttempt.current = null;
      if (await adoptSession(result, previousUserId))
        captureProductEvent('social_login_completed', { provider });
    } catch (thrown) {
      const retryableTransportFailure =
        thrown instanceof ApiError &&
        (thrown.retryable ||
          thrown.code === CLIENT_TIMEOUT ||
          thrown.code === CLIENT_NETWORK_ERROR);
      if (!retryableTransportFailure) socialLoginAttempt.current = null;
      if (!isSocialLoginCancellation(thrown)) {
        setSocialError(
          thrown instanceof ApiError && thrown.message
            ? thrown.message
            : '로그인을 완료하지 못했어요. 다시 시도해 주세요.',
        );
      }
    } finally {
      setSocialBusy(null);
    }
  };
  const pickProvider = async (provider: Provider) => {
    if (!TERMS_VERSION || !convUi?.termsAccepted || convUi.busy) return;
    const generation = sessionGeneration();
    if (
      conversionLoginAttempt.current?.provider !== provider ||
      conversionLoginAttempt.current.generation !== generation
    )
      conversionLoginAttempt.current = null;
    let attempt = conversionLoginAttempt.current;
    const attemptGeneration = generation;
    setConvUi((c) => (c ? { ...c, busy: provider, error: null } : c));
    try {
      if (!attempt) {
        const credential = await getCredential(provider);
        if (generation !== sessionGeneration()) {
          setConvUi((c) => (c ? { ...c, busy: null, termsAccepted: false } : c));
          return;
        }
        attempt = { provider, credential, generation };
        conversionLoginAttempt.current = attempt;
      }
      conversionAdoptionAborted.current = false;
      const outcome = await memberConversion.convert(attempt.provider, attempt.credential);
      if (conversionLoginAttempt.current === attempt) conversionLoginAttempt.current = null;
      if (conversionAdoptionAborted.current) {
        // 전환하던 세션이 이미 사라졌다 — 시트만 조용히 닫는다.
        setConvUi(null);
        return;
      }
      if (outcome === 'converted') {
        captureProductEvent('member_conversion_completed', { provider: attempt.provider });
        setConvUi(null);
        notify('회원으로 전환했어요.');
      } else setConvUi((c) => (c ? { ...c, busy: null } : c)); // 취소 — 시트로 돌아간다
    } catch (thrown) {
      const retryableTransportFailure =
        thrown instanceof ApiError &&
        (thrown.retryable ||
          thrown.code === CLIENT_TIMEOUT ||
          thrown.code === CLIENT_NETWORK_ERROR);
      const conversionSessionWasPublished =
        attempt !== null &&
        attempt.generation !== attemptGeneration &&
        attempt.generation === sessionGeneration();
      if (
        !retryableTransportFailure &&
        !conversionSessionWasPublished &&
        conversionLoginAttempt.current === attempt
      )
        conversionLoginAttempt.current = null;
      if (isSocialLoginCancellation(thrown)) {
        setConvUi((c) => (c ? { ...c, busy: null, error: null } : c));
        return;
      }
      const message =
        thrown instanceof ApiError ? thrown.message : '문제가 생겼어요. 다시 시도해 주세요.';
      setConvUi((c) => (c ? { ...c, busy: null, error: message } : c));
    } finally {
      conversionSessionTransition.current = null;
    }
  };
  useEffect(() => {
    if (REVIEW || DEMO) {
      setHasServerSession(false);
      return;
    }
    return subscribeSession((session) => {
      const generation = sessionGeneration();
      if (generation !== socialAttemptGeneration.current) {
        const transition = conversionSessionTransition.current;
        const expectedConversionTransition =
          transition?.generation === generation && transition.userId === session?.userId;
        conversionSessionTransition.current = null;
        socialAttemptGeneration.current = generation;
        socialLoginAttempt.current = null;
        setTerms(false);
        if (expectedConversionTransition && conversionLoginAttempt.current) {
          const attempt = conversionLoginAttempt.current;
          if (
            attempt.provider === transition.provider &&
            attempt.credential === transition.credential
          )
            attempt.generation = generation;
          else {
            conversionLoginAttempt.current = null;
            conversionRef.current?.clearPending();
          }
        } else {
          conversionLoginAttempt.current = null;
          conversionRef.current?.clearPending();
          settleSwitch(false);
        }
        setConvUi((current) =>
          session
            ? current
              ? {
                  ...current,
                  // 이 전환에서 로그인 세션을 이미 발급받은 뒤 채택만 재시도하는 경우엔
                  // 같은 동의를 유지한다. 복구 대기 중 체크를 해제하면 재시도할 수 없다.
                  termsAccepted: expectedConversionTransition ? current.termsAccepted : false,
                }
              : current
            : null,
        );
      }
      setHasServerSession(session !== null);
    });
  }, []);
  useEffect(() => {
    if (!loaded || REVIEW || DEMO) return;
    return subscribeSession((session) => {
      if (session) identifyPostHogUser(session.userId);
      else resetPostHogUser();
    });
  }, [loaded]);
  useEffect(() => {
    if (loaded && !REVIEW && !DEMO) trackPostHogScreen(route);
  }, [loaded, route]);
  // 서버가 세션을 거절하면(401) 저장소는 client 가 이미 비웠다 — 화면만 로그인으로 되돌린다.
  useEffect(() => {
    if (REVIEW || DEMO) return;
    setSessionLostHandler(() => {
      // 전환 시트·충돌 확인이 열려 있으면 취소로 정리한다 — 떠난 세션의 확인을 뒤에 승인하면 안 된다.
      socialLoginAttempt.current = null;
      conversionLoginAttempt.current = null;
      conversionSessionTransition.current = null;
      conversionRef.current?.clearPending();
      setConvUi(null);
      setTerms(false);
      settleSwitch(false);
      dispatch({ type: 'LOGOUT' });
      void endLiveActivities().catch(() => {});
      reset('login');
    });
    return () => setSessionLostHandler(null);
  }, []);
  useEffect(() => {
    const mock = REVIEW || DEMO;
    Promise.all([
      mock ? Promise.resolve(null) : AsyncStorage.getItem(STORAGE),
      // 보안 저장소의 인증 세션. 있으면 /me 로 «아직 유효한가»까지 확인한다 — 폐기된 세션으로
      // 홈에 들어가면 다음 요청에서야 401 이 나고, 그때는 원인이 로그인이라는 것이 안 보인다.
      mock ? Promise.resolve(null) : restoreSession(),
    ])
      .then(async ([raw, session]) => {
        // 「거절(재로그인)」·「확인 실패(오프라인)」·「정상」 셋을 가른다 — checkSession 참조.
        const check = session ? await checkSession() : null;
        const account = check?.status === 'active' ? check.account : null;
        const rejected = check?.status === 'rejected';
        const saved = raw ? JSON.parse(raw) : null;
        const loadable = saved?.version === 1 ? saved : null;
        const restoredUserId = session?.userId ?? null;
        const ownerUserId = getLastSessionUserId();
        const ownerMismatch =
          restoredUserId !== null && ownerUserId !== null && restoredUserId !== ownerUserId;
        if (ownerMismatch) {
          setStorageOwnerGate(false);
          deferredOwnerState.current = loadable ? { userId: ownerUserId!, state: loadable } : null;
        }
        // owner가 다른 세션은 서버 확인 전까지 메모리에 올리지 않는다. 오프라인·거절일 때
        // 이전 사용자의 저장본은 디스크에 보존하고 빈 상태가 덮어쓰지 않도록 저장도 막는다.
        const bootSaved = ownerMismatch ? null : loadable;
        if (bootSaved) {
          // `now` 는 티켓 1941 이 더했다 — LOAD 리듀서가 멈춘 집중의 경과를 그 시각 기준으로
          // 되살린다. 복구 «경로» 판정은 restoredRoute 가 하므로 여기서 reducer 를 한 번 더
          // 돌려 restored 를 만들지 않는다.
          dispatch({ type: 'LOAD', state: bootSaved, now: Date.now() });
          // ⚠️ LOAD 가 저장본의 loggedIn:true 를 되살린다 — 거절된 세션이면 여기서 다시 내린다.
          // 안 내리면 화면만 로그인이고 저장 effect 가 true 를 다시 써서, 다음 실행에
          // 보안 저장소가 비었는데도 로컬 경로로 홈에 들어간다.
          if (rejected) dispatch({ type: 'LOGOUT' });
        }
        // ⚠️ 서버가 계정을 확인해 줬으면 **로컬 로그인 상태도 맞춘다.** 저장본이 없거나(iOS 재설치)
        // loggedIn:false 인 저장본이면 경로만 바뀌고 state.loggedIn 은 false 로 남는데, 그 값이 곧
        // 저장 effect 로 다시 쓰인다. 그러면 다음 «오프라인» 실행에서 checkSession 이 확인 실패로
        // 끝나 account 가 null 이 되고, restoredRoute 가 `!saved.loggedIn` 을 보고 멀쩡한 세션을
        // 두고 로그인 화면을 고른다.
        if (account) dispatch({ type: 'LOGIN', linkedProviders: account.linkedProviders });
        // 세션이 유효하면 섬 소속·대기 신청도 서버 정본으로 맞춘다(GROMO-2006). 실패·모순 응답은
        // 로컬 저장본으로 home에 들어가지 않고 chooseIsland의 명시 오류+재시도로 보낸다.
        // 부팅 인증 세대는 checkSession 결과 직후 포획한다 — 동기화 도중 401이 나면 세션 상실
        // 핸들러가 login으로 돌리고 세대가 올라가므로, stale account로 route를 덮어쓰지 않는다.
        const bootGen = sessionGeneration();
        let bootSyncSucceeded = false;
        const bootRoute = await decideBootRoute({
          saved: bootSaved,
          account,
          rejected,
          serverMode: !!(account && !mock),
          bootGen,
          generation: sessionGeneration,
          syncIslands: async () => {
            const result = await syncIslands();
            bootSyncSucceeded = true;
            return result;
          },
          onBootError: setIslandBootError,
        });
        // decideBootRoute 반환과 적용 사이도 await 경계다 — 그 사이 세대가 죽었으면 쓰지 않는다
        if (bootRoute && sessionGeneration() === bootGen) setRoute(bootRoute);
        if (ownerMismatch && account && session && sessionGeneration() === bootGen) {
          const bootSessionIsCurrent = () =>
            sessionGeneration() === bootGen && getSession()?.userId === session.userId;
          // 부팅 채택도 일반 계정 전환과 같은 의미를 지킨다: 활성 계정의 정본 동기화 후
          // 사용자 데이터 제거 → 깨끗한 상태 적용 → 마지막에 내구 owner 기록 순서다.
          // 저장본 정리·clean LOAD·route는 한 번만 한다. 재시도는 남은 owner 기록부터 이어 간다.
          let cleaned = false;
          const transferOwner = async () => {
            if (!bootSessionIsCurrent()) return;
            if (!cleaned) {
              await AsyncStorage.removeItem(STORAGE);
              deferredOwnerState.current = null;
              // 저장소 삭제 중 로그아웃·다른 계정 로그인으로 세대가 바뀌었을 수 있다.
              // 이전 계정의 clean LOAD/PROFILE을 새 세션에 적용하지 않는다.
              if (!bootSessionIsCurrent()) return;
              dispatch({
                type: 'LOAD',
                state: {
                  ...initialState(DEMO),
                  settings: loadable?.settings ?? stateRef.current.settings,
                },
                now: Date.now(),
              });
              // 위에서 확인한 계정/섬 동기화 결과는 초기 LOAD가 지운다. 깨끗한 로컬 상태에 계정을
              // 다시 적용하고 동기화/route를 한 번 더 수행해 최종 reducer 상태와 화면을 맞춘다.
              dispatch({ type: 'LOGIN', linkedProviders: account.linkedProviders });
              if (account.name || account.catColor)
                dispatch({
                  type: 'PROFILE',
                  name: account.name ?? undefined,
                  color: account.catColor ?? undefined,
                });
              const cleanBootGen = sessionGeneration();
              const cleanBootRoute = await decideBootRoute({
                saved: null,
                account,
                rejected: false,
                serverMode: true,
                bootGen: cleanBootGen,
                generation: sessionGeneration,
                syncIslands,
                onBootError: setIslandBootError,
              });
              // 두 번째 서버 동기화/route 결정도 await 경계다. 세션이 바뀌었다면 route와 owner를
              // 이전 부팅 계정으로 확정하지 않는다.
              if (!bootSessionIsCurrent()) return;
              if (cleanBootRoute && sessionGeneration() === cleanBootGen) setRoute(cleanBootRoute);
              cleaned = true;
            }
            if (!bootSessionIsCurrent()) return;
            if (!(await rememberLocalDataOwner(session.userId, bootGen))) {
              // 삭제 표식 읽기 실패 등으로 기록이 거절됐다. 실패로 알려 다음 재시도에 다시 보류한다.
              if (bootSessionIsCurrent())
                throw new Error('로컬 데이터 소유자를 기록하지 못했어요.');
              return;
            }
            if (bootSessionIsCurrent()) setStorageOwnerGate(true);
          };
          // 정본 동기화가 실패했으면 소유자 전환을 보류한다 — chooseIsland 재시도 성공 뒤에 끝낸다.
          // 부팅 중 owner 기록이 거절돼도 같은 재시도 경로로 넘긴다.
          if (bootSyncSucceeded && bootRoute)
            await transferOwner().catch(() => {
              pendingBootOwnerTransfer.current = transferOwner;
            });
          else pendingBootOwnerTransfer.current = transferOwner;
        }
        // GROMO-2009 집중 세션 복구 — 서버 정본의 진행 세션(active→낚시, paused→모닥불)과
        // 자동 종료 미확인 결과(→결과창)를 부팅 경로보다 우선한다. 실패하면 부팅 경로를 유지한다.
        if (account && !mock && sessionGeneration() === bootGen) {
          const recovered = await focusCmds.current!.commands.recover().catch(() => null);
          if (recovered && sessionGeneration() === bootGen) setRoute(recovered);
        }
      })
      .catch(() => notify('저장된 상태를 불러오지 못했어요.'))
      .finally(() => setLoaded(true));
  }, []);
  const kickedDestination =
    ['visit', 'travel'].includes(route) &&
    state.islands.some((candidate) => candidate.id === (detail || visited) && candidate.kicked);
  useEffect(() => {
    if (!loaded || !state.loggedIn) return;
    if (state.membershipRecovery || kickedDestination) {
      setModal(null);
      setWalkRequest(null);
      setVisited(state.onboarded ? state.islandId : '');
      reset(state.onboarded ? 'home' : 'chooseIsland');
      if (state.membershipRecovery) dispatch({ type: 'MEMBERSHIP_RECOVERY_HANDLED' });
      return;
    }
    if (state.onboarded) return;
    if (
      ['login', 'character', 'chooseIsland', 'createIsland', 'joinIsland', 'approval'].includes(
        route,
      )
    )
      return;
    // 마지막 소속에서 강퇴되거나 동기화 결과 소속이 0개가 되면 이전 화면 기록까지 지운다.
    reset('chooseIsland');
  }, [
    loaded,
    state.loggedIn,
    state.onboarded,
    state.islandId,
    state.membershipRecovery,
    kickedDestination,
    route,
  ]);
  useEffect(() => {
    if (loaded && state.onboarded && !qaBuildingsReady)
      dispatch({ type: 'QA_COMPLETE_ALL_BUILDINGS' });
  }, [loaded, state.onboarded, state.islandId, qaBuildingsReady]);
  useEffect(() => {
    if (!loaded) return;
    const restoring = !tutorialBootReconciled.current;
    const returningHome = route === 'home' && previousTutorialRoute.current !== 'home';
    previousTutorialRoute.current = route;
    tutorialBootReconciled.current = true;
    const next = reconcileTutorial(state, route, restoring || returningHome);
    if (next !== guideStep)
      setGuideStep(next, { step: guideStep, revision: state.tutorialRevision ?? 0 });
    if (route === 'home' && state.tutorial && next <= 3) reset('guide');
    if (route === 'guide' && !state.tutorial) setGuideStep(0);
  }, [loaded, route, state.tutorial, state.session, state.lastResult]);
  useEffect(() => {
    if (
      loaded &&
      storageOwnerReady &&
      storageOwnerReadyRef.current &&
      qaBuildingsReady &&
      !REVIEW &&
      !DEMO
    ) {
      const snapshot = JSON.stringify(state);
      const write = userStorageWriteQueue.current.then(async () => {
        if (!storageOwnerReadyRef.current) return;
        await AsyncStorage.setItem(STORAGE, snapshot);
      });
      userStorageWriteQueue.current = write.catch(() => {
        notify('기기 저장 공간을 확인해 주세요.');
      });
    }
  }, [state, loaded, storageOwnerReady, qaBuildingsReady]);
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setNow(now);
      dispatch({ type: 'TICK', now });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (v) dispatch({ type: 'SETTING', key: 'reduceMotion', value: true });
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    let request = 0;
    const syncPermission = async () => {
      if (Platform.OS === 'android') {
        const current = ++request;
        const generation = sessionGeneration();
        dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
        try {
          const snapshot = await syncAndroidScreenTime();
          if (active && current === request && generation === sessionGeneration())
            dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot, now: Date.now() });
        } catch {
          const status = await screenTime.getAuthorizationStatus().catch(() => 'unavailable');
          if (active && current === request && generation === sessionGeneration())
            dispatch({
              type: 'SCREEN_TIME_SNAPSHOT',
              snapshot: {
                approved: status === 'approved',
                date: dayKey(),
                minutes: null,
                history: [],
                unconfirmedDays: [],
              },
              now: Date.now(),
            });
        }
        return;
      }
      if (Platform.OS !== 'ios') {
        if (!REVIEW && !DEMO) {
          dispatch({ type: 'SETTING', key: 'permission', value: false });
          dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: false });
        }
        dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
        return;
      }
      dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
      try {
        const status = await screenTime.getAuthorizationStatus();
        const approved = status === 'approved';
        dispatch({ type: 'SETTING', key: 'permission', value: approved });
        if (!approved) {
          dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: false });
          const unconfirmedDays = await screenTime
            .markCurrentUsageBucketUnconfirmed()
            .catch(() => []);
          dispatch({ type: 'SCREEN_TIME_UNCONFIRMED', days: unconfirmedDays });
          return;
        }
        await screenTime.promotePendingSelectionIfDue().catch(() => false);
        const selection = await screenTime.getMeasurementSelectionCounts();
        const measurementReady = selectionCount(selection) > 0;
        dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: measurementReady });
        if (!measurementReady) {
          dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
          return;
        }
        const [minutes, history, unconfirmedDays] = await Promise.all([
          screenTime.getTodayUsageBucketMinutes(),
          screenTime.getUsageBucketHistory(),
          screenTime.getUnconfirmedUsageBucketDays(),
        ]);
        dispatch({ type: 'SCREEN_TIME_UNCONFIRMED', days: unconfirmedDays });
        dispatch({ type: 'SCREEN_TIME_HISTORY', buckets: history, now: Date.now() });
        dispatch({ type: 'SCREEN_TIME', value: minutes });
      } catch {}
    };
    void syncPermission();
    let syncedDay = dayKey();
    const dayChangeTimer = setInterval(() => {
      const currentDay = dayKey();
      if (currentDay === syncedDay) return;
      syncedDay = currentDay;
      void syncPermission();
    }, 1000);
    const usageTimer =
      Platform.OS === 'android'
        ? setInterval(() => {
            if (AppState.currentState === 'active') void syncPermission();
          }, 60000)
        : undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void syncPermission();
    });
    return () => {
      active = false;
      request++;
      clearInterval(usageTimer);
      clearInterval(dayChangeTimer);
      subscription.remove();
    };
  }, [loaded]);
  useEffect(() => {
    if (!loaded || Platform.OS !== 'ios') return;
    if (state.session?.status === 'active') {
      screenTime.startFocusShield(state.session.subject).catch(() => {});
    } else {
      screenTime.stopFocusShield().catch(() => {});
    }
  }, [loaded, state.session?.id, state.session?.status, state.session?.subject]);
  useEffect(() => {
    if (!loaded || Platform.OS !== 'ios') return;
    const session = REVIEW || DEMO || hasServerSession ? state.session : null;
    const counts =
      session && liveCounts?.sessionId === session.id && liveCounts.islandId === session.islandId
        ? liveCounts
        : null;
    void syncLiveActivity(session, state.color, counts).catch(() => {});
  }, [
    loaded,
    hasServerSession,
    state.session?.id,
    state.session?.islandId,
    state.session?.status,
    state.session?.subject,
    state.session?.startedAt,
    state.session?.restStartedAt,
    state.session?.seconds,
    state.color,
    liveCounts,
  ]);
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    const openActivity = (url: string | null) => {
      const session = stateRef.current.session;
      if (active && url?.startsWith('com.oneorthree.focuscat://activity') && session) {
        replace(session.status === 'paused' ? 'rest' : 'focus');
      }
    };
    const subscription = Linking.addEventListener('url', ({ url }) => openActivity(url));
    void Linking.getInitialURL().then(openActivity);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [loaded]);
  useEffect(() => {
    if (!loaded || !hasServerSession || REVIEW || DEMO) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, [loaded, hasServerSession]);
  useEffect(() => {
    if (!loaded || !hasServerSession || REVIEW || DEMO || AppState.currentState !== 'active')
      return;
    const session = stateRef.current.session;
    if (session && shouldPollExpiredRest(session, now, restRecovery.current)) {
      // 서버 자동 종료 스케줄러가 다음 분에 실행될 수 있어 만료 후에도 간격을 두고 재조회한다.
      void recoverExpiredRest(session.id);
    }
  }, [loaded, hasServerSession, now]);
  useEffect(() => {
    if (!loaded) return;
    transition.stopAnimation();
    transition.setValue(state.settings.reduceMotion ? 1 : 0);
    // JS 드라이버: 네이티브 드라이버는 iOS 에서 전환 중 화면(도서관 JPEG 배경 등)이 다시 커밋되면
    // 중간 opacity 가 남아 화면이 뿌옇게 굳는다
    Animated.timing(transition, {
      toValue: 1,
      duration: state.settings.reduceMotion ? 0 : 160,
      useNativeDriver: false,
    }).start();
  }, [route, loaded, reviewEpoch]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // 구경 중 홈의 뒤로가기는 `원래 섬으로`와 같다: 배를 타고 내 섬으로 돌아간다
      if (route === 'home' && state.visitingIslandId) {
        dispatch({ type: 'TRAVEL_FROM', name: viewIsland(state).name });
        dispatch({ type: 'END_VISIT' });
        go('travel', island.id);
        return true;
      }
      // 방문 화면의 시스템 뒤로가기도 하단 `원래 섬으로` 버튼과 같이 귀환 항해를 시작한다.
      if (route === 'visitIsland' && state.visitingIslandId) {
        dispatch({ type: 'TRAVEL_FROM', name: viewIsland(state).name });
        dispatch({ type: 'END_VISIT' });
        go('travel', island.id);
        return true;
      }
      if (route === 'home') return cancelBuildingTransition();
      if (route === 'login') return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [history, route, modal, state.visitingIslandId, island.id]);
  // 섬 음악은 집중 중이거나 축음기 시트를 보고 있을 때 들린다. 시트를 떠나면 집중 중이 아닐 때 멈춘다
  const islandAudioOn = island.playing && (state.session?.status === 'active' || route === 'sound');
  useEffect(() => {
    if (previewAudio) return;
    let cancelled = false;
    try {
      const source = bundledAudioSource(island.track);
      if (source === null) {
        player.pause();
        return;
      }
      player.replace(source);
      player.loop = true;
      const seek = island.serverPlayback
        ? playbackSeekSeconds(island.serverPlayback, island.serverPlaybackObservedAtMs)
        : 0;
      Promise.resolve(player.seekTo(seek))
        .then(() => {
          if (cancelled) return;
          if (islandAudioOn) player.play();
          else player.pause();
        })
        .catch(() => {});
    } catch {}
    return () => {
      cancelled = true;
    };
  }, [
    island.track,
    island.id,
    island.serverPlayback?.version,
    island.serverPlayback?.serverNow,
    island.serverPlaybackObservedAtMs,
    previewAudio,
    islandAudioOn,
  ]);
  useEffect(() => {
    if (!island.playbackReset) return;
    try {
      player.pause();
      player.seekTo(0).catch(() => {});
    } catch {}
  }, [island.id, island.playbackReset]);
  useEffect(() => {
    if (route !== 'product') setPreviewAudio(false);
  }, [route]);
  // GROMO-1839 시작·가입 화면만 세로로 고정하고 나머지는 기기 방향을 따른다
  useRouteOrientation(route);
  useEffect(() => {
    try {
      player.volume = state.settings.sound ? (state.settings.volume ?? 0.55) : 0;
      islandAudioOn ? player.play() : player.pause();
    } catch {}
  }, [islandAudioOn, state.settings.sound, state.settings.volume]);
  useEffect(() => {
    if (route === 'travel' || route === 'arrival') {
      boatTravel.setValue(-180);
      Animated.timing(boatTravel, {
        toValue: 350,
        duration: state.settings.reduceMotion ? 1 : 3000,
        useNativeDriver: true,
      }).start();
    }
  }, [route]);
  useEffect(() => {
    if (!REVIEW || !loaded) return;
    (window as any).__gromoReview = {
      dispatch,
      // 안드로이드 뒤로가기와 같은 동작(검수 스크립트용)
      back,
      state,
      route,
      walkRequest,
      walk: (r: Route) => setWalkRequest(r),
      open: (r: Route, opts: any = {}) => {
        if (opts.state) dispatch({ type: 'LOAD', state: opts.state });
        setModal(null);
        setToast('');
        setEmote(null);
        setPreviewAudio(false);
        setReviewEpoch((n) => n + 1);
        setHistory([]);
        setRoute(r);
        setDetail(opts.detail || '');
        setTab(opts.tab || '');
        setText(opts.text || '');
        setBody(opts.body || '');
        setRestTravel(!!opts.travel);
        setGuideStep(opts.guideStep || 0);
        setFailNext(!!opts.failNext);
        setWalkRequest(null);
      },
      fixture: initialState,
    };
  }, [loaded, state, route, walkRequest]);
  const walkTo = (r: Route) => {
    setWalkRequest(r);
    setHistory([]);
    transitionRoute('home');
  };
  const build = (b: Building) => {
    const error = canBuild(state, b);
    if (error) {
      notify(error);
      return;
    }
    confirm(
      buildingNames[b] + ' 짓기',
      `섬 물고기 ${buildingCost(island, b)}마리를 차감하고 ${buildMinutes[b]}분 동안 공사해요.`,
      () => {
        dispatch({ type: 'BUILD', building: b });
        notify(buildingNames[b] + ' 공사를 시작했어요.');
      },
    );
  };
  const openFacility = (b: Building, r: Route) => {
    if (!island.buildings.includes(b)) {
      notify(buildingNames[b] + ' 건설 후 이용할 수 있어요.');
      return;
    }
    go(r);
  };
  const newQuest = () => {
    go('questEdit');
    setText('');
    setBody('focus');
    setWindowStart('00:00');
    setWindowEnd('24:00');
  };
  // 정책: 「로그아웃은 서버 데이터를 유지하고 현재 기기 세션만 종료한다」. 서버 호출이 실패해도
  // 로컬 세션은 지워지므로(auth.logout) 화면은 기다리지 않고 바로 로그인으로 간다.
  // 로그인 화면으로 넘어가도 되면 true. 기기에 로그아웃을 기록하지 못하면 세션이 남으므로 false.
  const signOut = async (): Promise<boolean> => {
    let preparation: Promise<void> | undefined;
    if (!REVIEW && !DEMO) {
      preparation = prepareLogout();
      try {
        await preparation;
      } catch {
        notify('기기 저장 공간 문제로 로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return false;
      }
    }
    socialLoginAttempt.current = null;
    conversionLoginAttempt.current = null;
    conversionSessionTransition.current = null;
    conversionRef.current?.clearPending();
    setConvUi(null);
    setTerms(false);
    settleSwitch(false);
    void endLiveActivities().catch(() => {});
    // 확인한 준비 결과를 실제 정리에 넘긴다 — logout 이 다시 준비하면 그 실패는 여기서 못 본다.
    logout(preparation).catch(() => {});
    return true;
  };
  const send = () => {
    if (!text.trim()) return;
    dispatch({ type: 'MESSAGE', text, fail: failNext });
    setFailNext(false);
    setText('');
    setTimeout(
      () =>
        mailRef.current?.scrollToEnd({
          animated: !state.settings.reduceMotion,
        }),
      100,
    );
  };
  function render() {
    return (
      <RedesignScreens
        e={{
          state,
          route,
          termsVersion: TERMS_VERSION,
          routeTransitionShielded,
          dispatch,
          go,
          replace,
          reset,
          home,
          back,
          backOverride,
          notify,
          confirm,
          build,
          signOut,
          text,
          setText,
          body,
          setBody,
          tab,
          setTab,
          detail,
          now,
          terms,
          setTerms,
          loginProviders: TERMS_VERSION ? loginProviders() : [],
          startSocial: !TERMS_VERSION || REVIEW || DEMO ? undefined : startSocial,
          socialBusy,
          socialError,
          startGuest: REVIEW || DEMO ? undefined : startGuest,
          guestBusy,
          guestError,
          approval,
          setApproval,
          visited,
          setVisited,
          guideStep,
          setGuideStep,
          player,
          previewAudio,
          setPreviewAudio,
          walkTo,
          newQuest,
          walkRequest,
          restTravel,
          windowStart,
          setWindowStart,
          windowEnd,
          setWindowEnd,
          failNext,
          setFailNext,
          // 서버 명령은 실제 API 모드에서만 넘긴다 — REVIEW/DEMO는 undefined 라 화면이 목업 경로를 쓴다
          islands: REVIEW || DEMO || !hasServerSession ? undefined : islands,
          focus: REVIEW || DEMO || !hasServerSession ? undefined : focus,
          recoverExpiredRestConflict,
          onPresenceCounts: (
            sessionId: string,
            islandId: string,
            counts: { focus: number; rest: number } | null,
          ) => {
            setLiveCounts((previous) => {
              const next = counts ? { sessionId, islandId, ...counts } : null;
              return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
            });
          },
          islandBootError,
          // 서버 모드 홈 스냅샷 실패 표시·재시도(GROMO-2138)
          homeError,
          retryHome: () => setHomeReload((n) => n + 1),
          buildingIndicators: serverCurrent ? buildingIndicators : undefined,
          // 회원 전환 공통 진입점(GROMO-2005) — 게이트 거절을 받은 호출부가 conversion.offer(error) 로 연다.
          conversion:
            REVIEW || DEMO || !TERMS_VERSION || !hasServerSession ? undefined : memberConversion,
          playback: REVIEW || DEMO || !hasServerSession ? undefined : playback,
        }}
      />
    );
  }
  const immersive = [
    'home',
    'focusSetup',
    'focus',
    'focusVisit',
    'visitIsland',
    'visitIslandFocus',
    'rest',
    'arrival',
    'travel',
  ].includes(route);
  if (!loaded)
    return (
      <SafeAreaView style={[S.page, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.brown} />
        <T>내 섬을 불러오는 중이에요.</T>
      </SafeAreaView>
    );
  const appContentHidden =
    routeTransitionShielded ||
    buildingRouteCovered ||
    buildingTransitionActive ||
    fireTransition.phase !== 'idle';
  return (
    <MotionContext.Provider value={state.settings.reduceMotion}>
      <SafeAreaView edges={[]} style={[S.page, { backgroundColor: C.cream }]}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Animated.View
            key={reviewEpoch}
            testID="app-content"
            accessibilityElementsHidden={appContentHidden}
            importantForAccessibility={appContentHidden ? 'no-hide-descendants' : 'auto'}
            aria-hidden={appContentHidden}
            style={{
              flex: 1,
              opacity: transition,
              transform: [
                {
                  translateY: transition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [4, 0],
                  }),
                },
              ],
            }}
          >
            {render()}
          </Animated.View>
        </KeyboardAvoidingView>
        <RouteTransitionShield
          visible={routeTransitionShielded || buildingRouteCovered}
          coverLoading={buildingRouteCovered}
        />
        <BuildingTransitionOverlay
          state={fireTransition}
          reduceMotion={state.settings.reduceMotion}
          origin={{ x: layout.width / 2, y: layout.height / 2 }}
        />
        {toast !== '' && (
          <View
            testID="global-toast"
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            style={{
              position: 'absolute',
              // 키보드가 떠 있으면(편지 쓰기 등) 그만큼 더 띄워 소프트 키보드에 가리지 않게 한다.
              // Android 는 windowSoftInputMode=adjustResize 로 이 View 의 부모 영역이 이미 키보드
              // 높이만큼 줄어들어 있어 여기서 또 더하면 이중 보정이 된다(GROMO-2169 리뷰 지적) —
              // 키보드 높이 보정은 iOS 에서만 한다.
              bottom: 40 + (Platform.OS === 'android' ? 0 : keyboardHeight),
              left: (layout.width - layout.floatingWidth) / 2,
              width: layout.floatingWidth,
              backgroundColor: C.ink,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <Text style={{ color: C.paper, textAlign: 'center' }}>{toast}</Text>
          </View>
        )}
        {modal && (
          <Modal
            visible={true}
            transparent
            animationType={state.settings.reduceMotion ? 'none' : 'fade'}
            onRequestClose={() => setModal(null)}
          >
            <Pressable
              accessible={false}
              accessibilityElementsHidden={routeTransitionShielded}
              importantForAccessibility={routeTransitionShielded ? 'no-hide-descendants' : 'auto'}
              pointerEvents={routeTransitionShielded ? 'none' : 'auto'}
              onPress={() => setModal(null)}
              style={{
                flex: 1,
                backgroundColor: '#493B3966',
                justifyContent: 'center',
                alignItems: 'center',
                padding: 24,
              }}
            >
              <Pressable
                accessible={false}
                onPress={() => {}}
                style={[
                  S.card,
                  {
                    gap: 10,
                    // v2 확인창(.dlg): 세로 좌우 24 여백, 가로 폭 400
                    width: layout.compact
                      ? 400
                      : layout.tablet
                        ? layout.modalWidth
                        : layout.width - 48,
                    maxHeight: layout.height - layout.insets.top - layout.insets.bottom - 40,
                    borderWidth: 2,
                    borderRadius: 22,
                    paddingTop: 22,
                    paddingHorizontal: 20,
                    paddingBottom: 18,
                    boxShadow: '0px 6px 0px ' + C.brown,
                  },
                ]}
              >
                <NativeText kind="h17" style={{ lineHeight: 22.95 }}>
                  {modal?.title}
                </NativeText>
                {/* 한국어 문장은 단어 단위로 줄바꿈(시안 .dlg .body word-break:keep-all) */}
                <NativeText
                  lineBreakStrategyIOS="hangul-word"
                  style={[
                    { color: C.muted },
                    Platform.OS === 'web' && ({ wordBreak: 'keep-all' } as any),
                  ]}
                >
                  {modal?.text}
                </NativeText>
                <View style={[S.row, { justifyContent: 'flex-end', gap: 8, marginTop: 8 }]}>
                  <NativeButton dialog title="취소" kind="glass" onPress={() => setModal(null)} />
                  <NativeButton
                    dialog
                    title={modal.ok ?? '확인'}
                    kind={modal.destructive ? 'destructive' : ''}
                    onPress={() => {
                      const action = modal?.action;
                      setModal(null);
                      action?.();
                    }}
                  />
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        )}
        {/* 회원 전환 시트(GROMO-2005) — 게스트의 제한 행동이 게이트에 막혔을 때 여는 공통 진입점 */}
        {convUi && TERMS_VERSION && (
          <Modal
            visible={true}
            transparent
            animationType={state.settings.reduceMotion ? 'none' : 'fade'}
            onRequestClose={() => !convUi.busy && closeMemberConversion()}
          >
            <Pressable
              accessible={false}
              accessibilityElementsHidden={routeTransitionShielded}
              importantForAccessibility={routeTransitionShielded ? 'no-hide-descendants' : 'auto'}
              pointerEvents={routeTransitionShielded ? 'none' : 'auto'}
              onPress={() => !convUi.busy && closeMemberConversion()}
              style={{
                flex: 1,
                backgroundColor: '#493B3966',
                justifyContent: 'center',
                alignItems: 'center',
                padding: 24,
              }}
            >
              <Pressable
                accessible={false}
                onPress={() => {}}
                style={[
                  S.card,
                  {
                    gap: 10,
                    width: layout.compact
                      ? 400
                      : layout.tablet
                        ? layout.modalWidth
                        : layout.width - 48,
                    maxHeight: layout.height - layout.insets.top - layout.insets.bottom - 40,
                    borderWidth: 2,
                    borderRadius: 22,
                    paddingTop: 22,
                    paddingHorizontal: 20,
                    paddingBottom: 18,
                    boxShadow: '0px 6px 0px ' + C.brown,
                  },
                ]}
              >
                <ScrollView
                  style={{ flexShrink: 1, minHeight: 0 }}
                  contentContainerStyle={{ gap: 10 }}
                >
                  <NativeText kind="h17" style={{ lineHeight: 22.95 }}>
                    소셜 계정으로 계속하기
                  </NativeText>
                  <NativeText
                    lineBreakStrategyIOS="hangul-word"
                    style={[
                      { color: C.muted },
                      Platform.OS === 'web' && ({ wordBreak: 'keep-all' } as any),
                    ]}
                  >
                    친구 추가·편지·상점 구매는 회원 전환 후에 쓸 수 있어요.
                    {'\n'}지금 고양이와 섬은 그대로 이어져요.
                  </NativeText>
                  <Pressable
                    testID="member-conversion-terms"
                    accessibilityRole="checkbox"
                    accessibilityLabel={`약관 버전 ${TERMS_VERSION}에 동의합니다`}
                    accessibilityState={{
                      checked: convUi.termsAccepted,
                      disabled: !!convUi.busy || conversionAdoptionPending,
                    }}
                    disabled={!!convUi.busy || conversionAdoptionPending}
                    onPress={() =>
                      setConvUi((current) =>
                        current ? { ...current, termsAccepted: !current.termsAccepted } : current,
                      )
                    }
                    style={{
                      minHeight: semanticTokens.size.tapMin,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: semanticTokens.spacing.control,
                    }}
                  >
                    <View
                      style={{
                        width: primitiveTokens.space[6],
                        height: primitiveTokens.space[6],
                        borderWidth: semanticTokens.stroke.strong,
                        borderColor: semanticTokens.color.outline,
                        borderRadius: primitiveTokens.space[2],
                        backgroundColor: convUi.termsAccepted
                          ? semanticTokens.color.primary
                          : semanticTokens.color.surface,
                      }}
                    >
                      {convUi.termsAccepted && (
                        <NativeText style={{ textAlign: 'center' }}>✓</NativeText>
                      )}
                    </View>
                    <NativeText style={{ flex: 1 }}>
                      현재 약관 버전 {TERMS_VERSION}: 이용약관 및 개인정보처리방침에 동의합니다.
                    </NativeText>
                  </Pressable>
                  <PolicyLinks textStyle={{ color: C.muted }} />
                  {(TERMS_VERSION ? loginProviders() : []).map((provider) => (
                    <NativeButton
                      key={provider}
                      dialog
                      dynamicHeight
                      title={convUi.busy === provider ? '연결하는 중…' : PROVIDER_LABEL[provider]}
                      kind="sec"
                      disabled={!!convUi.busy || !convUi.termsAccepted}
                      onPress={() => void pickProvider(provider)}
                    />
                  ))}
                  {!!convUi.error && (
                    <NativeText style={{ color: C.danger, textAlign: 'center' }}>
                      {convUi.error}
                    </NativeText>
                  )}
                  <NativeButton
                    dialog
                    dynamicHeight
                    title="나중에"
                    kind="glass"
                    disabled={!!convUi.busy || conversionAdoptionPending}
                    onPress={closeMemberConversion}
                  />
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        )}
        {/* 기존 계정 충돌 확인(409) — 승인하면 게스트 데이터를 폐기하고 그 계정으로 전환한다 */}
        {switchAsk && (
          <Modal
            visible={true}
            transparent
            animationType={state.settings.reduceMotion ? 'none' : 'fade'}
            onRequestClose={() => settleSwitch(false)}
          >
            <View
              accessibilityElementsHidden={routeTransitionShielded}
              importantForAccessibility={routeTransitionShielded ? 'no-hide-descendants' : 'auto'}
              pointerEvents={routeTransitionShielded ? 'none' : 'auto'}
              style={{ flex: 1 }}
            >
              <Overlay close={() => settleSwitch(false)}>
                <NativeText kind="h17" style={{ lineHeight: 22.95 }}>
                  이미 연결된 계정이 있어요
                </NativeText>
                <NativeText
                  lineBreakStrategyIOS="hangul-word"
                  style={[
                    { color: C.muted },
                    Platform.OS === 'web' && ({ wordBreak: 'keep-all' } as any),
                  ]}
                >
                  이 소셜 계정은 다른 GROMO 계정에 연결돼 있어요. 기존 계정으로 전환하면 지금
                  게스트의 고양이·섬·기록은 삭제되고 되돌릴 수 없어요. 전환할까요?
                </NativeText>
                <View style={[S.row, { justifyContent: 'flex-end', gap: 8, marginTop: 8 }]}>
                  <NativeButton
                    dialog
                    dynamicHeight
                    title="취소"
                    kind="glass"
                    onPress={() => settleSwitch(false)}
                  />
                  <NativeButton
                    dialog
                    dynamicHeight
                    title="전환하기"
                    kind="destructive"
                    onPress={() => settleSwitch(true)}
                  />
                </View>
              </Overlay>
            </View>
          </Modal>
        )}
      </SafeAreaView>
    </MotionContext.Provider>
  );
}
