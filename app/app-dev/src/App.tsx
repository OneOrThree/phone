import { Text } from '@/design-system/typography';
import { useAppLayout } from '@/utils/layout';
import { useRouteOrientation } from '@/utils/orientation';
import { Btn as NativeButton, Txt as NativeText } from '@/design-system/patterns';
import { CurrentScreens as RedesignScreens } from '@/screens/island/CurrentScreens';
import React, { useState, useReducer, useEffect, useRef } from 'react';
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
  logout,
  type LoginResult,
  type Provider,
} from '@/services/api/auth';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { loadHomeSnapshot } from '@/services/homeSnapshot';
import {
  getSession,
  restoreSession,
  setSessionLostHandler,
  sessionGeneration,
  subscribeSession,
} from '@/services/api/session';
import { createIslandCommands } from '@/services/islandCommands';
import { createSessionCommands } from '@/services/sessionCommands';
import { decideBootRoute } from '@/services/islandBoot';
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
// 회원 전환(GROMO-2005)의 POST /auth/sessions 필수 필드. 서버가 수용 버전 목록을 비워 두는 동안
// (정책 Q05 미정) 형식만 검사한다 — 버전 표가 정해지면 이 상수만 바꾼다.
const TERMS_VERSION = '2026-09';
const PROVIDER_LABEL: Record<Provider, string> = {
  apple: 'Apple로 계속하기',
  google: 'Google로 계속하기',
  kakao: 'Kakao로 계속하기',
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
  guide: '앵무새 안내',
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
function Gromo() {
  const layout = useAppLayout();
  const insets = useScreenInsets();
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(DEMO));
  const [loaded, setLoaded] = useState(false),
    // 부팅 섬 동기화 실패 — chooseIsland가 명시 오류+재시도를 보여줄 플래그(로컬 폴백 금지)
    [islandBootError, setIslandBootError] = useState(false),
    [hasServerSession, setHasServerSession] = useState(() => getSession() !== null),
    [route, setRoute] = useState<Route>(DEMO ? 'home' : 'login'),
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
    [approval, setApproval] = useState(false),
    [emote, setEmote] = useState<string | null>(null),
    [now, setNow] = useState(Date.now()),
    [toast, setToast] = useState(''),
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
    [convUi, setConvUi] = useState<{ busy: Provider | null; error: string | null } | null>(null),
    // 기존 계정 충돌(409 SOCIAL_ACCOUNT_ALREADY_LINKED) 확인창 — 승인·취소는 switchResolve 가 돌려준다.
    [switchAsk, setSwitchAsk] = useState(false),
    [visited, setVisited] = useState('strawberry'),
    [guideStep, setGuideStep] = useState(0),
    [previewAudio, setPreviewAudio] = useState(false),
    [failNext, setFailNext] = useState(false),
    [walkRequest, setWalkRequest] = useState<Route | null>(null),
    [restTravel, setRestTravel] = useState(false),
    [reviewEpoch, setReviewEpoch] = useState(0);
  const [liveCounts, setLiveCounts] = useState<{
    sessionId: string;
    islandId: string;
    focus: number;
    rest: number;
  } | null>(null);

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
  const go = (r: Route, id = '') => {
    const gateBoard = shouldGateScreenTimeBoard(r, {
      isIOS: Platform.OS === 'ios',
      promptSeen: !!state.settings.screenTimeBoardPromptSeen,
    });
    const nextRoute: Route = gateBoard ? 'permission' : r;
    const nextDetail = gateBoard ? `board-first|${r}|${encodeURIComponent(id)}` : id;
    if (r === 'rest') setRestTravel(route === 'focus');
    if (r === 'home' || route === 'home') setWalkRequest(null);
    if (r === 'rest' && state.session?.status === 'active') dispatch({ type: 'PAUSE' });
    setDetail(nextDetail);
    setTab('');
    setText('');
    setBody('');
    setSearch('');
    setHistory((h) => [...h, { route, detail, tab, text, body }]);
    setRoute(nextRoute);
    if (state.settings.haptics && Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  };
  const replace = (r: Route, id = '') => {
    setDetail(id);
    setTab('');
    setText('');
    setBody('');
    setSearch('');
    setRoute(r);
  };
  const reset = (r: Route, id = '') => {
    setHistory([]);
    setDetail(id);
    setTab('');
    setText('');
    setBody('');
    setSearch('');
    setRoute(r);
  };
  const back = () => {
    if (modal) {
      setModal(null);
      return;
    }
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
      setRoute(previous.route);
      setDetail(previous.detail);
      setTab(previous.tab);
      setText(previous.text);
      setBody(previous.body);
      setHistory((h) => h.slice(0, -1));
    } else setRoute(state.onboarded ? 'home' : 'chooseIsland');
  };
  const home = () => {
    setWalkRequest(null);
    setHistory([]);
    setRoute('home');
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
  const goRef = useRef(go);
  goRef.current = go;
  const islandCmds = useRef<ReturnType<typeof createIslandCommands> | null>(null);
  islandCmds.current ??= createIslandCommands({
    dispatch,
    go: (r, id) => goRef.current(r as Route, id),
    getSnap: () => stateRef.current?.serverIslands,
    setBootError: setIslandBootError,
  });
  const islands = islandCmds.current.commands,
    syncIslands = islandCmds.current.syncIslands;
  // ── 서버 모드 홈 스냅샷(GROMO-2138) ──
  // 홈에 들어올 때마다(그리고 current 가 바뀌면) 불러 홈이 서버 값을 직접 그린다.
  // 실패는 홈이 재시도로 띄운다 — 로컬 목업 섬으로 대신 그리지 않는다.
  const [homeError, setHomeError] = useState(false),
    [homeReload, setHomeReload] = useState(0);
  const serverCurrent =
    !REVIEW && !DEMO && hasServerSession ? (state.serverIslands?.currentIslandId ?? null) : null;
  const onHome = route === 'home';
  useEffect(() => {
    if (!loaded || !serverCurrent || !onHome) return;
    let live = true;
    setHomeError(false);
    loadHomeSnapshot({ date: dayKey(), timezone: 'Asia/Seoul', isCurrent: () => live })
      .then((r) => {
        // select(current 없음)는 소속 동기화가 chooseIsland 로 보낸다
        if (live && r.status === 'loaded') dispatch({ type: 'SERVER_HOME', facts: r.facts });
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
      setRoute('focus');
      return;
    }
    focus
      .resume()
      .then(() => setRoute('focus'))
      .catch(async (error) => {
        if (await recoverExpiredRestConflict(error, session)) return;
        notify(error instanceof Error ? error.message : '집중을 이어가지 못했어요.');
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
  const adoptSession = (result: LoginResult, previousUserId: string | null) =>
    adoptSignedInAccount(result, previousUserId, {
      resetLocal: async () => {
        // 사용자 귀속 blob 전체를 지우고 빈 상태로 — 이전 계정의 섬·친구·진행이 섞이지 않는다.
        // settings 만 기기 귀속(정책 A15)이라 보존한다.
        await AsyncStorage.removeItem(STORAGE).catch(() => {});
        dispatch({
          type: 'LOAD',
          state: { ...initialState(DEMO), settings: stateRef.current.settings },
          now: Date.now(),
        });
      },
      applyAccount: (account) => {
        dispatch({ type: 'LOGIN' });
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
        const gen = sessionGeneration();
        const next = await decideBootRoute({
          saved: null,
          account,
          rejected: false,
          serverMode: true,
          bootGen: gen,
          generation: sessionGeneration,
          syncIslands,
          onBootError: setIslandBootError,
        });
        if (next && sessionGeneration() === gen) reset(next);
      },
    });
  const conversionRef = useRef<ReturnType<typeof createMemberConversion> | null>(null);
  conversionRef.current ??= createMemberConversion({
    termsVersion: TERMS_VERSION,
    openPrompt: () => setConvUi({ busy: null, error: null }),
    confirmSwitch: () =>
      new Promise<boolean>((resolve) => {
        switchResolve.current = resolve;
        setSwitchAsk(true);
      }),
    adopt: adoptSession,
  });
  const startGuest = async () => {
    if (guestLoginFlight.current) return;
    guestLoginFlight.current = true;
    setGuestBusy(true);
    setGuestError('');
    try {
      const result = await guestLogin();
      await adoptSession(result, null);
      captureProductEvent('guest_login_completed');
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
  // 소셜 제공자 SDK(Apple·Google·Kakao) 연결은 별도 티켓 — 연결 전까진 명시 오류로 끝낸다.
  // ponytail: 여기서 성공을 지어내면 승격·충돌 계약 검증이 불가능하다. SDK 도착 시 이 함수만 교체.
  const getCredential = async (_provider: Provider): Promise<string> => {
    throw new ApiError('CLIENT_PROVIDER_UNAVAILABLE', '소셜 로그인 연결을 준비 중이에요.', 0);
  };
  const pickProvider = async (provider: Provider) => {
    setConvUi((c) => (c ? { ...c, busy: provider, error: null } : c));
    try {
      const credential = await getCredential(provider);
      const outcome = await memberConversion.convert(provider, credential);
      if (outcome === 'converted') {
        captureProductEvent('member_conversion_completed', { provider });
        setConvUi(null);
        notify('회원으로 전환했어요.');
      } else setConvUi((c) => (c ? { ...c, busy: null } : c)); // 취소 — 시트로 돌아간다
    } catch (thrown) {
      const message =
        thrown instanceof ApiError ? thrown.message : '문제가 생겼어요. 다시 시도해 주세요.';
      setConvUi((c) => (c ? { ...c, busy: null, error: message } : c));
    }
  };
  useEffect(() => subscribeSession((session) => setHasServerSession(session !== null)), []);
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
    setSessionLostHandler(() => {
      // 전환 시트·충돌 확인이 열려 있으면 취소로 정리한다 — 떠난 세션의 확인을 뒤에 승인하면 안 된다.
      setConvUi(null);
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
        if (loadable) {
          // `now` 는 티켓 1941 이 더했다 — LOAD 리듀서가 멈춘 집중의 경과를 그 시각 기준으로
          // 되살린다. 복구 «경로» 판정은 restoredRoute 가 하므로 여기서 reducer 를 한 번 더
          // 돌려 restored 를 만들지 않는다.
          dispatch({ type: 'LOAD', state: loadable, now: Date.now() });
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
        if (account) dispatch({ type: 'LOGIN' });
        // 세션이 유효하면 섬 소속·대기 신청도 서버 정본으로 맞춘다(GROMO-2006). 실패·모순 응답은
        // 로컬 저장본으로 home에 들어가지 않고 chooseIsland의 명시 오류+재시도로 보낸다.
        // 부팅 인증 세대는 checkSession 결과 직후 포획한다 — 동기화 도중 401이 나면 세션 상실
        // 핸들러가 login으로 돌리고 세대가 올라가므로, stale account로 route를 덮어쓰지 않는다.
        const bootGen = sessionGeneration();
        const bootRoute = await decideBootRoute({
          saved: loadable,
          account,
          rejected,
          serverMode: !!(account && !mock),
          bootGen,
          generation: sessionGeneration,
          syncIslands,
          onBootError: setIslandBootError,
        });
        // decideBootRoute 반환과 적용 사이도 await 경계다 — 그 사이 세대가 죽었으면 쓰지 않는다
        if (bootRoute && sessionGeneration() === bootGen) setRoute(bootRoute);
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
    if (loaded && qaBuildingsReady && !REVIEW && !DEMO)
      AsyncStorage.setItem(STORAGE, JSON.stringify(state)).catch(() =>
        notify('기기 저장 공간을 확인해 주세요.'),
      );
  }, [state, loaded, qaBuildingsReady]);
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
      if (route === 'home' || route === 'login') return false;
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
    setRoute('home');
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
  const signOut = () => {
    void endLiveActivities().catch(() => {});
    logout().catch(() => {});
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
          // 회원 전환 공통 진입점(GROMO-2005) — 게이트 거절을 받은 호출부가 conversion.offer(error) 로 연다.
          conversion: REVIEW || DEMO || !hasServerSession ? undefined : memberConversion,
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
        {toast !== '' && (
          <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            style={{
              position: 'absolute',
              bottom: 40,
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
        {convUi && (
          <Modal
            visible={true}
            transparent
            animationType={state.settings.reduceMotion ? 'none' : 'fade'}
            onRequestClose={() => !convUi.busy && setConvUi(null)}
          >
            <Pressable
              accessible={false}
              onPress={() => !convUi.busy && setConvUi(null)}
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
                {(['apple', 'google', 'kakao'] as const).map((provider) => (
                  <NativeButton
                    key={provider}
                    dialog
                    title={convUi.busy === provider ? '연결하는 중…' : PROVIDER_LABEL[provider]}
                    kind="sec"
                    disabled={!!convUi.busy}
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
                  title="나중에"
                  kind="glass"
                  disabled={!!convUi.busy}
                  onPress={() => setConvUi(null)}
                />
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
            <Pressable
              accessible={false}
              onPress={() => settleSwitch(false)}
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
                    title="취소"
                    kind="glass"
                    onPress={() => settleSwitch(false)}
                  />
                  <NativeButton
                    dialog
                    title="전환하기"
                    kind="destructive"
                    onPress={() => settleSwitch(true)}
                  />
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </SafeAreaView>
    </MotionContext.Provider>
  );
}
