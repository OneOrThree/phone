import { getAssetRepository } from '@/services/assets/repository';
import { syncAndroidMeasurement, syncAndroidFocus } from '@/services/androidScreenTime';
import { startLiveActivityPushSync } from '@/services/liveActivityPush';
import { updateIOSHomeWidget } from '@/services/iosHomeWidget';
import { shouldReportShieldFailure, syncFocusShield } from '@/services/focusShield';
import { Text } from '@/design-system/typography';
import { useAppLayout } from '@/utils/layout';
import { useRouteOrientation } from '@/utils/orientation';
import { DeveloperLetter } from '@/screens/letter/DeveloperLetter';
import { useDeveloperLetter } from '@/screens/letter/useDeveloperLetter';
import { useForceUpdateLetter } from '@/screens/letter/useForceUpdateLetter';
import { isLetterReady, STORE_URLS, visibleAt } from '@/services/developerLetter';
import { Btn as NativeButton, Overlay, Txt as NativeText } from '@/design-system/patterns';
import {
  CurrentScreens as RedesignScreens,
  FocusBlockingIntro,
} from '@/screens/island/CurrentScreens';
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
import { screenTime } from '@/services/screenTime';
import {
  endLiveActivities,
  shouldPollExpiredRest,
  shouldReconcileExpiredRest,
  syncLiveActivity,
} from '@/services/liveActivity';
import { shouldGateFocusBlockingIntro, shouldGateScreenTimeBoard } from '@/services/screenTimeFlow';
import { saveAccountGuides } from '@/services/accountGuides';
import { reconcileTutorial } from '@/services/tutorial';
import { syncIOSScreenTime } from '@/services/iosScreenTimeSync';
import { reportScreenTime, subscribeScreenTimeReporting } from '@/services/screenTimeReporting';
import { clearStudyWidget } from '@/services/studyWidget';
import { settleWithdrawalIntent } from '@/services/withdrawalIntent';
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
import { Flag, BoatPortrait, IslandDecor, IslandPreview } from '@/screens/cosmetics/Cosmetics';
import { IslandDiscovery } from '@/screens/discovery/IslandDiscovery';
import { FocusSea, clock } from '@/screens/focus/FocusSea';
import {
  initialState,
  demoState,
  reducer,
  displayIsland as currentIsland,
  viewIsland,
  serverHome,
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
  State,
  Route,
  Building,
  Quest,
  Member,
  dayKey,
  seaRouteHeld,
  visitRouteHeld,
  sessionRoute,
  tickIdle,
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
import { type HomeSnapshot, loadHomeSnapshot } from '@/services/homeSnapshot';
import {
  getLastSessionUserId,
  isLocalDataOwnerUnknown,
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
import { islandErrorMessage } from '@/services/islandErrors';
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
import { PostHogAnalyticsProvider } from '@/services/PostHogAnalyticsProvider';
import { startSocialAnalytics } from '@/services/socialAnalytics';
import { startMetaTracking } from '@/services/metaSdk';
import {
  refreshPush,
  requestPushPermission,
  startPushSync,
  unregisterPushDevice,
} from '@/services/push';
import {
  captureProductEvent,
  identifyPostHogUser,
  resetPostHogUser,
  trackPostHogScreen,
} from '@/services/posthog';
import {
  applyLocalePref,
  errorTextOr,
  LEGACY_LOCALE_KEY,
  LOCALE_KEY,
  t,
  type LocalePref,
} from '@/i18n';
import { isDemoMode, isReviewMode } from '@/services/demoMode';
// 판정 정본은 services/demoMode — 회관·게시판·우체통·posthog 도 같은 함수를 본다
const REVIEW = isReviewMode();
const DEMO = isDemoMode();
// 목업에서 GROMO-2491 앱 차단 안내를 검토하는 진입점. 네이티브는 개발 번들에서만 켠다.
const FOCUS_BLOCKING_PREVIEW =
  DEMO &&
  ((__DEV__ && process.env.EXPO_PUBLIC_FOCUS_BLOCKING_PREVIEW === '1') ||
    (Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('focus-blocking-preview')));
// 검토·데모 모드 전용 언어 고정(`?review=1&lang=en`) — 저장된 gromo.locale 을 읽지 않는 mock 부팅에서
// 쓴다. 없으면 'ko' 로 폴백(기존 캡처 스크립트가 한국어 이름을 찾는다), 지원 밖 값은 applyLocalePref 가
// 이미 'system' 으로 정규화한다.
const REVIEW_LANG =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('lang')
    : null;
// GROMO-1926 TestFlight에서 건물별 기능을 바로 확인하기 위한 임시 QA 빌드 설정.
// 출시 빌드에서는 꺼지고, 개발 빌드나 EXPO_PUBLIC_QA=1 로 띄운 QA 빌드에서만 켠다(GROMO-2381).
export const TESTFLIGHT_ALL_BUILDINGS = __DEV__ || process.env.EXPO_PUBLIC_QA === '1';
const STORAGE = 'gromo-r61-user-v2';
// 앱 state 저장은 바뀔 때마다가 아니라 이만큼 모아 마지막 것만 쓴다(GROMO-2372)
const SAVE_DELAY_MS = 1000;
// 채택 도중 세션 세대가 바뀌면(401 정리·다른 로그인) 남은 적용을 버리는 내부 신호. 호출부에는
// 오류로 드러내지 않는다 — 새 세션의 화면이 이미 자기 흐름을 진행 중이다.
const STALE_ADOPTION = Symbol('staleAdoption');
const titles: Record<Route, string> = {
  login: 'GROMO',
  character: '내 고양이',
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
  raft: '뗏목',
  telescope: '망원경',
  sea: '먼바다',
  seaArrival: '먼바다',
  seaMagazine: '고양이 잡지',
  promotionEditor: '우리 섬 홍보 쓰기',
  magazine: '고양이 잡지',
  mainIsland: '내 메인 섬 변경하기',
  currentIsland: '현재 섬 변경하기',
  profile: '내 정보',
  settings: '앱 설정',
  language: '언어',
  blockedUsers: '차단한 사용자',
  developerNotices: '개발자 공지',
  developerNotice: '개발자 공지 상세',
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
    <PostHogAnalyticsProvider>
      <SafeAreaProvider>
        <Gromo />
      </SafeAreaProvider>
    </PostHogAnalyticsProvider>
  );
}
// 딥링크를 보관만 하는 화면 — 로그인과 계정·섬 온보딩 단계, 첫 섬 합류 뒤의 필수 안내(guide).
// 안내 중에 링크를 소비하면 온보딩과 마찬가지로 첫 튜토리얼을 건너뛴다.
const DEEP_LINK_HOLD_ROUTES: Route[] = [
  'login',
  'character',
  'createIsland',
  'joinIsland',
  'approval',
  'guide',
];
// 바다 표류 HUD 로 여는 친구·설정·꾸미기와 그 안에서 이어 여는 화면(GROMO-2404) — 계정 단위 화면이라 소속 섬이
// 없어도 머물고, 닫기는 홈 대신 바다로 간다. 강퇴 복구 신호도 이 화면들은 옮기지 않는다.
const SEA_HUD_ROUTES: Route[] = [
  'friends',
  'friendSearch',
  'blockedUsers',
  'developerNotices',
  'developerNotice',
  'settings',
  'mainIsland',
  'profile',
  'language',
  'permission',
  'screenTimeApps',
  'wardrobe',
];
// 소속 섬이 없어도 머무는 화면 — 로그인·계정 온보딩·섬 고르기·구경, 바다 표류에서 연 망원경(GROMO-2366), 위 HUD 화면.
const NO_ISLAND_ROUTES: Route[] = [
  'login',
  'character',
  'createIsland',
  'joinIsland',
  'approval',
  'currentIsland',
  'visit',
  'telescope',
  ...SEA_HUD_ROUTES,
];

function Gromo() {
  const layout = useAppLayout();
  const insets = useScreenInsets();
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    DEMO ? demoState() : initialState(),
  );
  const [loaded, setLoaded] = useState(false),
    [storageOwnerReady, setStorageOwnerReady] = useState(true),
    // 부팅 섬 동기화 실패 — 바다에서 망원경을 열 때 동기화를 재시도할 플래그(로컬 폴백 금지)
    [islandBootError, setIslandBootError] = useState(false),
    [hasServerSession, setHasServerSession] = useState(
      () => !REVIEW && !DEMO && getSession() !== null,
    ),
    [authGeneration, setAuthGeneration] = useState(sessionGeneration),
    [route, setRoute] = useState<Route>(
      FOCUS_BLOCKING_PREVIEW ? 'telescope' : DEMO ? 'home' : 'login',
    ),
    // 언어 설정 — 바뀌면 이 state 의 재렌더로 화면의 t() 문구가 새 언어로 다시 그려진다.
    [localePref, setLocalePref] = useState<LocalePref>('system'),
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
    // 화면 시계 — 분이 바뀔 때만 다시 그린다. 초 단위로 흐르는 표시는 각 화면이 useNow·Ticking 으로
    // 스스로 다시 그린다(GROMO-2372). e.now 는 그릴 때의 시각이다.
    [, setClockMinute] = useState(() => Math.floor(Date.now() / 60000)),
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
      // 취소 버튼 글자(기본 '취소')와 그 버튼을 눌렀을 때의 동작(GROMO-2259). 바깥·뒤로가기로 닫을 때는 부르지 않는다
      cancel?: string;
      onCancel?: () => void;
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
    // 화면 안쪽 안내(홈의 회관·펠리컨 안내, 바다의 펠리컨 배달)가 떠 있는 동안 — 편지 조회 게이트(GROMO-2615)
    // 홈과 바다가 불리언 하나를 공유한다: 두 신호원은 경로로 배타적이다. 신호원이 늘면 카운터로 바꾼다.
    [sceneGuideOpen, setSceneGuideOpen] = useState(false),
    [visited, setVisited] = useState('strawberry'),
    [previewAudio, setPreviewAudio] = useState(false),
    [failNext, setFailNext] = useState(false),
    [walkRequest, setWalkRequest] = useState<Route | null>(null),
    [focusBlockingGate, setFocusBlockingGate] = useState<{
      route: Route;
      detail: string;
      onContinue?: () => void;
    } | null>(null),
    [focusBlockingPermissionBusy, setFocusBlockingPermissionBusy] = useState(false),
    [reviewEpoch, setReviewEpoch] = useState(0);
  const guideStep = state.tutorial?.step ?? 0;
  const tutorialOwner = getSession()?.userId;
  const tutorialGeneration = sessionGeneration();
  const focusBlockingGateRef = useRef(focusBlockingGate);
  focusBlockingGateRef.current = focusBlockingGate;
  const focusBlockingRequestInFlight = useRef(false);
  useEffect(() => {
    setFocusBlockingGate(null);
    setFocusBlockingPermissionBusy(false);
  }, [tutorialOwner, tutorialGeneration]);
  const setGuideStep = (step: number, expected?: { step: number; revision: number }) => {
    if (sessionGeneration() !== tutorialGeneration || getSession()?.userId !== tutorialOwner)
      return;
    const current = stateRef.current;
    if (
      expected &&
      ((current.tutorial?.step ?? 0) !== expected.step ||
        (current.tutorialRevision ?? 0) !== expected.revision)
    )
      return;
    const owner = getSession()?.userId;
    if (step >= 22 && owner && !REVIEW && !DEMO) {
      void saveAccountGuides(owner, {
        focusDone: true,
        ...(step === 22 && !current.focusGuideDone
          ? { focusBlockingIntro: 'pending' as const }
          : {}),
      }).catch(() => notify(t('app.storageCheck')));
    }
    dispatch({ type: 'GUIDE_STEP', step, expected });
  };
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
  // 아직 쓰지 않은 저장 — SAVE_DELAY_MS 뒤(또는 배경 전환·종료 때) 마지막 state 를 쓴다(GROMO-2372)
  const pendingSave = useRef<{ state: State; timer: ReturnType<typeof setTimeout> } | null>(null);
  const setStorageOwnerGate = (ready: boolean) => {
    // state render 전에 도착한 저장 effect도 새 gate 값을 보도록 ref를 먼저 바꾼다.
    storageOwnerReadyRef.current = ready;
    // 닫히면 모아 둔 저장도 버린다 — 다른 계정으로 다시 열린 뒤 이전 계정 state 를 쓰지 않게.
    if (!ready && pendingSave.current) {
      clearTimeout(pendingSave.current.timer);
      pendingSave.current = null;
    }
    setStorageOwnerReady(ready);
  };
  const [incomingAppLink, setIncomingAppLink] = useState<string | null>(null);
  const [openingInvitation, setOpeningInvitation] = useState(false);
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
  // 소셜 로그인 진행 표식 — state(socialBusy)는 다음 렌더까지 반영되지 않아 연타 두 번이 모두
  // 통과한다. 첫 await 전에 동기로 세우고, 게스트 시작과도 서로 배제한다.
  const socialLoginFlight = useRef(false);
  // 회원 전환 진행 표식 — 소셜 로그인과 같은 이유로 ref 로 잠근다.
  const conversionFlight = useRef(false);
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
      // 검수에서 주입한 미완공·공사 중 상태를 전체 완공 프리셋으로 덮지 않는다.
      REVIEW ||
      (!REVIEW && !DEMO && hasServerSession) ||
      !TESTFLIGHT_ALL_BUILDINGS ||
      !state.onboarded ||
      (buildingOrder.every((building) => island.buildings.includes(building)) &&
        !island.buildingQuest &&
        !island.construction &&
        !island.nextBuilding &&
        !island.completed),
    record = state.lastResult;
  // 공용 곡 선택과 기기의 실제 재생은 별개다. 축음기를 열어도 집중 밖에서는 듣지 않는다.
  const islandAudioOn =
    loaded &&
    state.session?.status === 'active' &&
    island.playing &&
    bundledAudioSource(island.track) !== null &&
    state.settings.sound &&
    (state.settings.volume ?? 0.55) > 0;
  const player = useSoundPlayer((message) => notify(message), islandAudioOn);
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
  const performGo = (
    r: Route,
    id = '',
    options: { sessionIsAlreadyPaused?: boolean; skipFocusBlockingIntro?: boolean } = {},
  ) => {
    const gateBoard = shouldGateScreenTimeBoard(r, {
      isIOS: Platform.OS === 'ios',
      isAndroid: Platform.OS === 'android',
      promptSeen: !!state.settings.screenTimeBoardPromptSeen,
      visiting: !!state.visitingIslandId,
    });
    const gateFocusBlocking =
      !options.skipFocusBlockingIntro &&
      ((FOCUS_BLOCKING_PREVIEW && r === 'focusTravel') ||
        shouldGateFocusBlockingIntro(r, {
          isIOS: Platform.OS === 'ios',
          promptPending: state.focusBlockingIntro === 'pending',
          visiting: !!state.visitingIslandId,
        }));
    if (gateFocusBlocking) {
      Keyboard.dismiss();
      consumeFocusBlockingIntro();
      setFocusBlockingGate({ route: r, detail: id });
      return;
    }
    const nextRoute: Route = gateBoard ? 'permission' : r;
    const nextDetail = gateBoard ? `board-first|${r}|${encodeURIComponent(id)}` : id;
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
  const consumeFocusBlockingIntro = () => {
    dispatch({ type: 'FOCUS_BLOCKING_INTRO_SEEN' });
    const owner = getSession()?.userId;
    const generation = sessionGeneration();
    if (owner && !REVIEW && !DEMO)
      void saveAccountGuides(owner, { focusBlockingIntro: 'seen' }).catch(() => {
        if (sessionGeneration() === generation && getSession()?.userId === owner)
          notify(t('app.storageCheck'));
      });
  };
  const continueFocusBlockingTravel = () => {
    const pending = focusBlockingGate;
    if (!pending) return;
    setFocusBlockingGate(null);
    if (pending.onContinue) pending.onContinue();
    else performGo(pending.route, pending.detail, { skipFocusBlockingIntro: true });
  };
  const beforeSeaVoyage = (onContinue: () => void) => {
    if (
      FOCUS_BLOCKING_PREVIEW ||
      shouldGateFocusBlockingIntro('focusTravel', {
        isIOS: Platform.OS === 'ios',
        promptPending: state.focusBlockingIntro === 'pending',
        visiting: !!state.visitingIslandId,
      })
    ) {
      Keyboard.dismiss();
      consumeFocusBlockingIntro();
      setFocusBlockingGate({ route: 'sea', detail: '', onContinue });
    } else onContinue();
  };
  const requestFocusBlockingPermission = async () => {
    if (!focusBlockingGate || focusBlockingRequestInFlight.current) return;
    const gate = focusBlockingGate;
    const generation = sessionGeneration();
    const owner = getSession()?.userId;
    const isCurrent = () =>
      focusBlockingGateRef.current === gate &&
      sessionGeneration() === generation &&
      getSession()?.userId === owner;
    focusBlockingRequestInFlight.current = true;
    setFocusBlockingPermissionBusy(true);
    try {
      await screenTime.requestAuthorization();
      if (!isCurrent()) return;
      const status = await screenTime.getAuthorizationStatus();
      if (!isCurrent()) return;
      dispatch({ type: 'SETTING', key: 'permission', value: status === 'approved' });
      if (status !== 'approved') {
        notify(t('settings.permissions.errors.grantIos'));
        return;
      }
      // Family Controls 권한창이 완전히 닫힌 다음 picker를 present해야 iOS가 두 번째 시트를 누락하지 않는다.
      await new Promise<void>((resolve) => setTimeout(resolve, 450));
      if (!isCurrent()) return;
      try {
        await screenTime.presentAllowedAppManager();
      } catch {
        if (isCurrent()) notify(t('settings.permissions.errors.allowedChange'));
        return;
      }
      if (isCurrent()) continueFocusBlockingTravel();
    } catch {
      if (isCurrent()) notify(t('settings.permissions.errors.requestFailed'));
    } finally {
      focusBlockingRequestInFlight.current = false;
      setFocusBlockingPermissionBusy(false);
    }
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
      confirm(t('app.finishFocusTitle'), t('app.finishFocusBody'), () => finishSession());
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
    } else if (route === 'character' && !state.onboarded && hasServerSession && !REVIEW && !DEMO) {
      // 로그인 직후 첫 단계(GROMO-2215 · 로드맵 1-03). 로그인 성공이 reset() 으로 history 를 비우므로 아래 분기로
      // 내려가면 sea 로 «앞으로» 갔다. 뒤로가기는 로그인 전으로 — 세션을 끝내야 로그인 화면이 뜬다.
      // 프로필 화면의 로그아웃과 같은 순서다. 게스트면 기기 id 가 회전돼 다시 시작하면 새 게스트가 된다.
      signOut()
        .then((ok) => {
          if (!ok) return;
          dispatch({ type: 'LOGOUT' });
          reset('login');
        })
        .catch(() => {});
    } else transitionRoute(state.onboarded ? 'home' : 'sea');
  };
  const home = () => {
    const finish = () => {
      setWalkRequest(null);
      setHistory([]);
      // 바다 표류에서 연 친구·설정·꾸미기의 닫기(GROMO-2404)는 홈이 아니라 연 곳인 바다로 — 소속 섬이 있어도 같다.
      // 「어디서 열었나」는 기록의 바닥(첫 항목)으로 본다. 기록이 없으면(부팅 복구 등) 섬이 없을 때만 바다다.
      // state.onboarded 만 보지 않는 이유: 가입 dispatch 직후 같은 핸들러의 home() 은 옛 값을 읽는다.
      const fromSea = history.length ? seaRouteHeld(history[0].route) : !state.onboarded;
      transitionRoute(fromSea && SEA_HUD_ROUTES.includes(route) ? 'sea' : 'home');
    };
    const target = BUILDING_TRANSITION_RETURN_TARGET[route];
    if (target) returnToIsland(target, finish);
    else finish();
  };
  const confirm = (
    title: string,
    txt: string,
    action: () => void,
    opts: { ok?: string; destructive?: boolean; cancel?: string; onCancel?: () => void } = {},
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
  const resetRef = useRef(reset);
  resetRef.current = reset;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  // 소비한 링크 번호 — 섬 이동 응답이 늦게 와도 그 사이 더 새 링크를 열었으면 화면을 덮지 않는다.
  const linkSeq = useRef(0);
  // 화면 위치(라우트·상세·이동 기록 길이) — 섬 이동 응답을 기다리는 사이 사용자가 직접 옮겼는지 가린다.
  const navKeyRef = useRef('');
  navKeyRef.current = `${route}|${detail}|${history.length}`;
  // 링크가 시작한 섬 이동이 진행 중인 세션 세대(없으면 null — 세대 0 과 구분한다), 그 사이 도착해 REQUEST_IN_PROGRESS 로
  // 거절된 «가장 최근» 섬 링크 하나. 둘 다 세대를 달아, 이전 세션의 늦은 응답이 새 세션의 값을 건드리지 못하게 한다.
  const islandsSynced = !!state.serverIslands;
  const linkSwitching = useRef<number | null>(null);
  const queuedIslandLink = useRef<{
    islandId: string;
    seq: number;
    navKey: string;
    generation: number;
  } | null>(null);
  useEffect(() => subscribeToAppLinks((url) => setIncomingAppLink(url)), []);
  useEffect(() => {
    if (!loaded || !incomingAppLink) return;
    const target = parseAppDeepLink(incomingAppLink);
    if (!target) {
      setIncomingAppLink(null);
      return;
    }
    if (target.kind === 'invitation') {
      // 초대는 첫 섬 선택을 대신한다. 계정 준비와 진행 중 집중만 끝나기를 기다린다.
      if (
        !hasServerSession ||
        !islandsSynced ||
        fireTransition.phase !== 'idle' ||
        ['login', 'character', 'guide'].includes(route) ||
        (route === 'home' && !!state.tutorial && state.tutorial.step <= 3) ||
        state.session ||
        openingInvitation
      )
        return;
      setIncomingAppLink(null);
      setOpeningInvitation(true);
      const gen = sessionGeneration();
      const seq = ++linkSeq.current;
      const nav = navKeyRef.current;
      const latest = () =>
        gen === sessionGeneration() && seq === linkSeq.current && nav === navKeyRef.current;
      void (async () => {
        try {
          const commands = islandCmds.current!.commands;
          const island = await commands.resolveInvite(target.code, { arrive: true });
          if (!latest()) return;
          // 초대 해석 직후의 서버 상태를 쓴다. 로컬 소속·현재 섬은 다른 기기의 변경보다 늦을 수 있다.
          if (island.membershipStatus === 'active') {
            await commands.switchCurrent(island.id);
          } else {
            const result = await commands.join(island.id, { showApproval: false });
            if (!latest()) {
              if (gen === sessionGeneration())
                notifyRef.current(
                  result.status === 'pending'
                    ? '초대받은 섬에 가입을 신청했어요.'
                    : '초대받은 섬에 합류했어요.',
                );
              return;
            }
            if (result.status === 'pending') {
              if (stateRef.current.visitingIslandId) dispatch({ type: 'END_VISIT' });
              resetRef.current('approval', island.id);
              return;
            }
          }
          if (latest()) {
            if (stateRef.current.visitingIslandId) dispatch({ type: 'END_VISIT' });
            resetRef.current('home');
          }
        } catch (error) {
          if (latest()) notifyRef.current(islandErrorMessage(error));
        } finally {
          setOpeningInvitation(false);
        }
      })();
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
    // 현재 섬 유무(state.onboarded)는 계정 온보딩과 별개다 — 계정 온보딩(character)은 위 보관 화면이 이미 막는다.
    // 호 읽기는 소속 섬이 없는 바다에서도 열려서(seaMagazine) 현재 섬을 요구하지 않는다. 그 밖의 링크는 현재 섬이 있어야 한다
    // (섬 이동은 첫 섬 안내 대기(awaiting-first-island)를 건너뛰지 않게 onboarded 로 막는다).
    // 다만 잡지는 섬/바다를 serverIslands 로 가르므로 섬 동기화(ISLAND_SYNC)를 한 번이라도 마친 뒤에 연다. 부팅(decideBootRoute)과
    // 로그인 채택(navigate)은 동기화 뒤에 loaded·화면 이동을 하니 성공하면 항상 채워져 있다 — 비는 것은 동기화가 실패한 경우뿐이다.
    const tutorialForcesGuide = route === 'home' && !!state.tutorial && state.tutorial.step <= 3;
    // 건물·휴식 전환 애니메이션이 도는 동안에도 보관한다 — 끝날 때 부르는 navigate 가 링크 목적지를 덮는다.
    // 전환을 취소하지 않고, 끝나면(phase idle) 이 effect 가 다시 돌아 그때 연다.
    if (
      !hasServerSession ||
      (target.kind === 'magazine' ? !islandsSynced : !state.onboarded) ||
      DEEP_LINK_HOLD_ROUTES.includes(route) ||
      tutorialForcesGuide ||
      fireTransition.phase !== 'idle'
    )
      return;
    setIncomingAppLink(null);
    const seq = ++linkSeq.current;
    // 서버 섬 구경 중에는 SERVER_VISIT_ROUTES 만 열려 홈·잡지·친구가 «주민만 이용할 수 있어요» 로 막힌다.
    // 구경을 먼저 끝내고(END_VISIT + reset — endServerVisit·뒤로가기와 같은 짝) 연다. reset 은 구경 화면 기록도 비운다.
    const open = (r: Route, id = '', clearHistory = false) => {
      const visiting = !!stateRef.current.visitingIslandId;
      if (visiting) dispatch({ type: 'END_VISIT' });
      if (visiting || clearHistory) resetRef.current(r, id);
      else goRef.current(r, id);
    };
    if (target.kind === 'unsupported') {
      open('home');
      notifyRef.current(t('app.linkUnsupported'));
      return;
    }
    if (target.kind === 'magazine') {
      // 소속 섬이 있으면 섬에서, 없으면 바다에서 펼친다(둘 다 호가 없으면 리더가 «사라진 호»로 안내한다).
      open(
        stateRef.current.serverIslands?.currentIslandId ? 'magazine' : 'seaMagazine',
        target.issueId,
      );
      return;
    }
    if (target.kind === 'island') {
      // 불변식: 보관(queuedIslandLink)은 followsAnother — 같은 세대의 링크 전환이 아직 진행 중일 때 — 에만 일어난다. 보관분을
      // 다시 열 때는 앞선 전환이 끝나 linkSwitching 이 비었으니 followsAnother=false 라 다시 보관되지 않는다(무한 재시도 없음).
      // 재개가 가능한 전제: islandCommands.ts 의 selection 잠금이 finally 에서 풀린 뒤에야 switchCurrent 가 resolve/reject 한다.
      const openIsland = (islandId: string, order: number, navKey: string) => {
        const unavailable = () => {
          open('home');
          notifyRef.current(t('app.linkIslandUnavailable'));
        };
        // 소속 여부는 로컬 스냅샷이 아니라 서버가 판정한다 — 다른 기기에서 방금 가입·승인된 섬일 수 있다. 소속이 아니면 서버 거절이
        // 아래 실패 경로로 같은 안내를 낸다. 캐시가 «이미 현재 섬» 이어도 서버에 확인한다(다른 기기에서 바꿨을 수 있고, 같은 섬 PUT 은
        // 멱등 200 상태확인이며 집중 세션 가드도 걸지 않는다 — IslandMembershipService.switchCurrentIsland).
        // 다른 섬으로 옮기는데 집중 중이면(섬 고르기의 sessionBlocksMove 와 같은 규칙) 보내지 않는다.
        if (
          stateRef.current.session &&
          islandId !== stateRef.current.serverIslands?.currentIslandId
        )
          return unavailable();
        const generation = sessionGeneration();
        // 응답 전에 더 새 링크를 열었거나(번호 변경) 사용자가 직접 다른 화면으로 옮겼으면(위치 변경) 화면을 건드리지 않는다.
        // 이동을 막지는 않는다. 계정이 바뀐(세대 변경) 응답은 settle 맨 앞에서 통째로 버린다.
        const latest = () => linkSeq.current === order && navKeyRef.current === navKey;
        const followsAnother = linkSwitching.current === generation;
        linkSwitching.current = generation;
        const settle = (ok: boolean, thrown?: unknown) => {
          // 이전 세션의 늦은 응답은 새 세션의 진행 표시·보관 링크를 지우지 않는다.
          if (sessionGeneration() !== generation) return;
          if (
            !ok &&
            followsAnother &&
            (thrown as { code?: string } | undefined)?.code === 'REQUEST_IN_PROGRESS'
          ) {
            // 앞선 링크의 섬 이동이 아직 끝나지 않았다 — 가장 최근 목적지 하나만 보관했다가 그 이동이 끝나면 다시 연다.
            if (linkSeq.current === order)
              queuedIslandLink.current = { islandId, seq: order, navKey, generation };
            return;
          }
          linkSwitching.current = null;
          // 옮긴 뒤 홈으로 — 섬 고르기(ServerIslandPicker)와 같다. 실패(소속 변동·네트워크)도 같은 안내로 홈에 둔다.
          if (latest()) {
            if (ok) open('home', '', true);
            else unavailable();
          }
          const queued = queuedIslandLink.current;
          queuedIslandLink.current = null;
          if (
            queued &&
            queued.generation === generation &&
            queued.seq === linkSeq.current &&
            queued.navKey === navKeyRef.current
          )
            openIsland(queued.islandId, queued.seq, queued.navKey);
        };
        islandCmds.current!.commands.switchCurrent(islandId).then(
          () => settle(true),
          (thrown) => settle(false, thrown),
        );
      };
      openIsland(target.islandId, seq, navKeyRef.current);
      return;
    }
    open(target.route);
  }, [
    loaded,
    incomingAppLink,
    hasServerSession,
    state.onboarded,
    islandsSynced,
    state.tutorial,
    route,
    fireTransition.phase,
    openingInvitation,
    state.session,
  ]);
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
        const generation = sessionGeneration();
        const my = await islandCommands.sync();
        if (sessionGeneration() !== generation) return my;
        const transfer = pendingBootOwnerTransfer.current;
        if (transfer) {
          pendingBootOwnerTransfer.current = null;
          try {
            await transfer();
            if (sessionGeneration() === generation) setIslandBootError(false);
          } catch (error) {
            // 재시도가 다시 실패하면 다음 재시도에서 전환을 이어서 시도한다.
            if (sessionGeneration() === generation) {
              pendingBootOwnerTransfer.current ??= transfer;
              setIslandBootError(true);
            }
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
  const needsHome =
    onHome ||
    [
      'focus',
      'rest',
      'focusSetup',
      'focusTravel',
      'fishingArrival',
      'boat',
      'raft',
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
      // 잡지 배경이 섬 홈이고 섬장만 끝 쪽 안내를 본다 — 링크로 바로 열어도 홈 스냅샷을 받아야 한다. 바다 잡지(seaMagazine)는 홈이 없다.
      'magazine',
    ].includes(route);
  const buildingIndicators = useBuildingIndicators({
    active: !!serverCurrent,
    islandId: serverCurrent,
    onHome,
    refreshKey: homeReload,
  });
  // 부팅이 섬 동기화와 함께 미리 시작한 홈 스냅샷(GROMO-2377). loaded 뒤 첫 실행이 한 번만 가져가고,
  // 그때 홈을 그리지 않으면 버린다 — 나중 진입이 오래된 응답을 쓰지 않게.
  const bootHome = useRef<{ gen: number; date: string; request: Promise<HomeSnapshot> } | null>(
    null,
  );
  // 관리 화면도 needsHome이므로 홈 복귀 여부를 별도로 추적해 이름·인원·역할을 다시 읽는다.
  useEffect(() => {
    const prefetched = bootHome.current;
    if (loaded) bootHome.current = null;
    if (!loaded || !serverCurrent || !needsHome) return;
    let live = true;
    setHomeError(false);
    const date = dayKey();
    // 부팅 뒤 세션이 바뀌었거나 날짜가 넘어갔으면 미리 받은 것을 쓰지 않고 새로 읽는다
    (prefetched?.gen === sessionGeneration() && prefetched.date === date
      ? prefetched.request
      : loadHomeSnapshot({ date, timezone: 'Asia/Seoul', isCurrent: () => live })
    )
      .then((r) => {
        if (!live) return;
        // current 없음(서버 409) 또는 응답이 로컬이 아는 current 와 다른 섬(전환 경합) —
        // 둘 다 이 스냅샷을 그대로 적용하지 않고 소속 동기화로 반영해 sea 로 보낸다.
        const current = stateRef.current?.serverIslands?.currentIslandId;
        if (r.status !== 'loaded' || r.facts.islandId !== current) {
          // 동기화가 실패하거나 current 를 바꾸지 못하면 effect 가 다시 돌지 않는다 — 스피너에 갇히지
          // 않게 재시도 화면으로 떨어뜨린다. current 가 바뀌면 effect 가 새로 불러오고 sea 는 App 이 연다
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
  }, [loaded, serverCurrent, needsHome, onHome, homeReload]);
  useEffect(() => {
    if ((Platform.OS !== 'ios' && Platform.OS !== 'android') || !loaded || REVIEW || DEMO) return;
    const initialOwner = getSession()?.userId;
    let active = true;
    let pending = false;
    const update = async () => {
      const owner = getSession()?.userId;
      if (!owner || !serverCurrent || !storageOwnerReadyRef.current) {
        await updateIOSHomeWidget(null).catch(() => {});
        return;
      }
      if (pending) return;
      pending = true;
      const generation = sessionGeneration();
      const date = dayKey();
      const current = () =>
        active && generation === sessionGeneration() && getSession()?.userId === owner;
      try {
        const result = await loadHomeSnapshot({ date, timezone: 'Asia/Seoul', isCurrent: current });
        if (!current() || date !== dayKey()) return;
        if (result.status !== 'loaded' || result.facts.islandId !== serverCurrent) return;
        await updateIOSHomeWidget({
          owner,
          day: date,
          totalSeconds: result.facts.home.focusSummary.totalSeconds,
          catColor: stateRef.current.color,
          observedAt: Date.now(),
        });
      } catch {
        // 실패한 조회를 0분으로 덮지 않는다. 기존 스냅샷은 네이티브에서 날짜 만료된다.
      } finally {
        pending = false;
      }
    };
    void update();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void update();
    }, 60000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' || next === 'background') void update();
    });
    const unsubscribe = subscribeSession((session) => {
      if (!session || session.userId !== initialOwner)
        void updateIOSHomeWidget(null).catch(() => {});
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
      unsubscribe();
    };
  }, [
    loaded,
    hasServerSession,
    storageOwnerReady,
    serverCurrent,
    state.session?.id,
    state.session?.version,
    state.session?.status,
    state.color,
  ]);
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
  // 1초 조회 타이머가 마지막 렌더의 화면 이동 함수로 복구하게 한다
  const recoverExpiredRestRef = useRef(recoverExpiredRest);
  recoverExpiredRestRef.current = recoverExpiredRest;
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
        notify(errorTextOr(error, 'focus.finishFailed'));
      });
  };
  const resumeSession = () => {
    const session = stateRef.current.session;
    if (!serverSession()) {
      dispatch({
        type: stateRef.current.tutorialExperience?.session
          ? 'TUTORIAL_EXPERIENCE_RESUME'
          : 'RESUME',
      });
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
        notify(errorTextOr(error, 'focus.resumeFailed'));
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
    if (attempt === 0) notify(t('app.storageRetrying'));
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
    let savedStory = stateRef.current.onboardingStory;
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
          // 안드로이드 홈 위젯도 비운다 — 위젯이 읽는 네이티브 저장소는 위 삭제로 지워지지 않아 이전
          // 계정의 과목·공부시간이 런처에 남는다(1.x 계정 전환과 같은 처리). 새 계정 값은 홈 화면이
          // 다시 보낸다. best-effort 라 기다리지 않는다(실패는 래퍼가 삼킨다).
          void clearStudyWidget();
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
            savedStory = deferred.state.onboardingStory;
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
            // 스토리 진행도만 계승한다. 소속과 집중 세션은 기존 서버 동기화 경로가 결정한다.
            saved: previousUserId === result.userId ? { onboardingStory: savedStory } : null,
            account,
            rejected: false,
            serverMode: true,
            bootGen: adoptionGen,
            generation: sessionGeneration,
            syncIslands,
            onBootError: setIslandBootError,
          });
          ensureCurrent();
          // 같은 계정의 회원 전환(게스트 → 소셜)은 진행 중 바다 항해를 그대로 지닌다 — 홈이 아니라 항해 화면으로(GROMO-2310)
          const live = stateRef.current.session;
          if (next) reset(live?.kind === 'sea' ? sessionRoute(live) : next);
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
    if (guestLoginFlight.current || socialLoginFlight.current) return;
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
      setGuestError(errorTextOr(error, 'login.error.guestFailed'));
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
    if (
      !TERMS_VERSION ||
      socialBusy ||
      guestBusy ||
      !terms ||
      socialLoginFlight.current ||
      guestLoginFlight.current
    )
      return;
    // 잠금과 해제를 한 try/finally 로 묶는다 — 잠근 뒤 어떤 줄이 던져도 버튼이 영구히 잠기지 않는다.
    socialLoginFlight.current = true;
    try {
      await runSocialLogin(provider);
    } finally {
      socialLoginFlight.current = false;
    }
  };
  const runSocialLogin = async (provider: Provider) => {
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
        setSocialError(errorTextOr(thrown, 'login.error.socialFailed'));
      }
    } finally {
      setSocialBusy(null);
    }
  };
  const pickProvider = async (provider: Provider) => {
    if (!TERMS_VERSION || !convUi?.termsAccepted || convUi.busy || conversionFlight.current) return;
    // 일반 로그인과 같이 첫 await 전에 동기로 잠근다 — convUi.busy 는 다음 렌더까지 반영되지 않아
    // 연타 두 번이 제공자 SDK 와 memberConversion.convert() 를 동시에 부른다.
    conversionFlight.current = true;
    try {
      await runConversion(provider);
    } finally {
      conversionFlight.current = false;
    }
  };
  const runConversion = async (provider: Provider) => {
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
        notify(t('app.memberConverted'));
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
      const message = errorTextOr(thrown, 'account.guest.failed');
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
      setAuthGeneration(generation);
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
    const unsubscribe = subscribeSession((session) => {
      if (session) identifyPostHogUser(session.userId);
      else resetPostHogUser();
    });
    const stopSocialAnalytics = startSocialAnalytics();
    const stopMetaTracking = startMetaTracking();
    // 푸시 등록·수신·탭(GROMO-2525) — iOS 이고 FCM 브리지가 든 바이너리에서만 돈다.
    const stopPushSync = startPushSync(() => stateRef.current.settings.notifications !== false);
    return () => {
      stopPushSync();
      stopSocialAnalytics();
      stopMetaTracking();
      unsubscribe();
    };
  }, [loaded]);
  // 설정 「알림」이 바뀌면 바로 맞춘다 — 끄면 FCM 토큰을 지워야 OS 가 띄우는 백그라운드 푸시도 멈춘다. 렌더 뒤
  // effect 라 동기화가 읽는 stateRef 는 이미 새 값이고, 동기화가 돌기 전(첫 렌더·부팅 LOAD)에는 아무 일도 하지 않는다.
  useEffect(() => {
    refreshPush();
  }, [state.settings.notifications]);
  // 화면 전환 덮개(경로 전환 방패·건물·불 전환)가 앱 내용을 덮는 동안이다 — 접근성 트리에서도 내용을 숨기는 그 조건이다.
  const appContentHidden =
    !!focusBlockingGate ||
    routeTransitionShielded ||
    buildingRouteCovered ||
    buildingTransitionActive ||
    fireTransition.phase !== 'idle';
  // 알림 권한(GROMO-2526) — 섬 홈이 실제로 그려진 뒤 시스템 팝업으로 한 번 묻는다: 서버 홈 스냅샷이 현재 섬 것으로 적용되고
  // 오류가 없을 때다. 그 전에는 홈 자리에 로딩·오류 화면이 떠 있어 그 위로 팝업이 뜨고 한 번뿐인 기회가 쓰인다. 전환 덮개도
  // 걷힌 뒤여야 한다 — 방패(350ms)는 화면 전환 직후의 터치가 새 화면에 닿지 않게 막는데, 시스템 팝업은 그 바깥이라 그 터치를 받는다.
  // 아직 안 물음일 때만 팝업이 뜨므로 「물어봤음」을 저장하지 않고, ref 는 같은 실행에서 헛된 조회를 줄일 뿐이다. 소속 섬 없이
  // 바다에 있으면(route 가 home 이 아님) 묻지 않는다 — 설정 「알림」 토글로 켠다. 튜토리얼은 끝난 뒤(step 22 이상)부터다:
  // state.tutorial 은 끝난 뒤에도 남는다. 권한을 읽는 사이 이 조건이 사라질 수 있다(홈을 떠남·로그아웃) — 조건 전체를 렌더마다
  // ref 에 두고, requestPushPermission 이 팝업 직전에 다시 본다(shouldAsk).
  const pushAsked = useRef(false);
  const inTutorial = !!state.tutorial && state.tutorial.step < 22;
  const islandHomeShown = !homeError && !!serverHome(state);
  // 앱이 앞에 있는가('active' 만 앞이다) — 백그라운드에서는 시스템 팝업을 사용자가 못 본다. 앞/뒤를 조건에 넣어, 돌아올 때 effect 가
  // 다시 돌아 되돌려진(error) 한 번뿐인 기회를 다시 쓰게 한다. 팝업이 떠 있는 동안은 'inactive' 지만, shouldAsk 는 팝업 직전에 보고
  // 요청이 도는 동안은 pushAsked 가 참이라 다시 묻지 않는다.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setAppActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (appActive)
      void getAssetRepository()
        ?.onForeground()
        .catch(() => {});
  }, [appActive]);
  // 운영진의 편지(GROMO-2615) — 홈(섬 홈이 그려진 뒤)·바다에서 모든 안내·세션·전환이 비었을 때만 조회·표시한다.
  // appContentHidden 은 편지를 합치기 전 값이다(순환 방지) — 스크린 리더 숨김만 appContentHidden || letterVisible.
  // 강제 업데이트(GROMO-2617)는 부트를 기다리지 않고 조회하되, 표시는 세션이 없고 loaded 일 때만이다. 패치노트보다 우선한다
  const requirement = useForceUpdateLetter({
    enabled: !REVIEW && !DEMO && Platform.OS !== 'web',
  });
  const forced = requirement && loaded && !state.session ? requirement : null;
  const letterReady =
    !requirement &&
    isLetterReady({
      loaded,
      review: REVIEW,
      demo: DEMO,
      hasServerSession,
      appActive,
      route,
      islandHomeShown,
      session: !!state.session,
      inTutorial,
      tutorialExperience: !!state.tutorialExperience,
      onboardingStory: state.onboardingStory,
      visiting: !!state.visitingIslandId,
      modal: !!modal,
      convUi: !!convUi,
      switchAsk,
      appContentHidden,
      walkRequest: !!walkRequest,
      storageOwnerReady,
      sceneGuide: sceneGuideOpen,
      keyboardHeight,
      incomingAppLink: !!incomingAppLink,
      openingInvitation,
    });
  const { notice: letter, dismiss: dismissLetter } = useDeveloperLetter({
    ready: letterReady,
    userId: getSession()?.userId ?? null,
  });
  const letterVisible = forced !== null || letter !== null;
  useEffect(() => {
    if (forced) Keyboard.dismiss();
  }, [forced !== null]);
  const pushPromptReady =
    loaded &&
    !REVIEW &&
    !DEMO &&
    route === 'home' &&
    hasServerSession &&
    !inTutorial &&
    islandHomeShown &&
    !appContentHidden &&
    appActive &&
    !letterVisible &&
    state.settings.notifications !== false;
  const pushPromptReadyRef = useRef(pushPromptReady);
  pushPromptReadyRef.current = pushPromptReady;
  useEffect(() => {
    if (pushAsked.current || !pushPromptReady) return;
    pushAsked.current = true;
    void requestPushPermission(() => pushPromptReadyRef.current).then((permission) => {
      // 못 물었으면 이 실행의 한 번뿐인 기회를 쓰지 않는다 — 다음 홈 진입에서 다시 묻는다: 네이티브가 일시적으로 실패했거나
      // ('error'), 브리지가 없거나('unavailable'), 읽는 사이 조건이 사라져 팝업을 막았다('undetermined' 그대로).
      if (permission === 'error' || permission === 'unavailable' || permission === 'undetermined')
        pushAsked.current = false;
    });
  }, [pushPromptReady]);
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
      // 보관 중이던 링크는 끝난 세션의 것이다 — 다음 로그인에서 열지 않는다.
      setIncomingAppLink(null);
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
      // 언어 설정(기기 전역 값). 2.0 키가 없으면 1.x 키를 읽고, 읽기 실패는 기기 언어 따름으로 본다.
      // mock(검토·데모)은 저장된 값을 읽지 않는다 — 과거에 gromo.locale='en' 이 저장된 브라우저에서
      // ?review=1 이 영문으로 떠 캡처·검증이 재현 불가능해지는 것을 막는다(REVIEW_LANG 으로 고정).
      mock ? Promise.resolve(null) : AsyncStorage.getItem(LOCALE_KEY).catch(() => null),
      mock ? Promise.resolve(null) : AsyncStorage.getItem(LEGACY_LOCALE_KEY).catch(() => null),
    ])
      .then(async ([raw, session, localeRaw, legacyLocaleRaw]) => {
        // 첫 화면이 그려지기 전에 언어부터 맞춘다.
        setLocalePref(
          applyLocalePref(mock ? (REVIEW_LANG ?? 'ko') : (localeRaw ?? legacyLocaleRaw)),
        );
        // 「거절(재로그인)」·「확인 실패(오프라인)」·「정상」 셋을 가른다 — checkSession 참조.
        const check = session ? await checkSession() : null;
        const account = check?.status === 'active' ? check.account : null;
        const rejected = check?.status === 'rejected';
        // 탈퇴 응답을 잃고 앱이 종료됐던 경우 — 서버가 이 계정을 USER_NOT_FOUND 로 거절하면 남은 탈퇴
        // 의도로 로컬 정리(1.x 데이터·소유자 표식)를 마친다. 실패하면 의도가 남아 다음 부팅에 다시 한다.
        // 정리가 끝났으면 탈퇴 계정의 앱 저장본도 올리지 않고 지운다.
        const withdrawn =
          !mock &&
          (await settleWithdrawalIntent(session?.userId ?? null, check).catch(() => false));
        if (withdrawn) {
          void clearStudyWidget();
          await AsyncStorage.removeItem(STORAGE).catch(() => {});
        }
        const saved = raw && !withdrawn ? JSON.parse(raw) : null;
        const loadable = saved?.version === 1 ? saved : null;
        const restoredUserId = session?.userId ?? null;
        const ownerUserId = getLastSessionUserId();
        // 소유자 표식을 읽지 못했으면 저장본의 주인을 모른다 — 불일치와 같이 격리한다. 주인이 확인되지
        // 않은 저장본은 어느 계정에도 넘기지 않으므로 보류 상태로도 두지 않는다.
        const ownerUnknown = isLocalDataOwnerUnknown();
        // 소유자를 모르면 복구된 세션이 없어도(로그아웃 상태) 격리한다 — 로그인 화면 뒤에서 저장본이
        // 올라가고 저장 effect 가 그대로 다시 쓰지 않게 gate 를 닫아 둔다. 다음 로그인 채택이 비운다.
        const ownerMismatch =
          ownerUnknown ||
          (restoredUserId !== null && ownerUserId !== null && restoredUserId !== ownerUserId);
        if (ownerMismatch) {
          setStorageOwnerGate(false);
          deferredOwnerState.current =
            loadable && ownerUserId && !ownerUnknown
              ? { userId: ownerUserId, state: loadable }
              : null;
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
        // 로컬 저장본으로 home에 들어가지 않고 바다로 보내고 망원경 진입 때 재시도한다.
        // 부팅 인증 세대는 checkSession 결과 직후 포획한다 — 동기화 도중 401이 나면 세션 상실
        // 핸들러가 login으로 돌리고 세대가 올라가므로, stale account로 route를 덮어쓰지 않는다.
        const bootGen = sessionGeneration();
        // GROMO-2377 섬 동기화·집중 복구·홈 스냅샷 조회는 서로의 응답을 쓰지 않는다 — 함께 시작해 부팅이
        // 가장 느린 하나만큼만 기다리게 한다. 반영 순서는 그대로다: ISLAND_SYNC → owner 전환 → 집중 복구
        // (ISLAND_SYNC 가 소속 밖 섬의 세션을 지우므로 SESSION_SYNC 가 뒤에 와야 한다) → loaded 뒤 홈 effect.
        // /me 는 checkSession 이 읽은 계정을 섬 동기화에 넘겨 부팅에서 한 번만 부른다.
        const serverBoot = !!(account && !mock);
        const recoverRead = serverBoot ? focusCmds.current!.commands.beginRecover() : null;
        if (serverBoot) {
          const date = dayKey();
          const request = loadHomeSnapshot({ date, timezone: 'Asia/Seoul' });
          // 홈 effect 가 가져가기 전에 실패해도 처리되지 않은 거부로 남기지 않는다
          request.catch(() => {});
          bootHome.current = { gen: bootGen, date, request };
        }
        let bootSyncSucceeded = false;
        const bootRoute = await decideBootRoute({
          saved: bootSaved,
          account,
          rejected,
          serverMode: serverBoot,
          bootGen,
          generation: sessionGeneration,
          syncIslands: async () => {
            const result = await syncIslands(account ?? undefined);
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
                syncIslands: () => syncIslands(account),
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
          // 정본 동기화가 실패했으면 소유자 전환을 보류한다 — 바다의 망원경 진입 재시도 성공 뒤에 끝낸다.
          // 부팅 중 owner 기록이 거절돼도 같은 재시도 경로로 넘긴다.
          if (bootSyncSucceeded && bootRoute)
            await transferOwner().catch(() => {
              if (bootSessionIsCurrent()) {
                pendingBootOwnerTransfer.current = transferOwner;
                setIslandBootError(true);
              }
            });
          else pendingBootOwnerTransfer.current = transferOwner;
        }
        // GROMO-2009 집중 세션 복구 — 서버 정본의 진행 세션(active→낚시, paused→모닥불)과
        // 자동 종료 미확인 결과(→결과창)를 부팅 경로보다 우선한다. 실패하면 부팅 경로를 유지한다.
        if (recoverRead && sessionGeneration() === bootGen) {
          const recovered = await recoverRead().catch(() => null);
          if (recovered && sessionGeneration() === bootGen) setRoute(recovered);
        }
      })
      .catch(() => notify(t('app.restoreFailed')))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!loaded || !FOCUS_BLOCKING_PREVIEW) return;
    setRoute('telescope');
    setDetail('');
    setFocusBlockingGate(null);
  }, [loaded]);
  const kickedDestination =
    ['visit', 'travel'].includes(route) &&
    state.islands.some((candidate) => candidate.id === (detail || visited) && candidate.kicked);
  useEffect(() => {
    if (!loaded || !state.loggedIn) return;
    // 바다 항해(결과창 포함)는 소속과 무관하다 — 강퇴·소속 0 이어도 화면을 지킨다(GROMO-2310)
    if (seaRouteHeld(route)) {
      if (state.membershipRecovery) dispatch({ type: 'MEMBERSHIP_RECOVERY_HANDLED' });
      return;
    }
    if (state.membershipRecovery || kickedDestination) {
      // 계정 단위 화면(친구·설정·꾸미기)은 강퇴로 섬이 사라져도 그대로 둔다 — 강퇴 안내만 뜨고, 닫기·뒤로가기 때
      // 아래 평소 검사가 바다로 보낸다. 강퇴된 섬을 보는 방문·항해 화면은 그대로 옮긴다.
      if (!kickedDestination && SEA_HUD_ROUTES.includes(route)) {
        dispatch({ type: 'MEMBERSHIP_RECOVERY_HANDLED' });
        return;
      }
      setModal(null);
      setWalkRequest(null);
      setVisited(state.onboarded ? state.islandId : '');
      reset(state.onboarded ? 'home' : 'sea');
      if (state.membershipRecovery) dispatch({ type: 'MEMBERSHIP_RECOVERY_HANDLED' });
      return;
    }
    if (state.onboarded) return;
    // 소속 없이 구경 중(바다 도착 뒤 등) — 방문이 끝나면(visitingIslandId 해제) 평소 검사가 다시 돈다
    if (visitRouteHeld(route, state.visitingIslandId)) return;
    if (NO_ISLAND_ROUTES.includes(route)) return;
    // 마지막 소속에서 강퇴되거나 동기화 결과 소속이 0개가 되면 이전 화면 기록까지 지운다.
    // 현재 섬이 없으면 이야기 이력·소속 상실 사유와 관계없이 바다로 보낸다.
    reset('sea');
  }, [
    loaded,
    state.loggedIn,
    state.onboarded,
    state.islandId,
    state.visitingIslandId,
    state.membershipRecovery,
    kickedDestination,
    route,
    state.serverIslands?.lossReason,
  ]);
  // 강퇴 안내(GROMO-2366) — /me/islands 가 강퇴로 현재 섬이 없다고 하면 한 번만 띄운다(바다 이동은 위 검사).
  // 「봤음」은 계정별로 잃은 섬 id(모르면 '1')를 적어 다른 섬에서 또 강퇴되면 다시 띄우고, 현재 섬이 다시 생기면 지운다.
  // 계정이 바뀌면(kickNoticeOwner) 그 계정의 「봤음」으로 다시 본다.
  const { lossReason, kickedIsland } = state.serverIslands ?? {},
    kickNoticeOwner = getSession()?.userId;
  useEffect(() => {
    if (!loaded || !kickNoticeOwner) return;
    const key = `kickNoticeSeen:${kickNoticeOwner}`;
    let live = true;
    (async () => {
      try {
        if (serverCurrent) {
          await AsyncStorage.removeItem(key);
          return;
        }
        if (lossReason !== 'KICKED') return;
        const lost = kickedIsland?.id ?? '1',
          seen = await AsyncStorage.getItem(key).catch(() => null);
        if (!live || seen === lost) return;
        // 띄운 뒤에 본 것으로 적는다 — 기다리는 사이 상태가 바뀌면 띄우지도, 적지도 않는다
        notify(
          kickedIsland?.name ? t('app.kickedFrom', { island: kickedIsland.name }) : t('app.kicked'),
        );
        await AsyncStorage.setItem(key, lost);
      } catch {
        // 표시를 못 적으면 다음 동기화에 한 번 더 띄운다 — 안내는 화면을 막지 않는다
      }
    })();
    return () => {
      live = false;
    };
  }, [loaded, kickNoticeOwner, serverCurrent, lossReason, kickedIsland?.id, kickedIsland?.name]);
  useEffect(() => {
    if (loaded && state.onboarded && !qaBuildingsReady)
      dispatch({ type: 'QA_COMPLETE_ALL_BUILDINGS' });
  }, [loaded, state.onboarded, state.islandId, qaBuildingsReady]);
  useEffect(() => {
    if (!loaded) return;
    const experience = state.tutorialExperience;
    const experienceIsland = experience?.session?.islandId ?? experience?.result?.islandId;
    if (
      experienceIsland &&
      state.serverIslands &&
      experienceIsland !== state.serverIslands.currentIslandId
    ) {
      setGuideStep(4);
      reset(state.serverIslands.currentIslandId ? 'home' : 'sea');
      return;
    }
    const restoring = !tutorialBootReconciled.current;
    const returningHome = route === 'home' && previousTutorialRoute.current !== 'home';
    previousTutorialRoute.current = route;
    tutorialBootReconciled.current = true;
    const next = reconcileTutorial(state, route, restoring || returningHome);
    if (next !== guideStep)
      setGuideStep(next, { step: guideStep, revision: state.tutorialRevision ?? 0 });
    if (route === 'home' && state.tutorial && next <= 3) reset('guide');
    if (route === 'guide' && !state.tutorial) setGuideStep(0);
    if (route === 'home' && next >= 22 && state.tutorialExperience)
      dispatch({ type: 'TUTORIAL_EXPERIENCE_CLEAR' });
  }, [
    loaded,
    route,
    state.tutorial,
    state.tutorialExperience,
    state.session,
    state.lastResult,
    state.serverIslands?.currentIslandId,
  ]);
  // 모아 둔 저장을 지금 줄에 세운다. 쓰는 순간에도 저장 gate 를 다시 본다(gate 가 닫히면 대기분은 이미 버려졌다).
  const flushSave = () => {
    const pending = pendingSave.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSave.current = null;
    const snapshot = JSON.stringify(pending.state);
    const write = userStorageWriteQueue.current.then(async () => {
      if (!storageOwnerReadyRef.current) return;
      await AsyncStorage.setItem(STORAGE, snapshot);
    });
    userStorageWriteQueue.current = write.catch(() => {
      notify(t('app.storageCheck'));
    });
  };
  useEffect(() => {
    if (
      loaded &&
      storageOwnerReady &&
      storageOwnerReadyRef.current &&
      qaBuildingsReady &&
      !REVIEW &&
      !DEMO
    ) {
      // 바뀔 때마다 쓰지 않고 SAVE_DELAY_MS 동안 모아 마지막 state 만 쓴다(GROMO-2372)
      if (pendingSave.current) pendingSave.current.state = state;
      else pendingSave.current = { state, timer: setTimeout(flushSave, SAVE_DELAY_MS) };
    }
  }, [state, loaded, storageOwnerReady, qaBuildingsReady]);
  useEffect(() => {
    // 배경으로 가거나 화면이 사라질 때는 기다리지 않고 바로 쓴다 — 앱이 그대로 종료돼도 잃지 않게
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') flushSave();
    });
    return () => {
      subscription.remove();
      flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushSave 는 ref·notify 만 읽어 첫 렌더 것으로 충분하다
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      // 같은 분이면 같은 값이라 다시 그리지 않는다
      setClockMinute(Math.floor(now / 60000));
      // 할 일 없는 TICK 은 보내지 않는다 — App 을 매초 다시 그리지 않게(GROMO-2372)
      if (!tickIdle(stateRef.current, now)) dispatch({ type: 'TICK', now });
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
        if (!storageOwnerReadyRef.current || !getSession() || REVIEW || DEMO) return;
        const current = ++request;
        const generation = sessionGeneration();
        dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
        try {
          const snapshot = await syncAndroidMeasurement();
          if (active && current === request && generation === sessionGeneration()) {
            dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot, now: Date.now() });
            dispatch({ type: 'SETTING', key: 'screenTimeSyncError', value: snapshot.reportFailed });
          }
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
      if (!storageOwnerReadyRef.current || !getSession() || REVIEW || DEMO) return;
      const current = ++request;
      const generation = sessionGeneration();
      const isCurrent = () => active && current === request && generation === sessionGeneration();
      let measured = false;
      dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: false });
      try {
        const result = await syncIOSScreenTime(getSession()!.userId);
        if (!isCurrent()) return;
        dispatch({ type: 'SCREEN_TIME_SNAPSHOT', snapshot: result.snapshot, now: Date.now() });
        measured = true;
        await reportScreenTime(result.authorization, result.timeline, generation);
        if (isCurrent()) dispatch({ type: 'SETTING', key: 'screenTimeSyncError', value: false });
      } catch {
        if (isCurrent()) {
          if (!measured)
            dispatch({ type: 'SETTING', key: 'screenTimeMeasurementReady', value: false });
          dispatch({ type: 'SETTING', key: 'screenTimeSyncError', value: true });
          dispatch({ type: 'SETTING', key: 'screenTimeHistoryReady', value: true });
        }
      }
    };
    void syncPermission();
    const unsubscribeReporting = subscribeScreenTimeReporting(() => void syncPermission());
    let syncedDay = dayKey();
    const dayChangeTimer = setInterval(() => {
      const currentDay = dayKey();
      if (currentDay === syncedDay) return;
      syncedDay = currentDay;
      void syncPermission();
    }, 1000);
    const usageTimer =
      Platform.OS === 'android' || Platform.OS === 'ios'
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
      unsubscribeReporting();
      clearInterval(usageTimer);
      clearInterval(dayChangeTimer);
      subscription.remove();
    };
  }, [loaded, hasServerSession, storageOwnerReady]);
  const focusShieldOwner = getSession()?.userId;
  useEffect(() => {
    if (!loaded || !storageOwnerReady || (Platform.OS !== 'ios' && Platform.OS !== 'android'))
      return;
    let active = true;
    let foreground = AppState.currentState === 'active';
    let request = 0;
    let retryDelay = 2000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // 같은 사용자 ID의 회원 전환도 이전 재시도를 정리하고 새 인증 세대로 동기화한다.
    const generation = authGeneration;
    const current = () =>
      active && generation === sessionGeneration() && focusShieldOwner === getSession()?.userId;
    const clearRetry = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const retry = () => {
      if (!current() || !foreground || !hasServerSession || Platform.OS !== 'ios') return;
      clearRetry();
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void sync(false);
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
    const sync = async (reportFailure = true) => {
      if (!current()) return;
      const sequence = ++request;
      const latest = () => current() && sequence === request;
      clearRetry();
      const session = hasServerSession ? stateRef.current.session : null;
      try {
        const applied = await (Platform.OS === 'android'
          ? syncAndroidFocus(session, stateRef.current.color, true)
          : syncFocusShield(session, stateRef.current.color, true, latest));
        if (!latest()) return;
        if (applied) {
          retryDelay = 2000;
          return;
        }
        if (
          reportFailure &&
          session?.status === 'active' &&
          (await shouldReportShieldFailure()) &&
          latest()
        )
          notify('앱 차단을 적용하지 못했어요. 스크린타임 권한을 확인해 주세요.');
        if (latest()) retry();
      } catch {
        if (!latest()) return;
        if (reportFailure && (await shouldReportShieldFailure()) && latest())
          notify('앱 차단 상태를 변경하지 못했어요. 다시 확인해 주세요.');
        if (latest()) retry();
      }
    };
    void sync();
    const subscription = AppState.addEventListener('change', (next) => {
      foreground = next === 'active';
      if (foreground) void sync();
      else clearRetry();
    });
    return () => {
      active = false;
      clearRetry();
      subscription.remove();
    };
  }, [
    loaded,
    storageOwnerReady,
    hasServerSession,
    authGeneration,
    focusShieldOwner,
    state.settings.permission,
    state.session?.id,
    state.session?.version,
    state.session?.status,
    state.session?.subject,
    state.color,
  ]);
  const liveActivityOwner = getSession()?.userId;
  useEffect(() => {
    if (!loaded || !hasServerSession || !storageOwnerReady || REVIEW || DEMO) return;
    return startLiveActivityPushSync(() => ({
      session: stateRef.current.session,
      color: stateRef.current.color,
    }));
  }, [loaded, hasServerSession, storageOwnerReady, liveActivityOwner, state.session?.id]);
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
    state.session?.version,
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
      if (active && url?.startsWith('com.oneorthree.focuscat://widget')) {
        replace(session ? sessionRoute(session) : 'home');
      }
      if (active && url?.startsWith('com.oneorthree.focuscat://activity') && session) {
        replace(sessionRoute(session));
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
      if (nextState === 'active') setHomeReload((value) => value + 1);
    });
    return () => subscription.remove();
  }, [loaded, hasServerSession]);
  useEffect(() => {
    if (!loaded || !hasServerSession || REVIEW || DEMO) return;
    // App 이 매초 다시 그리지 않으므로 자기 1초 타이머로 본다(GROMO-2372)
    const poll = () => {
      if (AppState.currentState !== 'active') return;
      const session = stateRef.current.session;
      if (session && shouldPollExpiredRest(session, Date.now(), restRecovery.current)) {
        // 서버 자동 종료 스케줄러가 다음 분에 실행될 수 있어 만료 후에도 간격을 두고 재조회한다.
        void recoverExpiredRestRef.current(session.id);
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [loaded, hasServerSession]);
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
  // 처리 본문은 매 렌더의 최신 상태(소속·상실 사유 등)를 보도록 ref 로 부른다 — 등록 당시 상태로 섬 고르기에 가지 않게
  // (GROMO-2366). 리스너는 지금처럼 화면이 바뀔 때마다 다시 걸어 다른 화면의 리스너와의 순서를 그대로 둔다.
  const hardwareBack = useRef<() => boolean>(() => false);
  hardwareBack.current = () => {
    // 운영진의 편지(GROMO-2615)는 뒤로 가기를 닫기로만 받는다 — 다른 어떤 처리보다 먼저다
    if (letterVisible) {
      if (!forced) dismissLetter();
      return true;
    }
    // 열린 확인창·진행 중인 건물 전환·화면이 건 뒤로 가기(backOverride)를 방문 분기보다 먼저 본다 — back() 의 앞 세
    // 검사와 같은 순서다. 그래서 방문 화면에서도 확인창이나 팝업이 END_VISIT 보다 먼저 닫히고, 집중→휴식 전환 취소처럼
    // override 보다 전환 취소가 앞서던 기존 순서도 그대로다(back() 는 그대로 둔다).
    if (focusBlockingGate) {
      if (!focusBlockingPermissionBusy) setFocusBlockingGate(null);
      return true;
    }
    if (modal) {
      setModal(null);
      return true;
    }
    if (cancelBuildingTransition()) return true;
    if (backOverride.current?.()) return true;
    // 서버 방문은 현재 섬을 바꾸지 않으므로 방문 상태만 지우고 내 섬으로 돌아간다.
    if (['home', 'visitIsland'].includes(route) && state.visitingIslandId && state.serverIslands) {
      dispatch({ type: 'END_VISIT' });
      reset(state.serverIslands.currentIslandId ? 'home' : 'sea');
      return true;
    }
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
    // 홈·로그인의 뒤로가기는 앱이 받지 않는다(OS 몫) — 홈에서 진행 중인 건물 전환은 위에서 이미 취소했다
    if (route === 'home' || route === 'login') return false;
    back();
    return true;
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () =>
      hardwareBack.current(),
    );
    return () => subscription.remove();
  }, [
    history,
    route,
    modal,
    focusBlockingGate,
    focusBlockingPermissionBusy,
    state.visitingIslandId,
    island.id,
    // RN 은 나중에 등록한 리스너를 먼저 부른다 — 편지가 뜰 때 재등록돼야 SeaScreen·CatInfoPopup·Hall 등 다른 리스너보다 앞선다
    letterVisible,
  ]);
  const islandAudioOnRef = useRef(islandAudioOn);
  islandAudioOnRef.current = islandAudioOn;
  // 곡 로드는 곡·섬이 바뀔 때만 한다. 재생/정지는 아래 volume effect가 islandAudioOn으로 따로 다루므로
  // 일시정지 뒤 재개하거나 다른 멤버가 재생 상태만 바꿔도 곡을 처음으로 되감지 않는다
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
      // 같은 섬은 같은 곡만 공유한다. 재생 지점은 기기마다 처음부터 돌고 서버 위치에 맞추지 않는다
      Promise.resolve(player.seekTo(0))
        .then(() => {
          if (cancelled) return;
          if (islandAudioOnRef.current) player.play();
          else player.pause();
        })
        .catch(() => {});
    } catch {}
    return () => {
      cancelled = true;
    };
  }, [island.track, island.id, previewAudio]);
  useEffect(() => {
    if (!island.playbackReset) return;
    try {
      player.pause();
      player.seekTo(0).catch(() => {});
    } catch {}
  }, [island.id, island.playbackReset]);
  useEffect(() => {
    if (route !== 'product' || !islandAudioOn) setPreviewAudio(false);
  }, [route, islandAudioOn]);
  // GROMO-1839 시작·가입 화면만 세로로 고정하고 나머지는 기기 방향을 따른다
  useRouteOrientation(route, letterVisible && !layout.tablet);
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
        // LOAD로 받은 진행도를 보존한다. 안내 단계는 명시한 검수 화면에서만 바꾼다.
        if (opts.guideStep !== undefined) setGuideStep(opts.guideStep);
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
    const cost = buildingCost(island, b),
      minutes = buildMinutes[b];
    confirm(
      t('app.build.confirmTitle', { building: buildingNames[b] }),
      t('app.build.confirmBody', { cost, minutes, count: minutes }),
      () => {
        dispatch({ type: 'BUILD', building: b });
        notify(t('app.build.started', { building: buildingNames[b] }));
      },
    );
  };
  const openFacility = (b: Building, r: Route) => {
    if (!island.buildings.includes(b)) {
      notify(t('app.build.facilityLocked', { building: buildingNames[b] }));
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
        notify(t('account.logoutStorageFailed'));
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
    // 보관 중이던 링크는 떠나는 세션의 것이다 — 다음 로그인에서 열지 않는다.
    setIncomingAppLink(null);
    void endLiveActivities().catch(() => {});
    // 안드로이드 홈 위젯을 비운다 — 로그아웃 뒤에도 런처에 이전 계정의 공부시간이 남지 않게(1.x 로그아웃과
    // 같은 처리). 탈퇴 완료도 이 경로를 지난다. best-effort 라 로그아웃을 막지 않는다.
    void clearStudyWidget();
    // 푸시 기기 삭제는 logout 이 세션을 지우기 전에 시작한다 — 요청이 첫 await 전에 지금 AT 를 싣는다(GROMO-2525).
    unregisterPushDevice();
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
          letterOpen: letterVisible,
          setSceneGuideOpen,
          accountDataReady: storageOwnerReady,
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
          now: Date.now(),
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
          // 언어 화면은 e.setLocalePref(applyLocalePref(pref)) 로 바꾼다.
          localePref,
          setLocalePref,
          beforeSeaVoyage,
          focusBlockingIntroPreview: FOCUS_BLOCKING_PREVIEW,
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
        <T>{t('account.loadingIsland')}</T>
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
            testID="app-content"
            accessibilityElementsHidden={appContentHidden || letterVisible}
            importantForAccessibility={
              appContentHidden || letterVisible ? 'no-hide-descendants' : 'auto'
            }
            aria-hidden={appContentHidden || letterVisible}
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
        {focusBlockingGate && (
          <FocusBlockingIntro
            e={{
              onClose: () => {
                if (!focusBlockingPermissionBusy) setFocusBlockingGate(null);
              },
              onLater: () => {
                if (!focusBlockingPermissionBusy) continueFocusBlockingTravel();
              },
              onAllow: () => {
                void requestFocusBlockingPermission();
              },
              busy: focusBlockingPermissionBusy,
            }}
          />
        )}
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
                  style={[
                    { color: C.muted },
                    Platform.OS === 'web' && ({ wordBreak: 'keep-all' } as any),
                  ]}
                >
                  {modal?.text}
                </NativeText>
                <View style={[S.row, { justifyContent: 'flex-end', gap: 8, marginTop: 8 }]}>
                  <NativeButton
                    dialog
                    title={modal.cancel ?? t('common.cancel')}
                    kind="glass"
                    onPress={() => {
                      const onCancel = modal.onCancel;
                      setModal(null);
                      onCancel?.();
                    }}
                  />
                  <NativeButton
                    dialog
                    title={modal.ok ?? t('common.ok')}
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
                    {t('account.guest.title')}
                  </NativeText>
                  <NativeText
                    style={[
                      { color: C.muted },
                      Platform.OS === 'web' && ({ wordBreak: 'keep-all' } as any),
                    ]}
                  >
                    {t('account.guest.body')}
                  </NativeText>
                  <Pressable
                    testID="member-conversion-terms"
                    accessibilityRole="checkbox"
                    accessibilityLabel={t('account.guest.termsA11y', { version: TERMS_VERSION })}
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
                      {t('account.guest.termsText', { version: TERMS_VERSION })}
                    </NativeText>
                  </Pressable>
                  <PolicyLinks textStyle={{ color: C.muted }} />
                  {(TERMS_VERSION ? loginProviders() : []).map((provider) => (
                    <NativeButton
                      key={provider}
                      dialog
                      dynamicHeight
                      title={
                        convUi.busy === provider
                          ? t('login.connecting')
                          : t(`login.continue.${provider}`)
                      }
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
                    title={t('common.later')}
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
                  {t('account.switch.title')}
                </NativeText>
                <NativeText
                  style={[
                    { color: C.muted },
                    Platform.OS === 'web' && ({ wordBreak: 'keep-all' } as any),
                  ]}
                >
                  {t('account.switch.body')}
                </NativeText>
                <View style={[S.row, { justifyContent: 'flex-end', gap: 8, marginTop: 8 }]}>
                  <NativeButton
                    dialog
                    dynamicHeight
                    title={t('common.cancel')}
                    kind="glass"
                    onPress={() => settleSwitch(false)}
                  />
                  <NativeButton
                    dialog
                    dynamicHeight
                    title={t('account.switch.confirm')}
                    kind="destructive"
                    onPress={() => settleSwitch(true)}
                  />
                </View>
              </Overlay>
            </View>
          </Modal>
        )}
        {forced ? (
          <DeveloperLetter
            key="forced"
            title={forced.title}
            body={forced.body}
            date={new Date(Date.parse(forced.publishedAt ?? '') || Date.now())}
            buttonTitle={t('developerLetter.update')}
            onClose={() => {
              Linking.openURL(STORE_URLS[Platform.OS === 'ios' ? 'ios' : 'android']).catch(
                () => {},
              );
            }}
          />
        ) : (
          letter && (
            <DeveloperLetter
              title={letter.title}
              body={letter.body}
              date={new Date(visibleAt(letter))}
              onClose={dismissLetter}
            />
          )
        )}
      </SafeAreaView>
    </MotionContext.Provider>
  );
}
