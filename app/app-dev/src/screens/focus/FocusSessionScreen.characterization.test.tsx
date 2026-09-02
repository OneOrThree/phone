// FocusSessionScreen 특성화 테스트(GROMO-1599) — 헤드리스화(GROMO-1600) 전에 **현행 동작을
// 그대로 고정**한다. 여기서 단언하는 것은 "옳은 동작"이 아니라 "지금의 동작"이다 — 리팩토링
// PR은 이 스위트를 건드리지 않고 green을 유지해야 한다.
//
// 고정하는 계약(에픽 1595 · docs/prd/apple-watch/ D2):
//   1. 3모드 틱·완료 전이(카운트업/카운트다운 완료 게이트/뽀모도로 경계 정산·마커 회전)
//   2. 일시정지 의미론 — 경과 정지 + 방해초(totalDistractionSeconds)로 업로드에 차감 반영
//   3. finish 경로 — 정산 업로드·마커 취소·라이브 레코드 제거·FocusResult replace
//   4. 백그라운드 복귀 — 실드 세션은 자리 비운 시간 전진(집중 인정), 폴백 세션은 15초 정책
//   5. 라이브 레코드 5초 주기 저장(강제종료 대비) — '미정산 구간'만 담는 것
//   6. 마커 시작 실패 — 세션은 계속, 종료는 POST 폴백(sessionId null)
//
// ⚠️ jest의 fake timer는 "백그라운드에서도 인터벌이 돈다"는 점이 실기기와 다르다. 실드 복귀
//    리플레이가 이탈 시점 스냅샷(leftSessionRef)에서 다시 계산해 덮어쓰므로 결과는 결정적이다
//    — 그 덮어쓰기 자체가 여기서 고정하는 동작이다.
import { act, fireEvent, render } from '@testing-library/react-native';
import { AxiosError, type AxiosResponse } from 'axios';
import { AppState, BackHandler, Dimensions, Vibration, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FocusSessionScreen from './FocusSessionScreen';
import { STORAGE_KEYS } from '@/types/storage';
import ScreenTimeModule from '@/services/ScreenTimeModule';
import { startFocusSession } from '@/services/focusApi';
import { uploadFocusBlock } from './uploadFocusBlock';
import { cancelMarker, flushPendingMarkerCancels } from './pendingMarkerCancels';
import { ensureFocusTagId } from './tagSync';
import { captureRef } from 'react-native-view-shot';
import { consumeCardInteraction, invalidateCardInteraction } from '@/services/cardInteraction';
import { scheduleLeaveNotifications, cancelLeaveNotifications } from './leaveNotifications';
import { isTodayVerdict, publishSessionSaveVerdict } from './sessionSaveVerdict';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  logFocusMenuOpened,
  logFocusSessionAbandoned,
  logFocusSessionCompleted,
  logFocusSessionStarted,
  logFocusViewChanged,
  logFocusOrientationChanged,
  logFocusSessionPaused,
  logFocusSessionResumed,
  logFocusDistractionDetected,
  logFocusMarkerStartFailed,
  subjectKeyOf,
} from '@/services/analyticsEvents';
import type { LiveFocusSession } from './types';
import { focusReadoutLayout } from './readoutLayout';

// ── 네이티브·외부 경계 목 ──────────────────────────────────────────────────────
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    startFocusShield: jest.fn(() => Promise.resolve(true)),
    stopFocusShield: jest.fn(() => Promise.resolve()),
    startFocusActivity: jest.fn(() => Promise.resolve()),
    // 실제 모듈은 항상 내보낸다 — 목에 없으면 옵셔널 호출과 인자 평가가 통째로 생략돼
    // GROMO-1597 상태 동기화 배선이 스위트 밖으로 빠진다(codex 리뷰 35차)
    updateFocusActivity: jest.fn(() => Promise.resolve()),
    endFocusActivity: jest.fn(() => Promise.resolve()),
    saveCharacterSnapshot: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('b64')),
}));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { DEFAULT: 0, PORTRAIT_UP: 1, LANDSCAPE: 2 },
}));
jest.mock('expo-linear-gradient', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { LinearGradient: View };
});

// ── 서버·저장 경계 목 — 특성화 대상은 "화면이 이들을 언제·무엇으로 부르는가"다 ──
jest.mock('@/services/focusApi', () => ({
  startFocusSession: jest.fn(() => Promise.resolve({ sessionId: 'marker-1' })),
}));
jest.mock('./tagSync', () => ({
  ensureFocusTagId: jest.fn(() => Promise.resolve('tag-1')),
}));
jest.mock('./uploadFocusBlock', () => ({
  uploadFocusBlock: jest.fn(() => Promise.resolve({ status: 'saved', response: {} })),
}));
jest.mock('./pendingMarkerCancels', () => ({
  cancelMarker: jest.fn(() => Promise.resolve()),
  flushPendingMarkerCancels: jest.fn(() => Promise.resolve()),
}));
jest.mock('./sessionSaveVerdict', () => ({
  isTodayVerdict: jest.fn(() => true),
  publishSessionSaveVerdict: jest.fn(),
}));
jest.mock('./leaveNotifications', () => ({
  scheduleLeaveNotifications: jest.fn(() => Promise.resolve()),
  cancelLeaveNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logFocusSessionStarted: jest.fn(),
  logFocusSessionPaused: jest.fn(),
  logFocusSessionResumed: jest.fn(),
  logFocusSessionCompleted: jest.fn(),
  logFocusSessionAbandoned: jest.fn(),
  logFocusDistractionDetected: jest.fn(),
  logFocusMenuOpened: jest.fn(),
  logFocusViewChanged: jest.fn(),
  logFocusOrientationChanged: jest.fn(),
  logFocusMarkerStartFailed: jest.fn(),
  // 실구현 사용 — 목이 원문 id를 돌려주면 비식별 해시 계약(subject_key)이 검증에서 빠진다(codex 리뷰 14차)
  subjectKeyOf: jest.requireActual<typeof import('@/services/analyticsEvents')>(
    '@/services/analyticsEvents',
  ).subjectKeyOf,
}));
jest.mock('@/services/cardInteraction', () => ({
  consumeCardInteraction: jest.fn<string | undefined, unknown[]>(() => undefined),
  invalidateCardInteraction: jest.fn(),
  // 순수 export는 실구현·실값 — 목이 바꾸면 화면이 아니라 목이 만든 동작을 고정하게 된다(codex 리뷰 14차)
  normalizeFocusEntrySource: jest.requireActual<typeof import('@/services/cardInteraction')>(
    '@/services/cardInteraction',
  ).normalizeFocusEntrySource,
  FOCUS_ATTRIBUTION_TTL_MS: jest.requireActual<typeof import('@/services/cardInteraction')>(
    '@/services/cardInteraction',
  ).FOCUS_ATTRIBUTION_TTL_MS,
}));

// ── 스토어·훅 목 — 세션 로직이 읽기만 하는 주변 상태 ──────────────────────────
const mockAddFocusSeconds = jest.fn();
const mockAddFocusToSubject = jest.fn();
// 닉네임 가변 — 항상 'nick'이면 빈 닉네임의 '나' 폴백 제거를 못 잡는다(codex 리뷰 34차)
let mockFocusOccupation: string | null = null;
let mockNickname = 'nick';
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({ userId: 'user-1', nickname: mockNickname, occupation: mockFocusOccupation }),
}));
// 세션 전 오늘 누적 — 기본 0, 로컬 폴백 테스트에서 갈아끼움
let mockTodayFocusSeconds = 0;
jest.mock('@/store/FocusContext', () => ({
  useFocus: () => ({
    addFocusSeconds: mockAddFocusSeconds,
    todayFocusSeconds: mockTodayFocusSeconds,
  }),
}));
// refresh는 모듈 범위로 고정한다 — 렌더마다 새 함수를 주면 이를 의존하는 settleFocusBlock·
// finish·AppState 이펙트가 매 틱 재생성되고, cleanup의 cancelLeaveNotifications가 계속 불려
// '복귀 시 취소' 단언이 공허해진다(codex 리뷰 5차).
const mockCoinRefresh = jest.fn();
jest.mock('@/store/CoinContext', () => ({ useCoins: () => ({ refresh: mockCoinRefresh }) }));
// 과목 목록은 테스트별로 갈아끼울 수 있게 모듈 범위 — 기본은 선택 과목 하나(beforeEach 리셋)
let mockSubjectsData = [{ id: 's1', name: '수학', accumulatedSeconds: 0, color: '#FFB4A2' }];
jest.mock('@/store/SubjectContext', () => ({
  useSubjects: () => ({
    subjects: mockSubjectsData,
    addFocusToSubject: mockAddFocusToSubject,
  }),
}));
// 커스텀 캐릭터 소스 — 기본 null(기본 캐릭터), 배선 테스트에서 갈아끼움
let mockActiveSource: string | null = null;
jest.mock('@/store/CharacterContext', () => ({
  useCharacter: () => ({ activeSource: mockActiveSource }),
}));
// 친구 그리드 fixture — 기본 빈 목록
let mockFriends: unknown[] = [];
let mockPinnedIds: Set<string> = new Set();
jest.mock('@/screens/league/useFocusFriends', () => ({
  useFocusFriends: () => ({ friends: mockFriends, pinnedIds: mockPinnedIds }),
}));
// 리그 훅 호출 인자를 붙잡고, 호출 종류(시험/전체)별로 다른 목록을 돌려준다 —
// 두 목록이 두 그리드에 뒤바뀌어 배선되는 회귀를 값으로 가른다
const mockLeagueArgs: unknown[] = [];
let mockLeagueMembers: unknown[] = [];
let mockExamMembers: unknown[] = [];
jest.mock('./useSessionLeagueMembers', () => ({
  useSessionLeagueMembers: (args: { occupation?: string }) => {
    mockLeagueArgs.push(args);
    return { members: args?.occupation != null ? mockExamMembers : mockLeagueMembers };
  },
}));
// 서버의 KST 오늘 집중 스냅샷 — 실제 계약은 { day, minutes } | null (테스트별 갈아끼움)
let mockMyFocus: { day: string; minutes: number } | null = null;
// 참여 그룹 fixture — 기본 빈 목록. 호출 인자도 수집한다(나 제외 배선 관찰)
let mockSessionGroups: Array<{ groupId: string; groupName: string; members: unknown[] }> = [];
const mockGroupArgs: unknown[] = [];
jest.mock('./useSessionGroups', () => ({
  useSessionGroups: (args: unknown) => {
    mockGroupArgs.push(args);
    return { groups: mockSessionGroups, myFocus: mockMyFocus };
  },
}));
// 준비 시험 카테고리 — 기본 null(미설정), 시험 필터 테스트에서 갈아끼움
// 표시명은 서버 카탈로그(GET /occupations)에서 온다 — 테스트는 code 1건만 매핑한다.
// 준비 시험 code 자체는 서버 프로필이 정본이라 위 UserContext 목이 공급한다(GROMO-1624).
jest.mock('@/services/occupationCatalog', () => ({
  useOccupationName: (code: string | null) => (code === 'CSAT' ? '수능·N수' : null),
}));
// '동작 줄이기' 확정 true — 실제 useMotion이 reanimated 호출 없이 즉시값 경로로 돈다.
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => true,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

// ── 렌더 전용 무거운 자식은 껍데기로 — 세션 로직과 무관 ───────────────────────
// 내 셀(me)과 그리드별 전달 props를 붙잡는다 — 그리드 자체는 렌더하지 않되 화면→그리드 배선은 관찰한다
const mockGridMeCaptures: Array<{
  totalSeconds: number;
  isFocusing: boolean;
  nickname: string;
  tagName: string;
}> = [];
const mockGridPropsCaptures: Array<{
  title: string;
  visible: boolean;
  members: unknown;
  pinnedIds: unknown;
  showMeWhenEmpty: boolean | undefined;
}> = [];
jest.mock('./components/LiveFocusGrid', () => ({
  LiveFocusGrid: (props: {
    me: { totalSeconds: number; isFocusing: boolean; nickname: string; tagName: string };
    title: string;
    visible: boolean;
    members: unknown;
    pinnedIds: unknown;
    showMeWhenEmpty?: boolean;
  }) => {
    mockGridMeCaptures.push(props.me);
    mockGridPropsCaptures.push({
      title: props.title,
      visible: props.visible,
      members: props.members,
      pinnedIds: props.pinnedIds,
      showMeWhenEmpty: props.showMeWhenEmpty,
    });
    return null;
  },
}));
// 특정 그리드의 마지막 전달값 — 페이저에 같은 제목 그리드는 하나뿐이라 제목으로 찾는다
const lastGridProps = (title: string) =>
  mockGridPropsCaptures.filter((p) => p.title === title).at(-1);
// 드로어 전달값을 붙잡는다 — 메뉴 버튼→드로어·미정산 오늘 집중·닫기 배선 관찰용
const mockDrawerCaptures: Array<{
  open: boolean;
  liveSubjectId: string;
  liveSeconds: number;
  onClose: () => void;
}> = [];
jest.mock('./components/FocusMenuDrawer', () => ({
  FocusMenuDrawer: (props: {
    open: boolean;
    liveSubjectId: string;
    liveSeconds: number;
    onClose: () => void;
  }) => {
    mockDrawerCaptures.push({
      open: props.open,
      liveSubjectId: props.liveSubjectId,
      liveSeconds: props.liveSeconds,
      onClose: props.onClose,
    });
    return null;
  },
}));
// 가로 분기 전달값을 붙잡는다 — 레이아웃은 렌더하지 않되 화면→가로 컴포넌트 배선은 관찰한다
const mockLandscapeCaptures: Array<{
  subjectName: string;
  onRotatePortrait: () => void;
  mode: string;
  format: string;
  displaySeconds: number;
  phase: string;
  setIndex: number;
  sets: number;
}> = [];
jest.mock('./FocusLandscape', () => ({
  FocusLandscape: (props: (typeof mockLandscapeCaptures)[number]) => {
    mockLandscapeCaptures.push(props);
    return null;
  },
}));
// 첫 집중 안내의 전달값을 붙잡는다 — 저장 키·단계 배선 관찰용
const mockGuideCaptures: Array<{ storageKey: string; steps: unknown[] }> = [];
jest.mock('@/components/TabGuideOverlay', () => ({
  TabGuideOverlay: (props: { storageKey: string; steps: unknown[] }) => {
    mockGuideCaptures.push({ storageKey: props.storageKey, steps: props.steps });
    return null;
  },
}));
// 호흡 애니메이션 활성 플래그를 붙잡는다 — 게이트·페이지 전환의 절전 배선 관찰용.
// children(캡처 대상 캐릭터 뷰)은 통과시켜야 CharacterImage 배선도 함께 관찰된다.
const mockCharActiveCaptures: boolean[] = [];
jest.mock('@/components/character/AnimatedCharacter', () => ({
  AnimatedCharacter: (props: { active: boolean; children?: unknown }) => {
    mockCharActiveCaptures.push(props.active);
    return (props.children as never) ?? null;
  },
}));
// 캡처 대상 캐릭터의 전달 props를 붙잡는다 — 커스텀 소스 배선 관찰용
const mockCharImageCaptures: Array<{ variant?: string; sourceUri?: string; size?: number }> = [];
jest.mock('@/components/character/CharacterImage', () => ({
  CharacterImage: (props: { variant?: string; sourceUri?: string; size?: number }) => {
    mockCharImageCaptures.push({
      variant: props.variant,
      sourceUri: props.sourceUri,
      size: props.size,
    });
    return null;
  },
}));
jest.mock('@/components/PressableScale', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PressableScale: ({
      children,
      onPress,
      testID,
      accessibilityLabel,
      ref,
    }: {
      children?: unknown;
      onPress?: () => void;
      testID?: string;
      accessibilityLabel?: string;
      // React 19 ref-as-prop — 앵커 ref가 호스트에 실제로 연결되는지 관찰(codex 리뷰 31차)
      ref?: unknown;
    }) =>
      mockReact.createElement(
        Text,
        { testID, onPress, accessibilityLabel, ref } as never,
        children as never,
      ),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: View,
  };
});

let mockRouteParams: Record<string, unknown> = {};
const mockNavigation = { replace: jest.fn(), navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
}));

// ── 하네스 ─────────────────────────────────────────────────────────────────────
const mockedUpload = uploadFocusBlock as jest.Mock;
const mockedStartMarker = startFocusSession as jest.Mock;
const mockedShieldStart = ScreenTimeModule.startFocusShield as jest.Mock;

// AppState 핸들러를 등록 순서대로 붙잡는다 — 구독 순서(선언 순서)가 동작의 일부다.
let appStateHandlers: ((s: AppStateStatus) => void)[] = [];

// ⚠️ 1초 단위로 act를 쪼개서 전진한다 — 한 번에 advanceTimersByTime(N초)를 하면 N개의 틱
// 콜백이 같은 콜스택에서 돌아 React가 배칭하고, sessionRef(렌더 시 갱신)가 낡은 채 모든 틱이
// 같은 prev에서 계산돼 경과가 1초만 오른다. 실기기는 틱마다 태스크가 갈려 렌더가 끼어든다.
const advance = async (ms: number) => {
  const wholeSeconds = Math.floor(ms / 1000);
  for (let i = 0; i < wholeSeconds; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  const remainder = ms - wholeSeconds * 1000;
  if (remainder > 0) {
    await act(async () => {
      jest.advanceTimersByTime(remainder);
    });
  }
};
const flush = () => act(async () => {});
const fireAppState = (s: AppStateStatus) =>
  act(async () => {
    appStateHandlers.forEach((h) => h(s));
  });
// 벽시계만 전진 — 인터벌은 돌리지 않는다. 실기기의 백그라운드(JS suspend) 재현용:
// 폴백(실드 없음) 복귀 경로는 실드 경로와 달리 상태를 되감지 않으므로, advance로 흉내내면
// 백그라운드에서도 틱이 쌓여 이탈 시간이 집중으로 계상돼도 못 잡는다(codex 리뷰 PR #676).
const jumpWallClock = (ms: number) =>
  act(async () => {
    jest.setSystemTime(Date.now() + ms);
  });
// LA 시작의 3번째 인자(FocusActivityState, GROMO-1597) 기대값 — 카운트업 기준.
// elapsedSeconds는 시작 시점까지의 경과(케이스별 상이). revision은 단조 증가인데
// 마운트 동기화(updateFocusActivity)가 1을 먼저 소비하므로 600ms 뒤 시작은 2부터다.
const laState = (over: Partial<Record<string, unknown>> = {}) => ({
  mode: 'countup',
  phase: 'focus',
  isPaused: false,
  elapsedSeconds: 1,
  remainingSeconds: null,
  revision: 2,
  ...over,
});
// focusLiveSession 키에 대한 쓰기 호출만 추린다 — 저장 '주기' 검증용
const liveRecordWrites = () =>
  (AsyncStorage.setItem as unknown as jest.Mock).mock.calls.filter(
    (c) => c[0] === STORAGE_KEYS.focusLiveSession,
  );

let view: Awaited<ReturnType<typeof render>>;
async function renderSession(params: Record<string, unknown>) {
  mockRouteParams = { subjectId: 's1', subjectName: '수학', ...params };
  view = await render(<FocusSessionScreen />);
  await flush(); // 마커 시작·실드 적용 등 마운트 비동기 확정
}

async function readLiveRecord(): Promise<LiveFocusSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusLiveSession);
  return raw ? (JSON.parse(raw) as LiveFocusSession) : null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSubjectsData = [{ id: 's1', name: '수학', accumulatedSeconds: 0, color: '#FFB4A2' }];
  mockMyFocus = null;
  mockFocusOccupation = null;
  mockActiveSource = null;
  mockSessionGroups = [];
  mockFriends = [];
  mockPinnedIds = new Set();
  mockTodayFocusSeconds = 0;
  mockNickname = 'nick';
  mockGridMeCaptures.length = 0;
  mockGridPropsCaptures.length = 0;
  mockLandscapeCaptures.length = 0;
  mockDrawerCaptures.length = 0;
  mockCharActiveCaptures.length = 0;
  mockCharImageCaptures.length = 0;
  mockLeagueArgs.length = 0;
  mockGroupArgs.length = 0;
  mockLeagueMembers = [];
  mockExamMembers = [];
  mockGuideCaptures.length = 0;
  await AsyncStorage.clear();
  jest.useFakeTimers();
  appStateHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const h = handler as (s: AppStateStatus) => void;
    appStateHandlers.push(h);
    // remove가 실제로 빼야 한다 — no-op이면 이펙트 재구독 때마다 낡은 핸들러가 쌓여
    // 이벤트가 중복 전달되고, cleanup 횟수 기반 단언이 오염된다(codex 리뷰 5차).
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter((x) => x !== h);
      },
    } as never;
  });
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
  mockedShieldStart.mockResolvedValue(true);
  mockedStartMarker.mockResolvedValue({ sessionId: 'marker-1' });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('카운트업 — 틱·라이브 레코드·finish', () => {
  test('1초 틱이 경과를 쌓고, 5초마다 미정산 구간을 라이브 레코드로 남긴다', async () => {
    await renderSession({ mode: 'countup' });
    // 저장 '주기' 자체를 고정한다 — 4초까지는 쓰기 0, 5초에 정확히 1회(codex 리뷰: 매초
    // 저장으로 바뀌는 회귀는 마지막 값만 봐서는 못 잡는다).
    await advance(4000);
    expect(liveRecordWrites()).toHaveLength(0);
    await advance(1000);
    expect(liveRecordWrites()).toHaveLength(1);
    const record = await readLiveRecord();
    expect(record).not.toBeNull();
    expect(record!.elapsed).toBe(5); // 미정산 구간 = 아직 서버에 안 올린 집중초
    expect(record!.subjectId).toBe('s1');
    expect(record!.subjectName).toBe('수학'); // 고아 정산의 태그 해석·업로드 과목명 원천(codex 리뷰 29차)
    expect(record!.userId).toBe('user-1');
    expect(record!.serverSessionId).toBe('marker-1'); // 강제종료 시 서버 스윕 대상
    // 시간 범위도 고아 정산의 입력이다 — OrphanFocusSettler는 (updatedAt−startedAt)−elapsed로
    // 방해초를 역산하고 updatedAt을 복구 업로드의 endedAt으로 쓴다(:101-112). 두 시각이
    // 누락·고정되면 복구 구간과 보상이 통째로 어긋난다(codex 리뷰 17차).
    expect(record!.startedAt).toBe(mockedStartMarker.mock.calls[0][0].startedAt);
    expect(Date.parse(record!.updatedAt) - Date.parse(record!.startedAt)).toBe(5000);
    // 주기는 반복돼야 한다 — 일회성(elapsed === 5) 저장으로 바뀌면 긴 집중의 강제종료에서
    // 레코드가 5초에 멈춰 이후 구간이 통째로 유실된다(codex 리뷰 18차).
    await advance(5000);
    expect(liveRecordWrites()).toHaveLength(2);
    expect((await readLiveRecord())!.elapsed).toBe(10);
    // 화면의 큰 타이머도 경과를 그대로 보여준다 — 렌더 연결이 빠지면 정산·저장은 멀쩡해도
    // 사용자가 진행 시간을 볼 수 없다(codex 리뷰 26차).
    expect(view.getByText('00:00:10')).toBeTruthy();
  });

  test('정지 버튼 finish — 블록 정산 업로드·마커 취소·레코드 제거·FocusResult(completed=true) replace', async () => {
    await renderSession({ mode: 'countup' });
    await advance(7000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    // 정산 업로드 1회 — 마커 id를 실어 PATCH 경로를 태운다
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const { sessionId, body } = mockedUpload.mock.calls[0][0];
    expect(sessionId).toBe('marker-1');
    expect(body.focusType).toBe('INFINITE');
    // 소유 계정 — null로 대기열에 들어가면 다음 flush가 계정 불일치로 폐기해 영구 유실된다
    // (codex 리뷰 13차)
    expect(mockedUpload.mock.calls[0][0].userId).toBe('user-1');
    // 마커 '시작' 요청에도 모드가 실린다 — PATCH는 focusType을 다시 안 보내므로 시작 값이
    // 최종 세션 유형으로 남는다(codex 리뷰 6차).
    expect(mockedStartMarker).toHaveBeenCalledWith(
      expect.objectContaining({ focusType: 'INFINITE' }),
    );
    // 과목 태그 해석 결과가 시작·정산 양쪽에 실린다 — 빠지면 서버 세션이 미분류로 저장돼
    // 과목별 통계가 유실된다(codex 리뷰 8차).
    expect(mockedStartMarker).toHaveBeenCalledWith(
      expect.objectContaining({ focusTagId: 'tag-1' }),
    );
    expect(body.focusTagId).toBe('tag-1');
    // 완료 계측의 카운트업 페이로드 — 뽀모도로 테스트만으로는 모드별 오배선(고정값 발행)을
    // 못 잡는다(codex 리뷰 31차). 7초 세션 → focus_minutes 반올림 0.
    expect(logFocusSessionCompleted).toHaveBeenCalledWith({
      mode: 'countup',
      focus_minutes: 0,
      has_tag: true,
    });
    // 시작 계측 1회 + 전체 페이로드 — objectContaining이면 카운트업에 목표값이 발행돼도
    // 못 잡는다(codex 리뷰 32차: 카운트업은 목표 없는 모드 — goal_minutes: undefined).
    expect(logFocusSessionStarted).toHaveBeenCalledTimes(1);
    expect(logFocusSessionStarted).toHaveBeenCalledWith({
      mode: 'countup',
      has_tag: true,
      goal_minutes: undefined, // 카운트업 — 목표 없음
      subject_key: subjectKeyOf('s1'), // 실구현 해시(s_…) — 원문 id 노출이면 실패
      entry_source: 'unknown', // 출처 미지정의 실제 정규화 — 목이 지어낸 'direct'가 아니다
      interaction_id: undefined,
    });
    // Live Activity 시작 배선(600ms 지연 캡처 후) — 종료 단언만으로는 시작 누락을 못 잡는다(codex 리뷰 8차)
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith('수학', [], laState());
    // saved 전용 후처리 — 지급 확정 후 코인 재조회 + 서버 스트릭 판정 발행(codex 리뷰 6차)
    expect(mockCoinRefresh).toHaveBeenCalledTimes(1);
    expect(publishSessionSaveVerdict).toHaveBeenCalledWith({});
    expect(body.subject).toBe('수학');
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(7000);
    // 로컬 적립도 같은 델타로 — 정확히 1회(중복 적립 회귀 방지, codex 리뷰)
    expect(mockAddFocusSeconds).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(7);
    expect(mockAddFocusToSubject).toHaveBeenCalledTimes(1);
    expect(mockAddFocusToSubject).toHaveBeenCalledWith('s1', 7);
    // 카운트업 정지는 유일한 정상 종료 경로 — completed로 결과 화면 진입
    expect(mockedNavigationReplace()).toEqual([
      'FocusResult',
      { focusSeconds: 7, subjectId: 's1', subjectName: '수학', completed: true },
    ]);
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    // 실드·Live Activity 해제 + 라이브 레코드 제거
    expect(ScreenTimeModule.stopFocusShield).toHaveBeenCalled();
    expect(ScreenTimeModule.endFocusActivity).toHaveBeenCalled();
    expect(await readLiveRecord()).toBeNull();
    // 종료 후 다음 저장 경계를 넘겨도 레코드는 재생성되지 않는다 — saveLive의 finishedRef
    // 가드가 빠지면 화면 해제가 늦은 사이 틱이 레코드를 되살려 다음 실행의 고아 정산이
    // 끝난 세션을 다시 적립한다(codex 리뷰 24차).
    const writesAfterFinish = liveRecordWrites().length;
    await advance(10_000);
    expect(liveRecordWrites().length).toBe(writesAfterFinish);
    expect(await readLiveRecord()).toBeNull();
  });

  test('과목 태그 해석이 실패해도: 마커 시작·정산 업로드는 무태그(null)로 계속된다', async () => {
    // 오프라인·조회 실패 시 focusTagId=null로 두 요청을 계속하는 게 현행 계약 — 중단되면
    // 로컬 적립만 남고 서버 기록·보상이 유실된다(codex 리뷰 14차).
    (ensureFocusTagId as jest.Mock)
      .mockRejectedValueOnce(new Error('offline')) // 마커 시작의 해석
      .mockRejectedValueOnce(new Error('offline')); // 정산의 해석
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    expect(mockedStartMarker).toHaveBeenCalledWith(expect.objectContaining({ focusTagId: null }));
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].body.focusTagId).toBeNull();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3 });
  });

  test('캐릭터 캡처가 실패해도: Live Activity는 기본 마스코트 폴백으로 시작된다', async () => {
    // 캡처 거부·타임아웃에도 LA는 시작하는 게 현행이다 — 시작이 캡처 성공 분기 안으로 들어가면
    // 해당 기기에서 잠금화면 활동이 통째로 사라진다(codex 리뷰 14차).
    (captureRef as jest.Mock).mockRejectedValueOnce(new Error('capture denied'));
    await renderSession({ mode: 'countup' });
    await advance(2000); // 600ms 지연 시작 경과
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith(
      '수학',
      [],
      laState({ elapsedSeconds: 0 }),
    );
  });

  test('스냅샷 저장(네이티브)이 거부돼도: Live Activity는 기본 마스코트 폴백으로 시작된다', async () => {
    // 캡처 성공 후 App Group 저장이 실패하는 경로 — 저장 오류가 캡처 오류와 같은 catch로
    // 삼켜지지 않으면(전파되면) 해당 기기의 LA가 통째로 사라진다(codex 리뷰 26차).
    (ScreenTimeModule.saveCharacterSnapshot as jest.Mock).mockRejectedValueOnce(
      new Error('app group write denied'),
    );
    await renderSession({ mode: 'countup' });
    await advance(2000);
    expect(ScreenTimeModule.saveCharacterSnapshot).toHaveBeenCalledWith('b64'); // 캡처는 성공
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith('수학', [], laState()); // 폴백 시작
  });

  test('캡처가 영영 pending이어도: 1.5초 타임아웃 폴백으로 Live Activity는 시작된다', async () => {
    // 즉시 reject 테스트(위)는 Promise.race 타임아웃이 제거돼도 통과한다 — 캡처가 응답 없이
    // 멈춘 기기에선 이 타임아웃만이 기본 마스코트 폴백으로 LA를 살린다(codex 리뷰 18차).
    (captureRef as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    await renderSession({ mode: 'countup' });
    await advance(2200); // 600ms 지연 + 1.5초 캡처 타임아웃 경과
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith(
      '수학',
      [],
      laState({ elapsedSeconds: 2 }),
    );
    expect(ScreenTimeModule.saveCharacterSnapshot).not.toHaveBeenCalled(); // 스냅샷 없이 폴백
  });

  test('캐릭터 캡처 성공: 스냅샷 저장(b64) 완료 후에야 Live Activity를 시작한다', async () => {
    // 저장 완료를 기다리지 않고 LA를 먼저 시작하면 위젯이 파일 부재·과거 캐릭터 시점에 그린다 —
    // 캡처값 전달과 저장→시작 순서가 계약이다(codex 리뷰 21차).
    let resolveSave!: () => void;
    (ScreenTimeModule.saveCharacterSnapshot as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveSave = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(1000); // 600ms 경과 — 캡처 완료, 저장 대기
    expect(ScreenTimeModule.saveCharacterSnapshot).toHaveBeenCalledWith('b64');
    // 캡처 대상·옵션 배선 — ref가 호스트에 연결돼 있고 PNG base64 옵션이어야 네이티브
    // Data(base64Encoded:)가 받는다. 기본 파일 URI로 바뀌면 저장이 조용히 실패한다(codex 리뷰 31차).
    const [capTarget, capOpts] = (captureRef as jest.Mock).mock.calls[0];
    expect(capTarget.current).toBeTruthy();
    expect(capOpts).toMatchObject({ format: 'png', result: 'base64' });
    expect(ScreenTimeModule.startFocusActivity).not.toHaveBeenCalled(); // 저장 완료 전
    await act(async () => {
      resolveSave();
    });
    await flush();
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith('수학', [], laState());
  });

  test('업로드가 대기열행(queued)이어도 종료는 그대로 진행된다 — 로컬 적립·레코드 삭제·결과 화면', async () => {
    // 네트워크 장애로 서버 저장이 대기열에 남아도 종료 UX는 막히지 않는 게 현행 계약이다 —
    // 로컬 적립·레코드 삭제·FocusResult 이동은 업로드 결과와 무관하고, saved 전용 후처리
    // (코인 재조회)만 생략된다. 헤드리스화가 이 동작들을 saved 분기 안으로 옮기면 오프라인
    // 사용자의 종료·적립이 유실된다(codex 리뷰 5차).
    mockedUpload.mockResolvedValueOnce({ status: 'queued' });
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(5);
    expect(await readLiveRecord()).toBeNull();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: true });
    expect(mockCoinRefresh).not.toHaveBeenCalled(); // 지급 미확정 — 코인 재조회는 saved에서만
  });

  test('첫 틱 전 즉시 정지: 업로드 없이 cancelMarker가 열린 마커를 닫는다', async () => {
    // 델타 0이면 정산이 마커를 회전하지 않는다 — 이때 열린 마커를 닫는 유일한 주체는 finish의
    // cancelLiveSession이다. 빠지면 0초 세션의 마커가 친구 화면에 서버 스윕(12h)까지 남는다
    // (codex 리뷰 7차).
    await renderSession({ mode: 'countup' });
    await fireEvent.press(view.getByTestId('focus.stop')); // 경과 0에서 즉시 정지
    await flush();

    expect(mockedUpload).not.toHaveBeenCalled(); // 정산할 델타가 없다
    expect(cancelMarker).toHaveBeenCalledTimes(1);
    expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1');
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 0 });
  });

  test('백그라운드 진입 즉시 미정산 레코드를 저장한다 — 5초 주기를 기다리지 않는다', async () => {
    // 진입 핸들러의 즉시 saveLive가 빠지면 첫 5초 전 이탈 직후 강제종료에서 고아 정산 근거가
    // 전혀 남지 않아 집중 시간이 유실되고 마커도 장시간 열린다(codex 리뷰 7차).
    await renderSession({ mode: 'countup' });
    await advance(3000);
    expect(liveRecordWrites()).toHaveLength(0); // 5초 주기 저장은 아직
    await fireAppState('background');
    expect(liveRecordWrites()).toHaveLength(1); // 진입 즉시 저장
    const bgRecord = await readLiveRecord();
    expect(bgRecord!.elapsed).toBe(3);
    expect(bgRecord!.serverSessionId).toBe('marker-1');
  });

  test('정지 버튼 연속 두 번: finish는 멱등 — 업로드·적립·계측·이동 전부 1회', async () => {
    // finishedRef가 진입 즉시(동기) 걸리는 게 현행이다 — 가드가 비동기 뒤로 밀리면 빠른 더블
    // 탭에 종료 체인이 두 번 돌아 replace·적립이 중복된다(codex 리뷰 11차).
    await renderSession({ mode: 'countup' });
    await advance(5000);
    // 같은 동기 구간에서 두 번 탭 — 첫 finish가 removeItem await에 걸려 있는 사이의 재진입을
    // 재현한다(press 사이를 await하면 첫 finish가 이미 await를 지나 변이 창이 닫힌다).
    await act(async () => {
      const first = fireEvent.press(view.getByTestId('focus.stop'));
      const second = fireEvent.press(view.getByTestId('focus.stop'));
      await Promise.all([first, second]);
    });
    await flush();

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledTimes(1);
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
  });

  test('그룹 카드 진입: interaction이 소비돼 시작 계측에 귀속된다', async () => {
    // 카드 진입 파라미터 → consumeCardInteraction(TTL 판정) → interaction_id 발행의 배선을
    // 고정한다 — 빠지면 카드 진입 퍼널이 오염된다(codex 리뷰 9차).
    (consumeCardInteraction as jest.Mock).mockReturnValueOnce('ix-1');
    await renderSession({
      mode: 'countup',
      entrySource: 'group_card',
      interactionId: 'ix-1',
      interactionAcceptedAt: 1_000_000,
    });
    expect(consumeCardInteraction).toHaveBeenCalledWith(
      { entrySource: 'group_card', interactionId: 'ix-1', interactionAcceptedAt: 1_000_000 },
      600_000, // FOCUS_ATTRIBUTION_TTL_MS 실값(10분)
    );
    expect(logFocusSessionStarted).toHaveBeenCalledWith(
      expect.objectContaining({ entry_source: 'group_card', interaction_id: 'ix-1' }),
    );
    expect(invalidateCardInteraction).not.toHaveBeenCalled(); // 활성 마운트는 폐기 없이 소비
  });

  test('비활성(background) 상태로 마운트되면: consume 전에 interaction을 폐기한다', async () => {
    // 카드 수락 뒤 앱이 비활성화된 사이 내비게이션이 완료된 경우 — 사용자가 화면을 못 본
    // 진입이므로 invalidateCardInteraction이 consume보다 먼저 돌아 의도를 폐기해야 한다.
    // 이 배선이 빠지면 폐기됐어야 할 의도가 focus_session_started.interaction_id로 귀속돼
    // 그룹 카드 퍼널이 부푼다(codex 리뷰 15차). id 미발행 자체는 실제 cardInteraction 저장소가
    // 폐기된 항목의 consume에 undefined를 돌려줘 보장한다(그 계약은 저장소 유닛 테스트 몫) —
    // 여기서는 화면이 폐기를 부르는 배선과 호출 순서를 고정한다.
    const appStateOwner = AppState as unknown as { currentState: AppStateStatus };
    const originalAppState = appStateOwner.currentState;
    appStateOwner.currentState = 'background';
    try {
      await renderSession({
        mode: 'countup',
        entrySource: 'group_card',
        interactionId: 'ix-2',
        interactionAcceptedAt: 1_000_000,
      });
    } finally {
      appStateOwner.currentState = originalAppState;
    }
    expect(invalidateCardInteraction).toHaveBeenCalledWith('ix-2');
    expect((invalidateCardInteraction as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (consumeCardInteraction as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(logFocusSessionStarted).toHaveBeenCalledWith(
      expect.objectContaining({ interaction_id: undefined }),
    );
  });

  test('inactive 상태로 마운트돼도: consume 전에 interaction을 폐기한다', async () => {
    // iOS는 카드 수락 직후 알림 센터·앱 전환기로 background 없이 inactive에 머문 채 화면이
    // 마운트될 수 있다 — background 분기만 검증하면 inactive 절반이 제거돼도 못 잡는다
    // (codex 리뷰 32차).
    const appStateOwner = AppState as unknown as { currentState: AppStateStatus };
    const originalAppState = appStateOwner.currentState;
    appStateOwner.currentState = 'inactive';
    try {
      await renderSession({
        mode: 'countup',
        entrySource: 'group_card',
        interactionId: 'ix-3',
        interactionAcceptedAt: 1_000_000,
      });
    } finally {
      appStateOwner.currentState = originalAppState;
    }
    expect(invalidateCardInteraction).toHaveBeenCalledWith('ix-3');
    expect((invalidateCardInteraction as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (consumeCardInteraction as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  test('주기 저장(setItem)이 실패해도 세션은 계속된다 — 틱·정산·결과 화면 정상', async () => {
    // saveLive의 setItem은 .catch로 삼키는 게 현행이다 — 실패가 전파되면 저장소 오류 기기에서
    // 타이머·수동 종료 정산까지 중단된다(codex 리뷰 8차).
    await renderSession({ mode: 'countup' });
    await advance(4000);
    (AsyncStorage.setItem as unknown as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    await advance(1000); // 5초 주기 저장이 거부됨
    await advance(2000); // 그래도 틱은 계속
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(7);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 7 });
  });

  test('라이브 레코드 삭제가 실패해도 종료는 계속된다 — 업로드·적립·결과 화면 이동', async () => {
    // 정산의 removeItem은 fire-and-forget(.catch 삼킴)이 현행이다 — 헤드리스화가 삭제를
    // await하고 실패를 전파하면 저장소 오류 기기에서 종료가 통째로 막힌다(codex 리뷰 6차).
    // 종료 경로의 삭제는 finish 선삭제 + settleFocusBlock 내부 재삭제 두 번이다 — 둘 다
    // 거부시켜야 두 번째 호출의 .catch 제거 회귀도 잡는다(codex 리뷰 20차).
    await renderSession({ mode: 'countup' });
    await advance(5000);
    (AsyncStorage.removeItem as unknown as jest.Mock)
      .mockRejectedValueOnce(new Error('disk')) // finish의 선삭제
      .mockRejectedValueOnce(new Error('disk')); // 정산 내부의 재삭제
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(5);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: true });
  });

  test('업로드가 pending이어도 결과 화면 이동·로컬 적립은 기다리지 않는다 — saved 후처리만 응답 후', async () => {
    // 종료 UX는 업로드와 분리된 fire-and-forget이 현행이다 — 헤드리스화가 uploadFocusBlock을
    // await하면 네트워크가 오래 pending인 기기에서 정지 버튼 후 화면에 무기한 갇힌다
    // (codex 리뷰 20차).
    let resolveUpload!: (v: { status: string; response?: object }) => void;
    mockedUpload.mockImplementationOnce(
      () =>
        new Promise<{ status: string; response?: object }>((r) => {
          resolveUpload = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 업로드 미해결 상태에서 이미 이동·적립 완료
    expect(mockNavigation.replace).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(3);
    expect(mockCoinRefresh).not.toHaveBeenCalled(); // saved 후처리는 응답 후에만

    await act(async () => {
      resolveUpload({ status: 'saved', response: {} });
    });
    expect(mockCoinRefresh).toHaveBeenCalledTimes(1); // 늦은 응답에도 후처리는 이어진다
  });

  test('업로드가 failed(대기열 저장까지 실패)여도 현행은 레코드를 이미 지웠다 — 알려진 유실 공백', async () => {
    // ⚠️ uploadFocusBlock의 failed 계약은 「호출부가 레코드를 보존해 다음 실행에 재시도」인데,
    // 화면 경로는 정산이 업로드 결과 전에 레코드를 지우고 finishedRef가 재저장을 막는다 —
    // 로컬 적립만 남고 서버·대기열·레코드 어디에도 바디가 없는 유실이 현행이다(codex 리뷰
    // 11차). 특성화는 이 현행을 그대로 고정한다 — 수리는 헤드리스화(1600)의 정산 저널 몫.
    mockedUpload.mockResolvedValueOnce({ status: 'failed' });
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    expect(mockAddFocusSeconds).toHaveBeenCalledWith(5); // 로컬 적립은 반영
    expect(await readLiveRecord()).toBeNull(); // 그러나 재시도 근거(레코드)는 이미 삭제됨
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 }); // 종료 UX는 진행
    expect(mockCoinRefresh).not.toHaveBeenCalled(); // saved 전용 후처리는 없음
  });

  test('저장 응답이 오늘 판정이 아니면(publishSessionSaveVerdict) 발행하지 않는다', async () => {
    // isTodayVerdict 게이트의 화면 배선 — 전날 귀속 응답을 발행하면 전날 누적이 오늘 판정으로
    // 저장되고 단조증가 가드가 진짜 오늘 판정까지 막는다(codex 리뷰 11차).
    (isTodayVerdict as jest.Mock).mockReturnValueOnce(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    expect(mockCoinRefresh).toHaveBeenCalledTimes(1); // 코인 재조회는 판정 게이트와 무관
    expect(publishSessionSaveVerdict).not.toHaveBeenCalled();
  });

  test('업로드가 마커를 못 닫으면(onMarkerStillOpen) 화면이 cancelMarker로 닫는다', async () => {
    // PATCH가 클램프 창 밖이거나 재시도 가능 오류로 실패하면 uploadFocusBlock이 열린 마커 id를
    // 이 콜백으로 넘기고, 화면 쪽 배선이 cancelMarker를 불러야 친구 화면의 '집중 중'이 서버
    // 스윕(12h)까지 남지 않는다 — 헤드리스화가 이 콜백 전달을 빠뜨리면 잡을 수 없던 구멍
    // (codex 리뷰 PR #676 3차).
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    const { onMarkerStillOpen } = mockedUpload.mock.calls[0][0];
    await act(async () => {
      onMarkerStillOpen('marker-1');
    });
    expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1');
  });

  test('마커 시작 응답이 종료보다 늦으면: 보류 프라미스를 정산에 넘겨 늦은 id로 PATCH를 태운다', async () => {
    // 시작 요청이 느린 사이 정지하면 화면은 '현재 id'(아직 null)가 아니라 보류 중인
    // liveStartPromiseRef를 정산에 넘긴다 — 늦게 발급된 마커도 PATCH로 닫혀 시간·코인이
    // 귀속된다. 헤드리스 구현이 현재 id만 읽으면 POST 폴백 후 늦은 마커가 열린 채 남는다
    // (codex 리뷰 5차).
    let resolveMarker!: (v: { sessionId: string }) => void;
    mockedStartMarker.mockImplementationOnce(
      () =>
        new Promise<{ sessionId: string }>((r) => {
          resolveMarker = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).not.toHaveBeenCalled(); // 응답 대기 — 업로드는 id 확정까지 미룬다
    // 종료 UX는 마커 응답을 기다리지 않는다 — 응답이 영영 안 와도 사용자는 화면을 빠져나간다
    // (codex 리뷰 11차: 업로드만 보류, 적립·이동은 즉시)
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(3);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3 });

    await act(async () => {
      resolveMarker({ sessionId: 'marker-late' });
    });
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].sessionId).toBe('marker-late'); // 늦은 id로 PATCH
    expect(cancelMarker).not.toHaveBeenCalled(); // 버리는 게 아니라 종료로 닫는다
  });

  test('마커 시작 실패(Axios 무응답): reason=network로 분류해 계측한다', async () => {
    // 원인 분류가 전부 unknown으로 뭉개지면 마커 실패 지표에서 연결 장애와 서버 장애를 구분할
    // 수 없다 — 응답 없는 Axios 오류는 network다(codex 리뷰 15차).
    mockedStartMarker.mockRejectedValueOnce(new AxiosError('Network Error'));
    await renderSession({ mode: 'countup' });
    expect(logFocusMarkerStartFailed).toHaveBeenCalledWith({ reason: 'network' });
  });

  test('마커 시작 실패(HTTP 응답): reason=http_상태코드로 분류해 계측한다', async () => {
    // 상태 코드가 있는 Axios 오류는 http_<status> — 5xx 급증 같은 서버측 장애 신호가
    // 그대로 지표에 남아야 한다(codex 리뷰 15차).
    mockedStartMarker.mockRejectedValueOnce(
      new AxiosError('Service Unavailable', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 503,
      } as AxiosResponse),
    );
    await renderSession({ mode: 'countup' });
    expect(logFocusMarkerStartFailed).toHaveBeenCalledWith({ reason: 'http_503' });
  });

  test('마커 시작 실패 — 계측만 남기고 세션은 진행, 종료 업로드는 POST 폴백(sessionId null)', async () => {
    mockedStartMarker.mockRejectedValueOnce(new Error('offline'));
    await renderSession({ mode: 'countup' });
    expect(logFocusMarkerStartFailed).toHaveBeenCalledWith({ reason: 'unknown' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].sessionId).toBeNull();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3 });
  });

  test('네이티브 정리(실드·LA 종료)가 거부돼도 finish는 정산·결과 화면으로 진행된다', async () => {
    // finish의 stopFocusShield/endFocusActivity는 fire-and-forget(.catch 삼킴)이 현행이다 —
    // 헤드리스화가 이를 await·전파로 바꾸면 브리지 오류 기기에서 finishedRef만 선 채
    // replace가 안 돌아 종료가 통째로 막히고 재시도도 불가하다(codex 리뷰 19차).
    (ScreenTimeModule.stopFocusShield as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
    (ScreenTimeModule.endFocusActivity as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: true });
  });

  test('세로 페이지 스와이프: 직전 페이지의 체류가 정확한 이름·시간으로 발행된다', async () => {
    // onMomentumScrollEnd → flushViewDwell + viewForPage 매핑의 배선 — 빠지면 GROMO-987
    // 실험 지표가 전부 character로 귀속되거나 누락된다(codex 리뷰 22차).
    await renderSession({ mode: 'countup' });
    const pagerWidth = Dimensions.get('window').width;
    const pager = view.container.queryAll(
      (n) => n.props?.horizontal === true && n.props?.pagingEnabled === true,
    )[0];
    await advance(3000); // 캐릭터 페이지 3초
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth } } });
    });
    expect(logFocusViewChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: 'character', dwell_seconds: 3 }),
    );
    // 캐릭터 페이지를 떠나면 호흡 애니메이션도 멈춘다 — 페이저는 캐릭터 페이지를 계속 마운트
    // 하므로 page === 0 조건이 빠지면 다른 페이지를 보는 내내 숨은 호흡이 돈다(codex 리뷰 23차).
    expect(mockCharActiveCaptures.at(-1)).toBe(false);
    await advance(4000); // 친구 페이지 4초
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth * 2 } } });
    });
    expect(logFocusViewChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: 'friends', dwell_seconds: 4 }),
    );
    await advance(2000);
    await act(async () => {
      // 같은 페이지로 끝난 스크롤 — 미계측이 계약이다
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth * 2 } } });
    });
    expect(logFocusViewChanged).toHaveBeenCalledTimes(2);
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } });
    });
    // 그룹 0개 fixture — 2페이지는 viewForPage 매핑상 my_league다
    expect(logFocusViewChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: 'my_league', dwell_seconds: 2 }),
    );
    expect(mockCharActiveCaptures.at(-1)).toBe(true); // 캐릭터 페이지 복귀 — 호흡 재개
  });

  test('체류 중 그룹 수가 바뀌어도: 직전 체류는 진입 시점의 뷰 이름으로 발행된다', async () => {
    // activeViewRef는 진입 시점에 고정된다 — flush 시점의 최신 그룹 수로 재계산하면 리그
    // 페이지를 보는 사이 그룹 로드가 끝났을 때 그 체류가 groups로 오귀속된다(codex 리뷰 31차).
    await renderSession({ mode: 'countup' });
    const pagerWidth = Dimensions.get('window').width;
    const pager = view.container.queryAll(
      (n) => n.props?.horizontal === true && n.props?.pagingEnabled === true,
    )[0];
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth * 2 } } });
    });
    // 그룹 0개 시점의 2페이지 = my_league 진입. 보고 있는 사이 그룹 로드가 완료된다.
    mockSessionGroups = [
      { groupId: 'g1', groupName: '알파', members: [] },
      { groupId: 'g2', groupName: '베타', members: [] },
    ];
    await fireEvent.press(view.getByTestId('focus.pause'));
    await fireEvent.press(view.getByTestId('focus.pause')); // 리렌더 — 이제 2페이지는 groups
    await advance(4000);
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 0 } } });
    });
    expect(logFocusViewChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: 'my_league', dwell_seconds: 4 }), // 진입 시점 이름 유지
    );
  });

  test('메뉴 버튼: 계측 1회와 드로어 열림이 함께 배선돼 있다', async () => {
    // onPress에서 logFocusMenuOpened·setDrawerOpen 어느 쪽이 빠져도 스위트가 몰랐다 —
    // 메뉴 접근 불능·실험 지표 누락 회귀 방어(codex 리뷰 22차).
    await renderSession({ mode: 'countup' });
    expect(mockDrawerCaptures.at(-1)!.open).toBe(false);
    await fireEvent.press(view.getByLabelText('집중 메뉴 열기'));
    expect(logFocusMenuOpened).toHaveBeenCalledTimes(1);
    expect(mockDrawerCaptures.at(-1)!.open).toBe(true);
    // 닫기 배선 — onClose가 빠지거나 오배선되면 메뉴를 연 사용자가 집중 화면으로 못 돌아온다
    // (codex 리뷰 26차).
    await act(async () => {
      mockDrawerCaptures.at(-1)!.onClose();
    });
    expect(mockDrawerCaptures.at(-1)!.open).toBe(false);
  });

  test('친구 그리드: members·pinnedIds가 전달되고 visible은 친구 페이지에서만 켜진다', async () => {
    // 항상 빈 fixture로는 sessionFriends·핀 집합·visible 배선 제거를 못 잡는다 — 친구가 있는
    // 사용자의 그리드 공백, 핀 정렬·숨은 페이지 시계 정지 회귀 방어(codex 리뷰 24차).
    mockFriends = [
      { userId: 'f1', nickname: '친구1', isFocusing: true },
      { userId: 'f2', nickname: '친구2', isFocusing: false },
    ];
    mockPinnedIds = new Set(['f2']);
    await renderSession({ mode: 'countup' });
    // ⚠️ toMatchObject는 기대값이 Set일 때 received undefined와도 통과한다(jest 함정 — 돌연변이
    // 검증에서 발각). 통과 경로가 아니라 참조 동일성(toBe)으로 단언한다.
    const friendsProps = lastGridProps('내 친구')!;
    expect(friendsProps.members).toBe(mockFriends);
    expect(friendsProps.pinnedIds).toBe(mockPinnedIds);
    expect(friendsProps.visible).toBe(false); // 캐릭터 페이지에선 꺼져 있다(숨은 그리드 시계 정지)
    // 내 셀의 정체성 배선 — 닉네임·집중 과목이 그리드 셀에 그대로 표시된다(codex 리뷰 29차)
    expect(mockGridMeCaptures.at(-1)).toMatchObject({ nickname: 'nick', tagName: '수학' });
    const pagerWidth = Dimensions.get('window').width;
    const pager = view.container.queryAll(
      (n) => n.props?.horizontal === true && n.props?.pagingEnabled === true,
    )[0];
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth } } });
    });
    expect(lastGridProps('내 친구')).toMatchObject({ visible: true }); // 친구 페이지 진입
  });

  test('닉네임이 비어 있으면: 내 그리드 셀 이름은 「나」로 폴백한다', async () => {
    // 목이 항상 'nick'을 주면 `nickname || '나'` 폴백을 제거해도 통과한다 — 닉네임 없는
    // 사용자의 셀이 이름 없이 그려지는 회귀 방어(codex 리뷰 34차).
    mockNickname = '';
    await renderSession({ mode: 'countup' });
    expect(mockGridMeCaptures.at(-1)).toMatchObject({ nickname: '나' });
  });

  test('그룹 FAB 진입(initialGroupId): 해당 그룹 페이지로 초기 스크롤·해당 그리드만 활성화된다', async () => {
    // 빈 groups fixture로는 검색·scrollTo·페이지 상태 배선 제거를 못 잡는다(codex 리뷰 24차).
    // 실제 useSessionGroups는 빈 배열로 시작해 비동기 조회 후 갱신된다 — 렌더 전 fixture를
    // 완성하면 「빈 첫 렌더 → 로드 후 재실행」 경로가 검증에서 빠진다(codex 리뷰 28차).
    await renderSession({ mode: 'countup', initialGroupId: 'g2' }); // 그룹 로드 전
    expect(mockCharActiveCaptures.at(-1)).toBe(true); // 아직 캐릭터 페이지
    const alphaMembers = [{ userId: 'a1', nickname: '알파멤버' }];
    const betaMembers = [{ userId: 'b1', nickname: '베타멤버' }];
    mockSessionGroups = [
      { groupId: 'g1', groupName: '알파', members: alphaMembers },
      { groupId: 'g2', groupName: '베타', members: betaMembers },
    ];
    // 그룹 로드 완료를 재현 — 리렌더로 훅이 새 목록을 돌려주고 초기 스크롤 이펙트가 재실행된다
    await fireEvent.press(view.getByTestId('focus.pause'));
    await fireEvent.press(view.getByTestId('focus.pause'));
    await flush();
    // 두 번째 그룹 = 페이지 3 (캐릭터0·친구1·그룹×N)
    expect(lastGridProps('그룹: 베타')).toMatchObject({ visible: true });
    expect(lastGridProps('그룹: 알파')).toMatchObject({ visible: false });
    expect(lastGridProps('내 친구')).toMatchObject({ visible: false });
    expect(mockCharActiveCaptures.at(-1)).toBe(false); // 캐릭터 페이지를 떠났다 — 호흡 정지
    // 1인 그룹에서도 내 셀은 보인다 — showMeWhenEmpty가 빠지면 멤버 0명 그룹 페이지가
    // 빈 상태로 렌더돼 자신의 집중 시간·과목이 안 보인다(codex 리뷰 28차).
    expect(lastGridProps('그룹: 베타')!.showMeWhenEmpty).toBe(true);
    // 그룹별 멤버 목록이 각자의 그리드에 배선된다 — 재사용·뒤바뀜이면 다른 그룹 사용자가
    // 표시된다(codex 리뷰 30차). 참조 동일성으로 단언.
    expect(lastGridProps('그룹: 알파')!.members).toBe(alphaMembers);
    expect(lastGridProps('그룹: 베타')!.members).toBe(betaMembers);
  });

  test('가로 상태에서 그룹이 로드되면: 초기 스크롤을 보류했다가 세로 복귀 후 재시도한다', async () => {
    // 가로에선 세로 페이저가 언마운트돼 pagerRef가 null이다 — 이때 완료 플래그를 세우면
    // 세로 복귀 후에도 대상 그룹으로 못 가고 캐릭터 페이지에 남는다(codex 리뷰 33차).
    await renderSession({ mode: 'countup', initialGroupId: 'g2' });
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      mockSessionGroups = [
        { groupId: 'g1', groupName: '알파', members: [] },
        { groupId: 'g2', groupName: '베타', members: [] },
      ];
      await advance(1000); // 가로에서 그룹 로드 완료 — 스크롤은 보류돼야 한다
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
    await flush(); // 세로 복귀 — 이펙트 재실행으로 재시도
    expect(lastGridProps('그룹: 베타')).toMatchObject({ visible: true });
  });

  test('페이지 도트: 그룹 수에 맞춰 늘고, 활성 도트가 현재 페이지를 가리킨다', async () => {
    // 도트가 4개 고정이거나 활성 연결이 끊기면 그룹 사용자가 위치·남은 페이지를 잘못
    // 인식한다(codex 리뷰 33차). 도트 줄 = collapsable:false 컨테이너 중 자식 수가
    // 4 + 그룹 수인 유일한 줄로 식별한다.
    await renderSession({ mode: 'countup', initialGroupId: 'g2' });
    const dotRowOf = (count: number) =>
      view.container
        .queryAll((n) => n.props?.collapsable === false)
        .find((n) => n.children.length === count);
    expect(dotRowOf(4)).toBeTruthy(); // 그룹 로드 전 — 기본 4페이지
    mockSessionGroups = [
      { groupId: 'g1', groupName: '알파', members: [] },
      { groupId: 'g2', groupName: '베타', members: [] },
    ];
    await fireEvent.press(view.getByTestId('focus.pause'));
    await fireEvent.press(view.getByTestId('focus.pause'));
    await flush(); // 로드 + FAB 초기 스크롤(베타 = 페이지 3)
    const row = dotRowOf(6)!; // 4 + 그룹 2
    expect(row).toBeTruthy();
    const sigs = row.children.map((c) => JSON.stringify((c as { props: unknown }).props));
    const uniq = new Set(sigs);
    expect(uniq.size).toBe(2); // 활성 1 + 비활성 5
    const majority = sigs.filter((s2) => s2 === sigs[0]).length >= 3 ? sigs[0] : sigs[1];
    expect(sigs.findIndex((s2) => s2 !== majority)).toBe(3); // 활성 도트 = 현재 페이지(베타)
  });

  test('커스텀 캐릭터 장착 시: 캡처 대상 study 캐릭터에 activeSource가 배선된다', async () => {
    // activeSource가 항상 null인 fixture로는 sourceUri 배선 제거를 못 잡는다 — 커스텀 캐릭터
    // 사용자가 화면·잠금화면 스냅샷에서 기본 캐릭터를 보게 되는 회귀 방어(codex 리뷰 24차).
    mockActiveSource = 'file:///custom-character.png';
    await renderSession({ mode: 'countup' });
    const studyCapture = mockCharImageCaptures.filter((c) => c.variant === 'study').at(-1);
    expect(studyCapture).toMatchObject({ sourceUri: 'file:///custom-character.png' });
  });

  test('그룹 조회에도 나 제외 인자가 전달된다 — me 중복·서버 기준 추출의 전제', async () => {
    // useSessionGroups의 excludeUserId는 그룹 그리드의 본인 행 제거와 myFocus 서버 기준 추출을
    // 겸한다 — 빠지면 me 중복 표시 + 내 셀이 로컬 폴백으로 강등된다(codex 리뷰 25차).
    await renderSession({ mode: 'countup' });
    expect(mockGroupArgs).toContainEqual({ excludeUserId: 'user-1' });
  });

  test('서버 스냅샷이 없으면: 세션 전 오늘 누적(todayFocusSeconds)이 로컬 폴백에 보존된다', async () => {
    // gridPreSessionRef 기준값이 빠지면 그룹 미가입·조회 실패 사용자의 내 셀이 기존 오늘
    // 누적(예: 30분)을 잃고 이번 세션 경과만 표시한다(codex 리뷰 25차).
    mockTodayFocusSeconds = 1800; // 세션 전 오늘 30분
    await renderSession({ mode: 'countup' }); // myFocus 없음 — 로컬 폴백 경로
    await advance(5000);
    expect(mockGridMeCaptures.at(-1)!.totalSeconds).toBe(1805); // 1800 + 이번 세션 5초
  });

  test('정산 후 오늘 누적 컨텍스트가 갱신돼도: 내 셀 로컬 폴백은 정산 블록을 이중 합산하지 않는다', async () => {
    // 실제 FocusContext.addFocusSeconds는 정산 즉시 todayFocusSeconds를 올려 리렌더한다 —
    // 로컬 폴백이 마운트 시점 기준(gridPreSessionRef) 대신 살아있는 오늘 누적을 읽으면
    // 방금 정산한 블록이 settledToday와 두 번 합산된다(codex 리뷰 33차).
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(60_000); // 블록 1 정산
    mockTodayFocusSeconds = 60; // 컨텍스트 갱신 재현
    await advance(1000); // 휴식 틱 리렌더
    expect(mockGridMeCaptures.at(-1)!.totalSeconds).toBe(60); // 이중 합산이면 120
  });

  test('드로어의 오늘 집중: 미정산 델타만 전달된다 — 정산 블록은 빠진다', async () => {
    // liveSeconds에 전체 elapsed가 실리면 정산 후 과목 누적과 같은 60초가 이중 표기된다
    // (codex 리뷰 25차). liveSubjectId 배선도 함께 고정한다.
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(5000);
    expect(mockDrawerCaptures.at(-1)).toMatchObject({ liveSubjectId: 's1', liveSeconds: 5 });
    await advance(55_000); // 블록 1 정산 → 휴식
    await advance(1000); // 휴식 틱 리렌더
    expect(mockDrawerCaptures.at(-1)!.liveSeconds).toBe(0); // 정산분은 빠진 미정산 델타만
  });

  test('리그 그리드 훅: 전체 리그는 나 제외, 같은 시험은 occupation 필터·enabled 게이트', async () => {
    // 인자를 버리는 목으로는 excludeUserId 누락·시험 필터 오배선을 못 잡는다 — 본인 행 중복,
    // 다른 시험 준비생 혼입 회귀 방어(codex 리뷰 22차).
    mockFocusOccupation = 'CSAT';
    mockLeagueMembers = [{ userId: 'L1', nickname: '리그유저' }];
    mockExamMembers = [{ userId: 'E1', nickname: '시험유저' }];
    await renderSession({ mode: 'countup' });
    expect(mockLeagueArgs).toContainEqual({ excludeUserId: 'user-1' });
    expect(mockLeagueArgs).toContainEqual({
      occupation: 'CSAT',
      enabled: true,
      excludeUserId: 'user-1',
    });
    // 두 목록이 각자의 그리드에 배선된다 — 뒤바뀌면 같은 시험 페이지에 전체 리그 유저가 섞인다
    // (codex 리뷰 26차). 참조 동일성으로 단언한다(Set/undefined 함정 회피와 동일 원칙).
    expect(lastGridProps('수능·N수 리그')!.members).toBe(mockExamMembers);
    expect(lastGridProps('전체 리그')!.members).toBe(mockLeagueMembers);
    // visible 전환 — 활성 조건이 뒤바뀌거나 항상 false면 보고 있는 리그 페이지의 초 시계가
    // 멈춘다(codex 리뷰 32차). 그룹 0개 — 2페이지=시험, 3페이지=전체.
    const pagerWidth = Dimensions.get('window').width;
    const pager = view.container.queryAll(
      (n) => n.props?.horizontal === true && n.props?.pagingEnabled === true,
    )[0];
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth * 2 } } });
    });
    expect(lastGridProps('수능·N수 리그')!.visible).toBe(true);
    expect(lastGridProps('전체 리그')!.visible).toBe(false);
    await act(async () => {
      pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: pagerWidth * 3 } } });
    });
    expect(lastGridProps('전체 리그')!.visible).toBe(true);
    expect(lastGridProps('수능·N수 리그')!.visible).toBe(false);
  });

  test('시험이 세션 도중 설정되면: 리그 조회가 enabled: true로 승격되고 제목도 갱신된다', async () => {
    // 프로필이 늦게 도착하거나 다른 화면에서 시험을 바꾸면 세션 중에도 값이 바뀐다 — 렌더 전
    // fixture만 쓰면 「첫 렌더 고정」 회귀(세션 내내 enabled: false)를 못 잡는다(codex 리뷰 32차).
    await renderSession({ mode: 'countup' }); // 시험 미설정 상태로 마운트
    expect(mockLeagueArgs).toContainEqual({
      occupation: undefined,
      enabled: false,
      excludeUserId: 'user-1',
    });
    mockFocusOccupation = 'CSAT'; // 프로필 도착·시험 변경 재현
    await fireEvent.press(view.getByTestId('focus.pause'));
    await fireEvent.press(view.getByTestId('focus.pause')); // 리렌더
    expect(mockLeagueArgs).toContainEqual({
      occupation: 'CSAT',
      enabled: true,
      excludeUserId: 'user-1',
    });
    expect(lastGridProps('수능·N수 리그')).toBeTruthy(); // 리그 제목도 갱신
  });

  test('마운트의 취소 대기열 재시도가 거부돼도: 새 마커·정산·결과 이동은 계속된다', async () => {
    // flushPendingMarkerCancels는 AsyncStorage 실패로 실제 거부될 수 있다 — 호출부 .catch가
    // 빠지면 대기열 오류가 세션 시작·종료 흐름까지 중단시킨다(codex 리뷰 32차).
    (flushPendingMarkerCancels as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    await renderSession({ mode: 'countup' });
    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 새 마커 등록은 그대로
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: true });
  });

  test('준비 시험 미설정: 같은 시험 조회는 enabled: false로 비활성화된다', async () => {
    // enabled가 빠지면 훅 기본값 true로 getMyRanking(undefined)를 호출해, 시험 미설정 사용자의
    // 같은 시험 페이지가 전체 리그 데이터를 불러오고 60초 폴링까지 돈다(codex 리뷰 30차).
    await renderSession({ mode: 'countup' }); // 카테고리 기본 null
    expect(mockLeagueArgs).toContainEqual({
      occupation: undefined,
      enabled: false,
      excludeUserId: 'user-1',
    });
  });

  test('첫 집중 안내: 화면 고유 저장 키와 4단계가 배선된다', async () => {
    // 안내 배선이 빠지면 첫 사용자가 페이저·메뉴·일시정지·정지 안내를 못 받고, 키가 다르면
    // 매 세션 안내가 반복된다(codex 리뷰 28차).
    await renderSession({ mode: 'countup' });
    const guide = mockGuideCaptures.at(-1)!;
    expect(guide.storageKey).toBe(STORAGE_KEYS.guideFocusSession);
    expect(guide.steps).toHaveLength(4);
    // 단계별 앵커 배선 — 앵커가 빠지거나 뒤바뀌면 첫 사용자에게 엉뚱한 요소가 강조된다
    // (codex 리뷰 30차). 1단계=전체 화면(무앵커), 2=페이저 점, 3=메뉴(round), 4=컨트롤(radius).
    const steps = guide.steps as Array<{
      anchor?: { current: unknown };
      round?: boolean;
      radius?: number;
    }>;
    expect(steps[0].anchor).toBeUndefined();
    expect(steps[1].anchor).toBeTruthy();
    expect(steps[2].anchor).toBeTruthy();
    expect(steps[2].round).toBe(true);
    expect(steps[3].anchor).toBeTruthy();
    expect(steps[3].radius).toBe(36);
    // ref 객체 존재만으로는 부족하다 — 실제 호스트에 연결돼 있어야 강조 위치를 잴 수 있다
    // (codex 리뷰 31차). 메뉴 버튼(PressableScale)의 ref 전달이 빠지면 current가 비어 있다.
    expect(steps[1].anchor!.current).toBeTruthy(); // 페이저 점
    expect(steps[2].anchor!.current).toBeTruthy(); // 메뉴 버튼
    expect(steps[3].anchor!.current).toBeTruthy(); // 컨트롤
  });

  test('Live Activity 시작이 거부돼도: 타이머·정산·결과 이동은 계속된다', async () => {
    // startFocusActivity는 fire-and-forget(.catch 삼킴)이 현행이다 — 전파로 바뀌면 LA 브리지가
    // 고장난 기기에서 미처리 거부 또는 세션 중단이 생긴다(codex 리뷰 28차).
    (ScreenTimeModule.startFocusActivity as jest.Mock).mockRejectedValueOnce(
      new Error('activity bridge'),
    );
    await renderSession({ mode: 'countup' });
    await advance(3000); // 600ms 발화 → 시작 거부 — 그래도 틱은 계속
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: true });
  });

  test('실드는 선택한 과목명으로 걸린다 — 차단 화면 문구의 원천', async () => {
    // startFocusShield의 인자는 네이티브가 차단 화면 문구로 저장·표시한다(ScreenTimeModule.swift
    // :594-610) — subjectId나 이전 세션의 과목명이 넘어가면 다른 과목으로 집중하는 사용자가
    // 잘못된 문구를 본다(codex 리뷰 16차).
    await renderSession({ mode: 'countup', subjectName: '영어' });
    expect(mockedShieldStart).toHaveBeenCalledWith('영어');
  });

  test('Live Activity 페이로드: 다른 과목을 누적시간 내림차순 상위 2개만 싣는다', async () => {
    // 선택 과목 제외 필터 + 내림차순 정렬 + 상위 2개 슬라이스의 배선 — 과목이 하나뿐인 기본
    // fixture로는 항상 []라 이 로직이 통째로 빠져도 통과한다. 잠금화면 위젯이 표시하는 다른
    // 과목 기록(WidgetLiveActivity.swift:174-176)의 원천이다(codex 리뷰 17차).
    mockSubjectsData = [
      { id: 's1', name: '수학', accumulatedSeconds: 900, color: '#FFB4A2' }, // 선택 — 최댓값이어도 제외
      { id: 's2', name: '영어', accumulatedSeconds: 300, color: '#A2C4FF' },
      { id: 's3', name: '과학', accumulatedSeconds: 500, color: '#B2E2B2' },
      { id: 's4', name: '국어', accumulatedSeconds: 100, color: '#EEDD88' },
    ];
    await renderSession({ mode: 'countup' });
    await advance(1000); // 600ms 캡처 지연 경과
    await flush();
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith(
      '수학',
      [
        { name: '과학', seconds: 500, color: '#B2E2B2' },
        { name: '영어', seconds: 300, color: '#A2C4FF' },
      ],
      laState(),
    );
  });

  test('600ms 지연 사이 과목 목록이 갱신되면: Live Activity는 최신 목록의 상위 2개를 싣는다', async () => {
    // LA 시작 이펙트는 최초 렌더 클로저가 아니라 subjectsRef의 최신 값을 읽는다 — 클로저 캡처로
    // 바뀌면 저장소·서버 복원이 캡처 지연 사이 도착한 사용자에게 세션 내내 시드/낡은 과목
    // 시간이 표시된다(codex 리뷰 27차).
    await renderSession({ mode: 'countup' }); // 시드 목록('수학'만)으로 마운트 — 타이머는 아직
    mockSubjectsData = [
      { id: 's1', name: '수학', accumulatedSeconds: 0, color: '#FFB4A2' },
      { id: 's5', name: '한국사', accumulatedSeconds: 700, color: '#CCAAFF' },
      { id: 's6', name: '물리', accumulatedSeconds: 200, color: '#AAFFCC' },
    ];
    // 600ms 발화 전에 리렌더를 일으켜 subjectsRef를 갱신한다(정지→재개는 세션에 영향 없음)
    await fireEvent.press(view.getByTestId('focus.pause'));
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(1000); // 600ms 콜백 발화
    await flush();
    expect(ScreenTimeModule.startFocusActivity).toHaveBeenCalledWith(
      '수학',
      [
        { name: '한국사', seconds: 700, color: '#CCAAFF' },
        { name: '물리', seconds: 200, color: '#AAFFCC' },
      ],
      // 정지·재개가 각각 상태 동기화를 밀어 넣어 revision이 두 번 더 올랐다(마운트 1 + 정지 2 + 재개 3)
      laState({ revision: 4 }),
    );
  });

  test('LA 상태 동기화(1597): 마운트·정지·재개·페이즈 전환마다 밀고, 틱마다는 밀지 않는다', async () => {
    // 목에 updateFocusActivity가 없으면 옵셔널 호출·인자 평가가 통째로 생략돼 이 배선이
    // 제거되거나 페이로드가 틀려도 스위트가 통과한다(codex 리뷰 35차).
    const update = ScreenTimeModule.updateFocusActivity as jest.Mock;
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    // 마운트 — 초기 상태 전체를 정확 고정(첫 revision은 1)
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      mode: 'pomodoro',
      phase: 'focus',
      isPaused: false,
      elapsedSeconds: 0,
      remainingSeconds: 60,
      revision: 1,
    });
    // 틱은 밀지 않는다 — 그 사이는 위젯의 Text(timerInterval:)가 자체 갱신하는 계약
    await advance(3000);
    expect(update).toHaveBeenCalledTimes(1);
    // 정지 → isPaused true, 재개 → false. revision은 update·start가 한 카운터를 공유하는
    // 단조 증가 — 600ms 뒤 LA 시작이 2를 소비했으므로 정지는 3부터다.
    // 시간도 현재 진행값이어야 한다 — 초기값(60/0)을 계속 보내면 네이티브가 frozenSeconds로
    // 그대로 얼려 정지 화면이 00:57 대신 01:00에 멈춰 보인다(codex 리뷰 37차).
    await fireEvent.press(view.getByTestId('focus.pause'));
    expect(update.mock.calls.at(-1)![0]).toMatchObject({
      isPaused: true,
      revision: 3,
      remainingSeconds: 57,
      elapsedSeconds: 3,
    });
    await fireEvent.press(view.getByTestId('focus.pause'));
    expect(update.mock.calls.at(-1)![0]).toMatchObject({
      isPaused: false,
      revision: 4,
      remainingSeconds: 57,
      elapsedSeconds: 3,
    });
    // 집중 페이즈 완주 → 휴식 전환이 밀려 들어온다(휴식 잔여 60초)
    await advance(57_000);
    expect(update.mock.calls.at(-1)![0]).toMatchObject({
      phase: 'break',
      remainingSeconds: 60,
    });
  });

  test('LA 상태 동기화 거부(브리지 오류)에도: 타이머·정산·결과 이동은 계속된다', async () => {
    // 성공 목만으론 동기화 호출의 .catch 제거를 못 잡는다 — 브리지가 거부하면 미처리 거부가
    // 남는 회귀 방어(codex 리뷰 36차). 마운트 동기화가 거부를 소비한다.
    (ScreenTimeModule.updateFocusActivity as jest.Mock).mockRejectedValueOnce(
      new Error('bridge dead'),
    );
    await renderSession({ mode: 'countup' });
    await advance(3000);
    expect(view.getByText('00:00:03')).toBeTruthy(); // 타이머는 계속 돈다
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockNavigation.replace).toHaveBeenCalledWith(
      'FocusResult',
      expect.objectContaining({ completed: true, focusSeconds: 3 }),
    );
  });

  test('마커 취소 거부(대기열 쓰기 실패 등)에도: finish는 결과 이동을 계속하고 미처리 거부가 없다', async () => {
    // ⚠️ 경과가 있으면 정산이 마커를 먼저 소비해 finish의 cancelLiveSession이 cancelMarker를
    // 아예 안 부른다 — 거부 주입이 소비되지 않은 채 통과하는 무효 테스트가 된다(codex 리뷰
    // 36차에서 발각·정정). 취소가 실제로 도는 유일한 finish 조건인 경과 0초에서 거부를 태운다.
    (cancelMarker as jest.Mock).mockRejectedValueOnce(new Error('cancel queue write failed'));
    await renderSession({ mode: 'countup' });
    await fireEvent.press(view.getByTestId('focus.stop')); // 경과 0 — 델타 없음 → 취소 경로
    await flush();
    expect(cancelMarker).toHaveBeenCalledTimes(1); // 거부가 실제로 소비됐다
    expect(mockNavigation.replace).toHaveBeenCalledWith(
      'FocusResult',
      expect.objectContaining({ completed: true, focusSeconds: 0 }),
    );
  });

  test('마커 취소 거부 + finish 없는 언마운트: abandoned 계측은 계속되고 미처리 거부가 없다', async () => {
    // 언마운트 cleanup의 cancelLiveSession도 같은 체인을 탄다 — 여기서 새는 거부는 화면이
    // 이미 사라진 뒤라 사용자에게 보이지 않은 채 크래시 로그만 남긴다(codex 리뷰 35차).
    // 체인 끝의 .catch를 제거하면 이 거부가 unmount로 전파돼 이 테스트만 실패한다(돌연변이 확인).
    (cancelMarker as jest.Mock).mockRejectedValueOnce(new Error('cancel failed'));
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await view.unmount();
    await flush();
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ elapsed_seconds: 3 }),
    );
  });
});

describe('일시정지 의미론', () => {
  test('정지 중 경과는 멈추고, 정지 구간은 방해초로 업로드 바디에 실린다', async () => {
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    expect(logFocusSessionPaused).toHaveBeenCalledWith({ elapsed_seconds: 3 });
    // 정지 중 내 그리드 셀은 비집중 — !paused 조건이 빠지면 정지한 사용자가 친구 그리드에
    // 계속 초록(집중 중)으로 보인다(codex 리뷰 22차).
    expect(mockGridMeCaptures.at(-1)!.isFocusing).toBe(false);
    await advance(10_000); // 정지 10초 — 경과는 3초에 머문다
    await fireEvent.press(view.getByTestId('focus.pause'));
    expect(logFocusSessionResumed).toHaveBeenCalledTimes(1);
    expect(mockGridMeCaptures.at(-1)!.isFocusing).toBe(true); // 재개 즉시 복귀
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    const { body } = mockedUpload.mock.calls[0][0];
    expect(body.totalDistractionSeconds).toBe(10);
    expect(body.distractionCount).toBe(1);
    // 블록 구간은 벽시계 15초, 집중 델타는 5초 — 서버가 방해초로 차감한다
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(15_000);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 });
  });

  test('정지 상태에서 곧바로 종료: 열린 정지 구간도 종료 시각까지 방해초로 실린다', async () => {
    // 재개 없이 정지 버튼 → 아직 안 닫힌 정지 구간을 endedAt까지 계산하는 게 현행 계약이다
    // (blockPauseSeconds의 openMs). 헤드리스 구현이 방해초를 재개 시점에만 확정하도록 바뀌면
    // 이 경로에서 정지 시간이 빠져 서버가 그 구간을 집중으로 보상한다(codex 리뷰 4차).
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(4000); // 정지 4초 — 재개하지 않는다
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    const { body } = mockedUpload.mock.calls[0][0];
    expect(body.totalDistractionSeconds).toBe(4); // 열린 구간이 endedAt까지 포함
    expect(body.distractionCount).toBe(1);
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(9000);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(5); // 경과는 정지 시점에 동결
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 });
  });

  test('24시간을 넘긴 정지에서 재개: 블록을 정지 시작 시점에서 끊고 재개 시점부터 새 마커로 연다', async () => {
    // 방해초는 DTO 상한(24h)을 넘길 수 없다 — 값만 자르면 초과분이 서버에서 집중으로 계상되므로
    // 현행은 pauseCutAt으로 블록 자체를 끊는다: 정산은 정지 시작까지, 재개부터 새 블록·새 마커.
    // 정지 구간은 어느 블록에도 안 들어간다(codex 리뷰 6차).
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await jumpWallClock(24 * 3600 * 1000 + 60_000); // 24시간 + 1분 정지
    await fireEvent.press(view.getByTestId('focus.pause')); // 재개 — 컷 분기
    await flush();

    // 블록 1은 정지 시작 시점(시작+5초)에서 끊겨 즉시 정산됐다 — 방해초 0(구간 밖)
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const cutBody = mockedUpload.mock.calls[0][0];
    expect(cutBody.sessionId).toBe('marker-1');
    expect(Date.parse(cutBody.body.endedAt) - Date.parse(cutBody.body.startedAt)).toBe(5000);
    expect(cutBody.body.totalDistractionSeconds).toBe(0);
    expect(mockedStartMarker).toHaveBeenCalledTimes(2); // 재개 시점의 새 마커

    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 블록 2는 재개 시각부터 3초 — 24시간 정지는 어디에도 없다
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload.mock.calls[1][0].sessionId).toBe('marker-2');
    expect(
      Date.parse(mockedUpload.mock.calls[1][0].body.endedAt) -
        Date.parse(mockedUpload.mock.calls[1][0].body.startedAt),
    ).toBe(3000);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 8 });
  });

  test('한 블록의 여러 정지 구간: 방해초 합계·횟수가 모두 누적된다', async () => {
    // 두 번째 pauseStart가 이전 구간을 덮어써 마지막 구간만 남으면 방해초·횟수가 줄어 정지
    // 시간이 집중으로 보상된다 — 순수 헬퍼(blockPause.test.ts)가 아니라 화면이 구간을 이어
    // 붙이는 배선을 고정한다(codex 리뷰 16차).
    await renderSession({ mode: 'countup' });
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(3000); // 정지 1: 3초
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(7000); // 정지 2: 7초 — 길이가 달라야 덮어쓰기 회귀가 값으로 드러난다
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(1000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    const { body } = mockedUpload.mock.calls[0][0];
    expect(body.totalDistractionSeconds).toBe(10); // 3 + 7 — 마지막 구간(7)만이 아니다
    expect(body.distractionCount).toBe(2);
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(15_000);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 });
    expect(logFocusSessionPaused).toHaveBeenCalledTimes(2);
    expect(logFocusSessionResumed).toHaveBeenCalledTimes(2);
  });

  test('첫 틱 전 정지가 24시간을 넘겨 재개: 정산 델타 0이어도 기존 마커를 닫고 새 마커를 연다', async () => {
    // 델타가 있으면 settleFocusBlock의 회전이 기존 마커를 PATCH로 닫지만, 0초 블록은 정산이
    // 조기 반환한다 — 이때 별도의 cancelLiveSession이 빠지면 marker-1이 열린 채 marker-2가
    // 또 열려 친구 화면에 '집중 중'이 서버 스윕(12h)까지 중복 노출된다(codex 리뷰 16차).
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({ mode: 'countup' });
    await fireEvent.press(view.getByTestId('focus.pause')); // 경과 0에서 곧바로 정지
    await jumpWallClock(24 * 3600 * 1000 + 60_000); // 24시간 + 1분
    await fireEvent.press(view.getByTestId('focus.pause')); // 재개 — 컷 분기, 정산 델타 0
    await flush();

    expect(mockedUpload).not.toHaveBeenCalled(); // 0초 블록 — 올릴 게 없다
    expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1'); // 회전 대신 명시 취소
    expect(mockedStartMarker).toHaveBeenCalledTimes(2); // 재개 시점의 새 마커
    await advance(5000);
    expect((await readLiveRecord())!.serverSessionId).toBe('marker-2');
  });
});

describe('중도 정지의 completed 판정 — 카운트업만 완료 취급', () => {
  // completed는 별점 게이트일 뿐 계측 기준이 아니다 — 유저 주도 정지는 목표 미달이어도
  // completed 계측 1회·abandoned 0회다(finish의 logCompletedOnce, abandoned와 상호배타).
  // 헤드리스 구현이 completed=false에서 계측까지 생략하면 완료율 지표에서 세션이 사라진다
  // (codex 리뷰 PR #676 3차).
  test('카운트다운 목표 전 정지: completed=false로 결과 화면 진입, 완료 계측은 1회 발행', async () => {
    await renderSession({ mode: 'countdown', goalSeconds: 10 });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: false });
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
  });

  test('뽀모도로 세트 도중 정지: completed=false로 결과 화면 진입, 완료 계측은 1회 발행', async () => {
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(10_000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 10, completed: false });
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
  });
});

describe('finish를 거치지 않는 언마운트 — Android 시스템 뒤로가기', () => {
  test('언마운트 cleanup이 마커를 취소하고 abandoned(system_back)를 1회 남긴다', async () => {
    // 시스템 뒤로가기는 finish 없이 화면을 내린다 — cleanup만이 열린 마커를 닫고 종결 계측을
    // 남기는 유일한 주체다. 헤드리스화에서 이 cleanup이 빠지면 친구 화면에 '집중 중'이 서버
    // 스윕(12h)까지 남고 세션이 완료/포기 어느 쪽도 안 찍힌다(codex 리뷰 5차).
    await renderSession({ mode: 'countup' });
    await advance(4000);
    // 이 저장소의 RTL은 렌더뿐 아니라 unmount도 비동기다 — await 없이 부르면 정리 작업이
    // 다음 테스트의 render와 겹쳐 그 트리가 빈 채로 남는다(스위트 연쇄 실패).
    await view.unmount();
    await act(async () => {}); // cancelLiveSession의 프라미스 체인 확정

    expect(cancelMarker).toHaveBeenCalledTimes(1);
    expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1');
    expect(logFocusSessionAbandoned).toHaveBeenCalledTimes(1);
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith({
      elapsed_seconds: 4,
      reason: 'system_back',
    });
    expect(logFocusSessionCompleted).not.toHaveBeenCalled(); // 상호배타
    expect(mockedUpload).not.toHaveBeenCalled(); // 정산은 다음 실행의 고아 정산 몫
    // 네이티브 정리도 cleanup 몫 — 빠지면 화면을 떠났는데 Screen Time 차단·Live Activity가
    // 계속 남는다(codex 리뷰 9차)
    expect(ScreenTimeModule.stopFocusShield).toHaveBeenCalled();
    expect(ScreenTimeModule.endFocusActivity).toHaveBeenCalled();
    // ⚠️ 현행 cleanup엔 saveLive가 없다 — 첫 주기 저장(5초) 전 언마운트면 레코드가 아예 없어
    // 고아 정산 근거도 없고, 이후에도 마지막 주기 저장 뒤 최대 4초는 유실된다(codex 리뷰 12차).
    // 「지금의 동작」으로 고정 — 개선은 1600의 영속 상태 머신 몫.
    expect(await readLiveRecord()).toBeNull();
  });

  test('언마운트 정리의 네이티브 해제가 거부돼도: 종결 계측·마커 취소는 계속된다', async () => {
    // finish를 안 거치는 언마운트에서 실드·LA 해제 브리지가 거부되는 기기 — 정리 이펙트들이
    // 서로 독립(fire-and-forget)이라 abandoned·마커 취소는 그대로 돌아야 한다(codex 리뷰 29차).
    (ScreenTimeModule.stopFocusShield as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
    (ScreenTimeModule.endFocusActivity as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await view.unmount();
    await act(async () => {});
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'system_back' }),
    );
    expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1');
  });

  test('언마운트 후 AppState 이벤트: 핸들러가 전부 해제돼 부작용이 없다', async () => {
    // 체류·이탈 이펙트의 sub.remove()가 빠지면 떠난 화면의 핸들러가 다음 전환에 다시 돌아
    // 죽은 화면이 이탈 알림을 예약하거나 finish·replace를 부른다(codex 리뷰 21차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await view.unmount();
    await act(async () => {});
    expect(appStateHandlers).toHaveLength(0); // 구독이 남김없이 해제됐다
    const writesBefore = liveRecordWrites().length;
    await fireAppState('background'); // 남은 핸들러가 없으니 어떤 부작용도 없어야 한다
    expect(scheduleLeaveNotifications).not.toHaveBeenCalled();
    expect(liveRecordWrites().length).toBe(writesBefore);
  });

  test('600ms 지연 콜백 발화 전 언마운트: Live Activity 시작 자체가 없다 — 유령 LA 방지', async () => {
    // LA 시작은 캐릭터 캡처를 기다리는 600ms 지연 콜백이다(cleanup이 clearTimeout+cancelled로
    // 취소). 이 취소가 빠지면 진입 후 600ms 안에 떠난 화면에서 endFocusActivity '뒤에'
    // 지연된 startFocusActivity가 실행돼, 종료할 주체가 없는 Live Activity가 잠금화면에
    // 남는다(codex 리뷰 15차).
    await renderSession({ mode: 'countup' }); // flush는 마이크로태스크만 — 600ms 타이머는 아직
    expect(ScreenTimeModule.startFocusActivity).not.toHaveBeenCalled();
    await view.unmount();
    await act(async () => {});
    await advance(2000); // 지연 콜백 시각을 한참 지나도
    expect(ScreenTimeModule.startFocusActivity).not.toHaveBeenCalled(); // 시작은 끝내 없다
    expect(ScreenTimeModule.endFocusActivity).toHaveBeenCalled(); // 종료(멱등)는 cleanup 몫
  });

  test('스냅샷 저장 대기 중 언마운트: 두 번째 cancelled 가드가 늦은 저장 해결 후의 LA 시작을 막는다', async () => {
    // 캡처는 끝났고 저장이 pending인 창 — save await 뒤의 두 번째 가드가 빠지면 cleanup의
    // endFocusActivity 뒤에 startFocusActivity가 돌아 유령 LA가 남는다(codex 리뷰 33차).
    let resolveSave!: () => void;
    (ScreenTimeModule.saveCharacterSnapshot as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveSave = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(1000); // 캡처 완료 — 저장 대기
    expect(ScreenTimeModule.saveCharacterSnapshot).toHaveBeenCalledWith('b64');
    await view.unmount();
    await act(async () => {});
    await act(async () => {
      resolveSave(); // 언마운트 뒤에야 저장이 해결된다
    });
    await flush();
    expect(ScreenTimeModule.startFocusActivity).not.toHaveBeenCalled();
  });

  test('캡처 대기 중 언마운트: cancelled 가드가 늦은 캡처 해결 후의 LA 시작을 막는다', async () => {
    // clearTimeout은 콜백 시작 전 언마운트만 막는다 — 콜백이 이미 captureRef를 기다리는
    // 중이면 cancelled 가드가 유일한 방어다. 빠지면 cleanup의 endFocusActivity 뒤에 캡처가
    // 해결되며 startFocusActivity가 돌아 종료 주체 없는 LA가 남는다(codex 리뷰 16차).
    let resolveCapture!: (v: string) => void;
    (captureRef as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<string>((r) => {
          resolveCapture = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(1000); // 600ms 경과 — 콜백은 시작됐고 captureRef 응답 대기 중
    expect(captureRef).toHaveBeenCalled();
    expect(ScreenTimeModule.startFocusActivity).not.toHaveBeenCalled();
    await view.unmount(); // 캡처가 느린 기기에서 화면을 떠나는 경로
    await act(async () => {});
    await act(async () => {
      resolveCapture('b64'); // 언마운트 뒤에야 캡처가 해결된다
    });
    await flush();
    expect(ScreenTimeModule.startFocusActivity).not.toHaveBeenCalled();
    expect(ScreenTimeModule.saveCharacterSnapshot).not.toHaveBeenCalled(); // 저장도 가드 몫
  });

  test('마커 응답이 언마운트보다 늦어도: 보류 프라미스를 이어받아 늦은 마커를 취소한다', async () => {
    // cleanup의 cancelLiveSession이 현재 id가 아니라 liveStartPromiseRef 체인을 취소하는 계약 —
    // 현재 id만 읽으면 늦게 발급된 마커가 서버 스윕까지 친구 화면에 남는다(codex 리뷰 12차).
    let resolveMarker!: (v: { sessionId: string }) => void;
    mockedStartMarker.mockImplementationOnce(
      () =>
        new Promise<{ sessionId: string }>((r) => {
          resolveMarker = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(2000);
    await view.unmount(); // 응답 전 시스템 뒤로가기
    await act(async () => {});
    expect(cancelMarker).not.toHaveBeenCalled(); // 아직 취소할 id가 없다

    await act(async () => {
      resolveMarker({ sessionId: 'marker-late' });
    });
    expect(cancelMarker).toHaveBeenCalledWith('marker-late', 'user-1'); // 늦은 마커도 닫는다
    expect(flushPendingMarkerCancels).toHaveBeenLastCalledWith('user-1');
  });

  test('마커 취소가 끝난 직후 밀린 취소 대기열을 재시도한다 — 순서 보장', async () => {
    // cancelLiveSession 체인은 이번 취소의 성패 확정 → flushPendingMarkerCancels 순서다.
    // 순서가 뒤집히면 이번 실패로 대기열에 들어간 취소를 flush가 못 보고, 다음 앱 활성화나
    // 서버 스윕까지 친구 화면에 마커가 남는다(codex 리뷰 9차).
    let resolveCancel!: () => void;
    (cancelMarker as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          resolveCancel = r;
        }),
    );
    await renderSession({ mode: 'countup' });
    await advance(2000);
    // 마운트의 마커 시작이 밀린 취소부터 재시도한다 — 이전 세션의 취소 실패가 대기열에 남은
    // 채 새 집중을 시작하면 옛 마커와 새 마커가 함께 노출되므로, 재시도가 실제로 1회 이상
    // 현재 사용자로 호출됐고 새 마커 등록보다 먼저임을 직접 단언한다(codex 리뷰 24차 — 상대
    // 횟수 기준값만 잡으면 호출 자체가 제거돼도 못 잡는다).
    expect(flushPendingMarkerCancels).toHaveBeenCalledWith('user-1');
    expect((flushPendingMarkerCancels as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mockedStartMarker.mock.invocationCallOrder[0],
    );
    // 이후 '신규' 호출만 계수한다
    const flushCallsBeforeUnmount = (flushPendingMarkerCancels as jest.Mock).mock.calls.length;
    await view.unmount(); // finish를 안 거치는 cleanup — cancelLiveSession 체인만 돈다
    await act(async () => {});
    expect(cancelMarker).toHaveBeenCalledWith('marker-1', 'user-1');
    // 취소 확정 전엔 재시도 없음 — 순서가 뒤집히면 이번 실패분을 flush가 못 본다
    expect(flushPendingMarkerCancels).toHaveBeenCalledTimes(flushCallsBeforeUnmount);

    await act(async () => {
      resolveCancel();
    });
    expect(flushPendingMarkerCancels).toHaveBeenCalledTimes(flushCallsBeforeUnmount + 1);
    expect(flushPendingMarkerCancels).toHaveBeenLastCalledWith('user-1'); // 확정 직후 재시도
  });

  test('정상 종료 후 언마운트: finishedRef 가드가 abandoned 추가 발행을 막는다', async () => {
    // 실제 내비게이션에선 FocusResult replace 직후 cleanup이 돈다 — 가드가 빠지면 완료 세션에
    // system_back abandoned가 겹쳐 완료·포기 상호배타 지표가 깨진다(codex 리뷰 8차).
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    await view.unmount(); // replace 직후의 화면 cleanup 재현
    await act(async () => {});
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    expect(cancelMarker).not.toHaveBeenCalled(); // 마커는 정산 PATCH가 이미 닫았다 — 취소 없음
  });
});

describe('카운트다운 — 완료 게이트', () => {
  test('목표 도달 시 결과 직행 대신 게이트: 즉시 정산·실드 해제·진동, 마커는 PATCH가 닫음, 확인 후 replace', async () => {
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    await advance(3000);

    // 게이트가 화면을 덮고, 정산·해제는 게이트 시점에 이미 끝났다
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].body.focusType).toBe('RANGE');
    expect(mockedStartMarker).toHaveBeenCalledWith(expect.objectContaining({ focusType: 'RANGE' }));
    // Live Activity도 게이트 시점에 즉시 종료 — 확인까지 미루면 게이트에 머무는 동안
    // Dynamic Island에 끝난 집중이 진행 중으로 남는다(codex 리뷰 6차).
    expect(ScreenTimeModule.endFocusActivity).toHaveBeenCalled();
    // 초 단위 목표의 분 환산은 반올림 — 3초 목표는 0분으로 발행된다(codex 리뷰 9차)
    expect(logFocusSessionStarted).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'countdown', goal_minutes: 0 }),
    );
    // 로컬·과목 적립도 게이트 정산에서 같은 델타로 — 업로드만 되고 로컬 오늘 누적이 빠지는
    // 회귀는 결과 화면 경과(session.elapsed 기반)로는 못 잡는다(codex 리뷰 4차).
    expect(mockAddFocusSeconds).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(3);
    expect(mockAddFocusToSubject).toHaveBeenCalledTimes(1);
    expect(mockAddFocusToSubject).toHaveBeenCalledWith('s1', 3);
    expect(ScreenTimeModule.stopFocusShield).toHaveBeenCalled();
    // 마커는 취소가 아니라 정산 업로드(PATCH, sessionId 동봉)가 '종료'로 닫는다 — 정산이 참조를
    // 회전시켜 게이트의 cancelLiveSession은 no-op(GROMO-1214의 지급 경로 보존).
    expect(mockedUpload.mock.calls[0][0].sessionId).toBe('marker-1');
    expect(cancelMarker).not.toHaveBeenCalled();
    expect(Vibration.vibrate).toHaveBeenCalled();
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    // 카운트다운 완료 페이로드 — 모드별 값이 고정값으로 오배선되면 완료 퍼널이 오염된다(codex 리뷰 31차)
    expect(logFocusSessionCompleted).toHaveBeenCalledWith({
      mode: 'countdown',
      focus_minutes: 0, // 3초 → 반올림 0분
      has_tag: true,
    });
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    // 뷰·방향 체류는 게이트가 화면을 덮는 시점에 1회 발행된다(dwellDoneRef) — 빠지면 완료
    // 순간의 체류가 유실되고, finish에서 다시 발행되면 게이트에 머문 시간까지 포함해 체류
    // 지표가 부푼다(codex 리뷰 18차).
    expect(logFocusViewChanged).toHaveBeenCalledTimes(1);
    expect(logFocusViewChanged).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'character', dwell_seconds: 3 }),
    );
    expect(logFocusOrientationChanged).toHaveBeenCalledTimes(1);
    expect(logFocusOrientationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait', dwell_seconds: 3 }),
    );

    // 게이트에 머문 시간은 집중으로 계상되지 않는다 — 재정산 없음, 경과 동결
    await advance(10_000);
    expect(mockedUpload).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()).toEqual([
      'FocusResult',
      { focusSeconds: 3, subjectId: 's1', subjectName: '수학', completed: true },
    ]);
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1); // 게이트·finish 이중 발행 없음
    // 확인의 finish는 체류를 다시 발행하지 않는다 — 게이트에 머문 10초는 가려진 화면이다
    expect(logFocusViewChanged).toHaveBeenCalledTimes(1);
    expect(logFocusOrientationChanged).toHaveBeenCalledTimes(1);
  });

  test('카운트다운 일시정지: 남은 시간·경과가 동결되고 재개 후에만 목표로 진행한다', async () => {
    // 일시정지 테스트가 카운트업·뽀모도로만 다루면 카운트다운 분기의 paused 가드 소실을
    // 못 잡는다 — 정지 중에도 남은 시간이 줄면 가짜 완료 게이트가 뜬다(codex 리뷰 32차).
    await renderSession({ mode: 'countdown', goalSeconds: 10 });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(5000); // 정지 5초 — 목표(10초)를 벽시계로는 지나친다
    expect(view.getByText('00:00:07')).toBeTruthy(); // 남은 시간 동결
    expect(view.queryByText('집중이 끝났어요!')).toBeNull(); // 가짜 완료 없음
    await fireEvent.press(view.getByTestId('focus.pause')); // 재개
    await advance(2000);
    expect(view.getByText('00:00:05')).toBeTruthy(); // 재개 후에만 진행
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: false });
    expect(mockedUpload.mock.calls[0][0].body).toMatchObject({
      totalDistractionSeconds: 5, // 정지 구간은 방해초
      distractionCount: 1,
    });
  });

  test('카운트다운 화면: 남은 시간(display)과 목표 문구가 표시된다', async () => {
    // 큰 숫자가 display 대신 elapsed에 물리면 완료·정산은 멀쩡해도 사용자는 남은 7초 대신
    // 경과 3초를 본다 — 카운트다운의 핵심 화면 계약(codex 리뷰 23차).
    await renderSession({ mode: 'countdown', goalSeconds: 10 });
    await advance(3000);
    expect(view.getByText('00:00:07')).toBeTruthy(); // 남은 시간 — 경과(00:00:03)가 아니다
    expect(view.getByText('목표 00:00:10')).toBeTruthy();
  });

  test('5초를 넘는 목표: 게이트 즉시 정산이 라이브 레코드를 제거한다', async () => {
    // 목표 3초짜리 테스트는 5초 주기 레코드가 아예 안 생겨 삭제 누락을 못 잡는다. 게이트가
    // 레코드를 남기면 다음 실행의 OrphanFocusSettler가 죽은 세션으로 또 정산해 로컬 시간이
    // 중복 적립된다(codex 리뷰 4차).
    await renderSession({ mode: 'countdown', goalSeconds: 7 });
    await advance(5000);
    expect(await readLiveRecord()).not.toBeNull(); // 5초 주기 레코드가 실제로 생겼고
    await advance(2000); // 7초 — 완료 게이트
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(await readLiveRecord()).toBeNull(); // 게이트 정산이 확인 버튼 전에 이미 지웠다
  });

  test('화면 방향 잠금: 마운트 DEFAULT → 완료 시 PORTRAIT_UP 복귀 → 언마운트 PORTRAIT_UP', async () => {
    // 완료 게이트(확인 버튼)는 세로 레이아웃에만 있다 — 가로에선 FocusLandscape 조기 return이
    // 게이트를 가리므로, 완료 시점의 세로 잠금이 빠지면 가로로 완료한 사용자가 확인 버튼을
    // 영영 못 본다(codex 리뷰 10차 — 「완료 시엔 세로로 되돌린다」 이펙트를 고정).
    // ⚠️ 이 테스트는 LANDSCAPE_ENABLED(Platform.OS === 'ios')의 iOS 절반만 고정한다 —
    // Android 절반(게이트 제거 시 lockAsync(DEFAULT)가 매니페스트 세로 설정을 덮는 회귀)은
    // jest.isolateModules·동적 import 모두 react 재평가로 dual-React 훅 크래시가 나서 현
    // jest 단일 프로젝트 구성에선 검증 불가(codex 리뷰 6차·18차에서 두 번 시도). 별도
    // android jest 프로젝트가 필요해 헤드리스화(1600)의 테스트 인프라 항목으로 백로그.
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledTimes(1);
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.DEFAULT, // 마운트 — 이 화면만 자동 회전 허용
    );
    await advance(3000);
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(ScreenOrientation.lockAsync).toHaveBeenCalledTimes(2); // 완료 즉시 세로 복귀
    expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
    await fireEvent.press(view.getByText('확인'));
    await flush();
    await view.unmount();
    await act(async () => {});
    expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP, // 언마운트 — 전역 세로 잠금 복귀
    );
  });

  test('가로 전환 버튼: lockAsync(LANDSCAPE)를 호출한다', async () => {
    // 자동 회전을 꺼 둔 사용자는 이 버튼이 유일한 가로 진입로다 — goLandscape 배선이나 잠금값이
    // 틀려도 기존 DEFAULT·PORTRAIT_UP 단언은 통과하므로 별도로 고정한다(codex 리뷰 19차).
    await renderSession({ mode: 'countup' });
    await fireEvent.press(view.getByLabelText('가로 화면으로 전환'));
    expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  });

  test('방향 잠금 브리지가 거부돼도: 세션·정산·결과 이동·언마운트가 계속된다', async () => {
    // 마운트 DEFAULT·완료 PORTRAIT_UP·언마운트 잠금이 전부 fire-and-forget(.catch)이 현행이다 —
    // 전파로 바뀌면 방향 잠금이 거부되는 기기에서 미처리 거부·세션 중단이 생긴다(codex 리뷰 30차).
    const lockMock = ScreenOrientation.lockAsync as jest.Mock;
    lockMock.mockRejectedValue(new Error('orientation bridge'));
    try {
      await renderSession({ mode: 'countdown', goalSeconds: 3 });
      await advance(3000); // 마운트·완료 잠금 모두 거부돼도 게이트까지 정상
      expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
      await fireEvent.press(view.getByText('확인'));
      await flush();
      expect(mockedUpload).toHaveBeenCalledTimes(1);
      expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: true });
      await view.unmount(); // 언마운트 잠금 거부도 무해
      await act(async () => {});
    } finally {
      lockMock.mockImplementation(() => Promise.resolve()); // 모듈 목 구현은 clearAllMocks로 안 돌아온다
    }
  });

  test('회전 버튼(가로 전환·세로 복귀)의 잠금 거부도 무해 — 세션·종료 흐름 유지', async () => {
    // 마운트·완료 잠금 거부 테스트는 DEFAULT·PORTRAIT_UP 호출만 만든다 — 두 회전 콜백의
    // .catch가 빠지면 잠금 거부 기기에서 버튼 탭이 미처리 거부를 만든다(codex 리뷰 32차).
    const lockMock = ScreenOrientation.lockAsync as jest.Mock;
    lockMock.mockRejectedValue(new Error('orientation bridge'));
    try {
      await renderSession({ mode: 'countup' });
      await fireEvent.press(view.getByLabelText('가로 화면으로 전환')); // LANDSCAPE 거부
      await act(async () => {
        Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
      });
      const lp = mockLandscapeCaptures.at(-1)!;
      await act(async () => {
        lp.onRotatePortrait(); // PORTRAIT_UP 거부
      });
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
      await advance(3000);
      await fireEvent.press(view.getByTestId('focus.stop'));
      await flush();
      expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3 });
    } finally {
      lockMock.mockImplementation(() => Promise.resolve());
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('가로 상태에서 직접 언마운트: 방향 체류만 발행되고 가려진 뷰의 0초 체류는 없다', async () => {
    // 가로에선 세로 페이저가 언마운트돼 있다 — cleanup의 landscape 가드가 빠지면 리셋된
    // character 뷰의 0초 체류가 끼어 실험 지표가 오염된다(codex 리뷰 32차).
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      await advance(4000); // 가로 4초
      const viewCallsBefore = (logFocusViewChanged as jest.Mock).mock.calls.length; // 가로 진입 flush 1회
      await view.unmount();
      await act(async () => {});
      expect(logFocusOrientationChanged).toHaveBeenLastCalledWith(
        expect.objectContaining({ orientation: 'landscape', dwell_seconds: 4 }),
      );
      expect((logFocusViewChanged as jest.Mock).mock.calls.length).toBe(viewCallsBefore);
      expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'system_back' }),
      );
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('창이 가로가 되면 FocusLandscape로 갈리고, 복귀 콜백·방향별 체류가 배선된다', async () => {
    // lockAsync 요청만으로는 가로 분기 렌더·복귀 배선·방향 체류 정리를 못 잡는다 — 실제
    // dimensions를 뒤집어 세로→가로→세로 전환 경로를 실행한다(codex 리뷰 20차).
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      const lp = mockLandscapeCaptures.at(-1)!;
      expect(lp.subjectName).toBe('수학'); // 가로 분기에 세션 데이터가 전달된다
      // 카운트업 가로 타이머 전달값 — 0 고정·mmss 오배선 회귀 방어(codex 리뷰 32차)
      expect(lp).toMatchObject({ mode: 'countup', displaySeconds: 3, format: 'hhmmss' });
      // 가로 진입 — 직전 세로 방향(3초)과 가려지는 뷰(3초)의 체류가 발행된다
      expect(logFocusOrientationChanged).toHaveBeenCalledWith(
        expect.objectContaining({ orientation: 'portrait', dwell_seconds: 3 }),
      );
      expect(logFocusViewChanged).toHaveBeenCalledWith(
        expect.objectContaining({ view: 'character', dwell_seconds: 3 }),
      );
      await advance(4000); // 가로에서 4초
      await act(async () => {
        lp.onRotatePortrait();
      });
      // 복귀 버튼은 PORTRAIT_UP 강제다 — DEFAULT면 폰을 가로로 든 채 눌러도 가로가 유지된다
      expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    } finally {
      // 전역 Dimensions 오염 방지 — 실패해도 다음 테스트는 세로에서 시작해야 한다
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
    expect(view.getByTestId('focus.session.screen')).toBeTruthy(); // 세로 레이아웃 복귀
    // 세로 복귀 — 가로 구간(4초)의 방향 체류가 발행된다
    expect(logFocusOrientationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'landscape', dwell_seconds: 4 }),
    );
  });

  test('가로 화면(카운트다운): 남은 시간·모드·포맷이 전달되고 틱마다 갱신된다', async () => {
    // 가로 목이 subjectName만 수집하면 남은 시간 대신 elapsed가 실려도 못 잡는다 — 세로와 다른
    // 시간을 보는 회귀 방어(codex 리뷰 25차).
    await renderSession({ mode: 'countdown', goalSeconds: 10 });
    await advance(3000);
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      expect(mockLandscapeCaptures.at(-1)).toMatchObject({
        mode: 'countdown',
        format: 'mmss', // 1시간 미만 목표
        displaySeconds: 7, // 남은 시간 — 경과(3)가 아니다
        phase: 'focus',
      });
      await advance(2000);
      expect(mockLandscapeCaptures.at(-1)!.displaySeconds).toBe(5); // 가로에서도 틱 갱신
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('가로 화면(뽀모도로): 페이즈·세트 구성·잔여 시간이 전달된다', async () => {
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(60_000); // 블록 1 완주 → 휴식 진입
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      expect(mockLandscapeCaptures.at(-1)).toMatchObject({
        mode: 'pomodoro',
        phase: 'break', // 세로와 같은 페이즈
        sets: 2,
        setIndex: 1, // 아직 1세트의 휴식
        displaySeconds: 60, // 휴식 잔여
      });
      // 휴식 소진 → 두 번째 집중: 세트 번호가 갱신돼야 한다 — 1로 고정되면 사용자는 계속
      // 「세트 1」만 본다(codex 리뷰 30차).
      await advance(60_000);
      expect(mockLandscapeCaptures.at(-1)).toMatchObject({ phase: 'focus', setIndex: 2 });
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('가로 화면(1시간 카운트다운): hhmmss 포맷으로 전달된다', async () => {
    // 단시간 fixture만으론 landscapeFormat의 1시간 경계 제거(항상 mmss)를 못 잡는다 —
    // 60분 목표가 「60:00」처럼 분 단위로 그려지는 회귀 방어(codex 리뷰 34차).
    await renderSession({ mode: 'countdown', goalSeconds: 3600 });
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      expect(mockLandscapeCaptures.at(-1)).toMatchObject({ mode: 'countdown', format: 'hhmmss' });
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('가로 화면(60분 집중 뽀모도로): hhmmss 포맷으로 전달된다', async () => {
    // 뽀모도로의 자릿수 판정은 집중·휴식 중 최대 페이즈 길이 기준 — 위 카운트다운 케이스와
    // 별개 분기라 따로 고정한다(codex 리뷰 34차).
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 60, breakMin: 5, sets: 2 } });
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    try {
      expect(mockLandscapeCaptures.at(-1)).toMatchObject({ mode: 'pomodoro', format: 'hhmmss' });
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('시스템 글자 배율(fontScale)이 리드아웃 레이아웃에 배선된다 — 캐릭터가 그만큼 줄어든다', async () => {
    // readoutLayout 단위 테스트는 순수 함수만 본다 — 화면이 fontScale 대신 1을 고정해 넘겨도
    // 배율 1 렌더는 통과한다. 큰 글자 설정에서 타이머가 확대된 만큼 캐릭터 몫이 줄지 않아
    // 리드아웃·도트가 겹치는 회귀 방어(codex 리뷰 34차).
    // 배율이 실제로 캐릭터를 줄이려면 예산이 빠듯해야 한다 — 667pt(SE급) + 뽀모도로(배지·도트
    // 예산 포함) 조합. 큰 화면·배율 1에선 예산이 남아 BASE(230) 그대로라 배선 누락이 안 보인다.
    const pomo = { focusMin: 25, breakMin: 5, sets: 4 };
    await act(async () => {
      Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 1 } });
    });
    try {
      await renderSession({ mode: 'pomodoro', pomodoro: pomo });
      const baseSize = mockCharImageCaptures.at(-1)!.size!;
      await view.unmount();
      await act(async () => {
        Dimensions.set({ window: { width: 375, height: 667, scale: 2, fontScale: 2 } });
      });
      await renderSession({ mode: 'pomodoro', pomodoro: pomo });
      const scaledSize = mockCharImageCaptures.at(-1)!.size!;
      expect(scaledSize).toBeLessThan(baseSize);
      // 기대값 자체를 순수 함수로 재계산해 대조 — 화면이 「실제 fontScale」을 넘기는지의 배선 검증.
      // 47/34는 이 스위트의 safe-area 목 top/bottom.
      const expected = focusReadoutLayout(667 - 47 - 34, 375, 2, true, false);
      expect(scaledSize).toBe(expected.charSize);
    } finally {
      await act(async () => {
        Dimensions.set({ window: { width: 400, height: 800, scale: 2, fontScale: 1 } });
      });
    }
  });

  test('게이트에서 Android 하드웨어 뒤로가기: 이벤트를 소비하고 확인 버튼과 동일하게 finish한다', async () => {
    // 게이트가 뜨면 BackHandler를 구독해 pop 대신 finish로 보낸다 — 배선이 빠지면 화면이
    // 단순 pop돼 결과 연출·후속 처리를 건너뛴다(codex 리뷰 6차).
    const backHandlers: Array<() => boolean> = [];
    const backRemoves: jest.Mock[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
      backHandlers.push(h as () => boolean);
      const remove = jest.fn();
      backRemoves.push(remove);
      return { remove } as never;
    });
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    await advance(3000);
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(backHandlers.length).toBeGreaterThan(0); // 게이트가 구독을 걸었다

    let consumed = false;
    await act(async () => {
      consumed = backHandlers.at(-1)!();
    });
    await flush();
    expect(consumed).toBe(true); // 이벤트 소비 — 시스템 pop 차단
    expect(mockedNavigationReplace()).toEqual([
      'FocusResult',
      { focusSeconds: 3, subjectId: 's1', subjectName: '수학', completed: true },
    ]);
    // 구독은 남김없이 해제돼야 한다 — cleanup이 빠지면 결과 화면 전환 뒤에도 리스너가 남아
    // 항상 true를 돌려주며 이후 화면의 하드웨어 뒤로가기를 가로막는다(codex 리뷰 18차).
    await view.unmount();
    await act(async () => {});
    for (const remove of backRemoves) expect(remove).toHaveBeenCalled();
  });

  test('완료 게이트가 뜨면 캐릭터 호흡 애니메이션이 멈춘다 — active=false', async () => {
    // 게이트가 화면을 덮은 뒤에도 가려진 캐릭터의 무한 호흡이 돌면 확인을 누를 때까지 UI
    // 스레드·배터리를 소비한다 — active의 !doneGate 조건을 고정한다(codex 리뷰 22차).
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    await advance(2000);
    expect(mockCharActiveCaptures.at(-1)).toBe(true); // 진행 중·캐릭터 페이지 — 호흡 활성
    await advance(1000); // 목표 도달 — 게이트
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockCharActiveCaptures.at(-1)).toBe(false); // 가려진 캐릭터 — 절전
  });

  test('게이트가 뜬 뒤의 백그라운드 진입: 이탈 알림·이탈 처리가 없다 — done 가드', async () => {
    // 게이트 시점에 실드는 이미 해제돼 있다 — 이탈 핸들러의 session.done 가드가 빠지면 끝난
    // 세션에 폴백 이탈 알림이 예약되고 복귀 시 불필요한 이탈 처리가 돈다(codex 리뷰 21차).
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    await advance(3000);
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    await fireAppState('background');
    expect(scheduleLeaveNotifications).not.toHaveBeenCalled();
    await jumpWallClock(20_000);
    await fireAppState('active');
    await flush();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy(); // 게이트 유지
    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 3, completed: true });
  });

  test('게이트가 뜬 채 화면이 언마운트되면: completed 1회 유지·abandoned 없음', async () => {
    // 게이트에서 확인을 누르기 전 내비게이션 리셋 등으로 화면이 제거될 수 있다 — finishedRef는
    // 아직 false라 cleanup의 종결 계측 분기가 도는데, 이미 발행된 완료와의 상호배타는
    // completedLoggedRef 가드가 지킨다. 가드가 빠지면 한 세션에 completed와 system_back
    // abandoned가 같이 찍혀 퍼널이 오염된다(codex 리뷰 16차).
    await renderSession({ mode: 'countdown', goalSeconds: 3 });
    await advance(3000);
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    await view.unmount(); // 확인 없이 화면 제거
    await act(async () => {});
    expect(logFocusSessionCompleted).toHaveBeenCalledTimes(1);
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
  });
});

describe('뽀모도로 — 블록 경계 정산·마커 회전', () => {
  test('집중→휴식 경계마다 블록을 정산하고, 휴식→집중 경계에서 새 마커를 연다', async () => {
    // 시작 호출마다 다른 마커 id — "회전된 새 id가 두 번째 업로드에 실리는가"까지 고정한다
    // (같은 id를 돌려주면 이전 id 재사용 회귀를 못 잡는다 — codex 리뷰).
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    expect(mockedStartMarker).toHaveBeenCalledTimes(1);

    await advance(60_000); // 집중 1분 → 휴식 진입: 블록 #1 정산
    // 페이즈 경계는 진동 2회 패턴으로 알린다 — 화면을 안 보는 사용자가 휴식 시작을 놓치지
    // 않게 하는 유일한 신호다(codex 리뷰 23차). iOS 패턴 = [0, 500].
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledWith([0, 500]);
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].sessionId).toBe('marker-1');
    expect(mockedUpload.mock.calls[0][0].body.focusType).toBe('POMODORO');
    expect(mockedStartMarker).toHaveBeenCalledWith(
      expect.objectContaining({ focusType: 'POMODORO' }),
    );
    // 뽀모도로 목표 = 집중블록×세트 총 집중분(1분×2세트=2) — 휴식은 목표에 안 들어간다(codex 리뷰 9차)
    expect(logFocusSessionStarted).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'pomodoro', goal_minutes: 2 }),
    );

    await advance(60_000); // 휴식 1분 → 세트 2 집중: 마커 회전(새 마커)
    await flush();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(2); // 휴식→집중 경계도 진동
    expect(mockedStartMarker).toHaveBeenCalledTimes(2);

    // 블록 2 초반 5초 시점의 레코드 — 미정산분(5초)과 회전된 마커만 담아야 한다. 전체 누적(65)을
    // 실으면 이 사이 강제종료 시 고아 정산이 블록 1의 60초를 중복 적립한다(codex 리뷰 4차).
    await advance(5000);
    const block2Record = await readLiveRecord();
    expect(block2Record!.elapsed).toBe(5);
    expect(block2Record!.serverSessionId).toBe('marker-2');
    // 레코드의 startedAt도 블록 2의 시작(= 회전 마커의 startedAt)이어야 한다 — 세션 최초 시각을
    // 재사용하면 이 사이 강제종료 시 고아 정산이 updatedAt−startedAt−elapsed로 방해초를 역산해
    // 이미 정산된 블록 1·휴식까지 방해 구간에 섞이고 POST 폴백 구간도 같은 값으로 오염된다
    // (codex 리뷰 15차).
    expect(block2Record!.startedAt).toBe(mockedStartMarker.mock.calls[1][0].startedAt);

    await advance(55_000); // 마지막 세트 완료 — 트레일링 휴식 없이 done + 블록 #2 정산
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload.mock.calls[1][0].sessionId).toBe('marker-2'); // 회전된 새 id로 종료
    // 두 블록 모두 집중 60초 구간 — 휴식은 어느 블록에도 안 들어간다
    for (const call of mockedUpload.mock.calls) {
      expect(Date.parse(call[0].body.endedAt) - Date.parse(call[0].body.startedAt)).toBe(60_000);
    }
    // 회전 마커의 시작 시각 = 그 블록 업로드 구간의 시작 — PATCH는 startedAt을 다시 안 보내므로
    // 마커가 세션 최초 시각을 재사용하면 블록 2가 휴식·블록 1까지 포함해 저장된다(codex 리뷰 12차)
    expect(mockedStartMarker.mock.calls[1][0].startedAt).toBe(
      mockedUpload.mock.calls[1][0].body.startedAt,
    );
    // 로컬·과목 적립도 블록마다 60초씩 — 업로드만 되고 로컬 누적이 빠지는 회귀 방지(codex 리뷰)
    expect(mockAddFocusSeconds.mock.calls).toEqual([[60], [60]]);
    expect(mockAddFocusToSubject.mock.calls).toEqual([
      ['s1', 60],
      ['s1', 60],
    ]);
    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 120, completed: true });
    // 완료 계측의 전체 페이로드 — core WAU·완료 퍼널의 기준 이벤트라 모드·집중분·태그가
    // 오염되면 수만 맞는 지표가 된다(codex 리뷰 11차)
    expect(logFocusSessionCompleted).toHaveBeenCalledWith({
      mode: 'pomodoro',
      focus_minutes: 2,
      has_tag: true,
    });
  });

  test('블록 1 마커 응답이 회전 뒤에 도착해도: 라이브 레코드는 현재 마커(marker-2)를 유지한다', async () => {
    // startLiveSession의 동일성 가드(liveStartPromiseRef === promise) — 없으면 늦은 응답이
    // liveIdRef를 되살려, 종료된 marker-1이 블록 2의 serverSessionId로 저장되고 강제종료
    // 복구가 이미 닫힌 마커에 귀속된다(codex 리뷰 13차).
    let resolveFirst!: (v: { sessionId: string }) => void;
    mockedStartMarker
      .mockImplementationOnce(
        () =>
          new Promise<{ sessionId: string }>((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(60_000); // 블록 1 정산 — 첫 마커 응답은 아직 보류(업로드 대기)
    await advance(60_000); // 휴식 종료 → marker-2 즉시 발급
    await flush();
    expect(mockedStartMarker).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst({ sessionId: 'marker-1' }); // 회전이 끝난 뒤에야 도착한 첫 응답
    });
    await advance(5000); // 블록 2 주기 저장
    expect((await readLiveRecord())!.serverSessionId).toBe('marker-2'); // 늦은 응답이 안 되살림
    expect(mockedUpload.mock.calls[0][0].sessionId).toBe('marker-1'); // 블록 1 업로드는 늦은 id로 PATCH
  });

  test('블록 1의 일시정지 방해초는 블록 2 업로드에 다시 실리지 않는다', async () => {
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(10_000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(5000); // 블록 1에서 5초 정지
    await fireEvent.press(view.getByTestId('focus.pause'));
    await advance(50_000); // 블록 1 잔여 집중 완주 → 휴식 진입 정산

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(mockedUpload.mock.calls[0][0].body).toMatchObject({
      totalDistractionSeconds: 5,
      distractionCount: 1,
    });

    await advance(60_000); // 휴식
    await advance(60_000); // 블록 2 — 중단 없음
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    // 방해 카운터가 블록 경계에서 리셋 — 안 되면 서버가 블록 2에서도 5초를 또 차감한다
    expect(mockedUpload.mock.calls[1][0].body).toMatchObject({
      totalDistractionSeconds: 0,
      distractionCount: 0,
    });
  });

  test('세로 뽀모도로 리드아웃: 남은 페이즈 시간·세트 배지·휴식 표기가 세션 상태를 따른다', async () => {
    // 정산·마커만 보면 표시 계약이 통째로 빠져도 모른다 — display 대신 elapsed 표시, 휴식 중
    // 과목명 유지, 세트 미갱신 회귀 방어(codex 리뷰 30차).
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(5000);
    expect(view.getByText('00:00:55')).toBeTruthy(); // 블록 남은 시간 — 경과(5)가 아니다
    expect(view.getByText('수학')).toBeTruthy();
    expect(view.getByText('세트 1 / 2')).toBeTruthy();
    await advance(55_000); // 휴식 진입
    expect(view.getByText('휴식')).toBeTruthy(); // 휴식 중엔 과목명 대신 휴식 표기
    await advance(60_000); // 두 번째 집중
    expect(view.getByText('세트 2 / 2')).toBeTruthy();
    expect(view.getByText('수학')).toBeTruthy();
  });

  test('휴식 도중 수동 종료: 정산은 첫 블록 한 번뿐 — 휴식은 어떤 블록에도 업로드되지 않는다', async () => {
    // 휴식에서 finish의 정산은 델타 0이라 추가 업로드가 없어야 한다 — 남은 휴식이나 휴식 체류가
    // 새 블록으로 올라가면 서버 통계·보상이 부풀고, 이미 정산된 블록 1이 중복될 수 있다
    // (codex 리뷰 16차).
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(60_000); // 블록 1 완주 → 경계 정산 → 휴식 진입
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    await advance(10_000); // 휴식 10초
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    expect(mockedUpload).toHaveBeenCalledTimes(1); // 추가 업로드 없음
    expect(mockAddFocusSeconds.mock.calls).toEqual([[60]]); // 적립도 블록 1 한 번뿐
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 60, completed: false });
  });

  test('전날 서버 스냅샷은 무효 — 내 셀은 로컬 폴백으로 내려간다', async () => {
    // KST 자정 뒤 폴링이 실패해 전날 값이 남으면 day 검사가 이를 걸러야 한다 — 빠지면 어제
    // 600초가 오늘 serverBase로 얹혀 내 셀이 부푼다(codex 리뷰 29차).
    jest.setSystemTime(new Date('2026-08-18T10:00:00+09:00'));
    mockMyFocus = { day: '2026-08-17', minutes: 10 }; // 어제 기준일의 잔존 스냅샷
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(5000);
    expect(mockGridMeCaptures.at(-1)!.totalSeconds).toBe(5); // 서버 600이 얹히면 605
  });

  test('서버 오늘 스냅샷이 있으면 내 그리드 셀은 서버 기준+미정산 델타 — 정산분 이중 계상 없음', async () => {
    // gridServerToday 분기(myFocus { day, minutes } 실계약)의 화면 배선 — 서버 기준을 무시하면
    // 이 세션만(60), 정산분을 서버 기준에 또 얹으면 720으로 튄다. me.totalSeconds가 그리드로
    // 전달되는 값 자체를 관찰한다(codex 리뷰 19차).
    jest.setSystemTime(new Date('2026-08-18T10:00:00+09:00'));
    mockMyFocus = { day: '2026-08-18', minutes: 10 }; // 서버 KST 오늘 600초
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(5000);
    expect(mockGridMeCaptures.at(-1)!.totalSeconds).toBe(605); // 600 + 미정산 5
    expect(mockGridMeCaptures.at(-1)!.isFocusing).toBe(true);
    await advance(55_000); // 블록 1 완주 → 정산 → 휴식 진입
    await advance(1000); // 휴식 틱 리렌더
    // 정산 직후 총합 = 서버(600) + 정산 블록(60) — 델타는 리셋됐고 바닥(settledFloor)이 지킨다
    expect(mockGridMeCaptures.at(-1)!.totalSeconds).toBe(660);
    expect(mockGridMeCaptures.at(-1)!.isFocusing).toBe(false); // 휴식 — 그리드 초록 아님
    // 다음 폴링이 방금 정산한 블록을 포함해 돌아와도(11분) 다시 더하지 않는다 — 정산분을
    // 서버 기준 위에 또 얹는 구현이면 720으로 튄다(codex 리뷰 20차: max 수렴 계약).
    mockMyFocus = { day: '2026-08-18', minutes: 11 };
    await advance(1000); // 휴식 틱 리렌더 — 갱신된 스냅샷 반영
    expect(mockGridMeCaptures.at(-1)!.totalSeconds).toBe(660);
  });
});

describe('백그라운드 이탈 정책 — 실드 여부가 가른다', () => {
  test('실드 세션: 자리 비운 시간을 집중 인정(전진)·날짜별 적립하고, 정산까지 그대로 흐른다', async () => {
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    // 실드 세션은 이탈이 차단된 상태라 경고 알림을 예약하지 않는다 — !shielded 가드가 빠지면
    // 보호된 세션에도 이탈 알림이 간다(codex 리뷰 6차).
    expect(scheduleLeaveNotifications).not.toHaveBeenCalled();
    // 벽시계만 전진 — 리플레이가 유일한 적립 경로임을 강제한다. advance(틱 동반)로 흉내내면
    // creditFocusTicks·focusDays 누락 회귀를 못 잡는다(codex 리뷰: 정산·고아 정산이 5초로 축소).
    await jumpWallClock(120_000);
    await fireAppState('active');

    const record = await readLiveRecord();
    expect(record!.elapsed).toBe(125); // 5 + away 120 전진, 복귀 즉시 저장
    // 리플레이 tick이 날짜 맵에도 적립됐는가 — 고아 정산·서버 분포의 근거
    const localSum = Object.values(record!.focusDays!.local).reduce((a, b) => a + b, 0);
    expect(localSum).toBe(125);
    expect(mockNavigation.replace).not.toHaveBeenCalled(); // 세션은 계속
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    // 실드 복귀는 이탈(distraction) 이벤트가 아니다 — !shielded 가드가 빠지면 차단된 120초
    // 이탈이 blocked:false 일반 이탈로 발행돼 차단 효과·이탈률 지표가 왜곡된다(codex 리뷰 18차).
    expect(logFocusDistractionDetected).not.toHaveBeenCalled();

    // 종료 정산 — 인정분 전체가 로컬 적립·업로드 구간에 실린다
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(125);
    const { body } = mockedUpload.mock.calls[0][0];
    expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(125_000);
    // 체류 계측은 집중 인정과 별개 축 — 백그라운드 120초는 뷰·방향 체류에서 제외된다
    // (체류 시계 전용 AppState 구독이 이탈 구간을 차감, codex 리뷰 10차)
    expect(logFocusViewChanged).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'character', dwell_seconds: 5 }),
    );
    expect(logFocusOrientationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait', dwell_seconds: 5 }),
    );
  });

  test('실드 카운트다운이 백그라운드에서 목표를 지나면: 목표 경계로 정산하고 초과 이탈은 미포함', async () => {
    // 리플레이의 next.done 분기 — 복귀 시각으로 닫으면 목표 달성 후 백그라운드 시간까지
    // 서버 구간에 들어간다(codex 리뷰 10차).
    await renderSession({ mode: 'countdown', goalSeconds: 60 });
    await advance(50_000); // 목표 10초 전
    await fireAppState('background');
    await jumpWallClock(30_000); // 목표(+10초)를 지나 20초 더 이탈
    await fireAppState('active');
    await flush();

    // 완료 게이트가 떠 있고, 정산은 복귀 시각이 아니라 실제 목표 경계(시작+60초)
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const doneBody = mockedUpload.mock.calls[0][0].body;
    expect(Date.parse(doneBody.endedAt) - Date.parse(doneBody.startedAt)).toBe(60_000);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(60);

    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 60, completed: true });
  });

  test('inactive 전이는 세션 이탈이 아니다 — 알림 센터·앱 전환기는 15초 정책을 켜지 않는다', async () => {
    // iOS는 화면이 가려지면 background 없이 inactive에 머문다 — 세션 이탈 정책은 background
    // 전용이고 inactive는 체류 시계만 멈춘다. 합쳐지면 알림 센터를 15초 본 사용자가 자동
    // 종료된다(codex 리뷰 10차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireAppState('inactive');
    await jumpWallClock(20_000); // 15초 정책을 넘는 시간 — inactive라 무시돼야 한다
    await fireAppState('active');
    await flush();

    expect(scheduleLeaveNotifications).not.toHaveBeenCalled();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 }); // 3 + 복귀 후 2
    // 체류 시계는 inactive에서도 멈춘다 — background만 제외하면 알림 센터를 20초 본 시간이
    // 뷰·방향 체류에 통째로 섞여 dwell_seconds가 25로 부푼다(codex 리뷰 15차). 세션 이탈
    // 정책(위)과 체류 계측은 같은 inactive를 다르게 다루는 별개 축이다.
    expect(logFocusViewChanged).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'character', dwell_seconds: 5 }),
    );
    expect(logFocusOrientationChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: 'portrait', dwell_seconds: 5 }),
    );
  });

  test('백그라운드에서 복귀 없이 언마운트: cleanup이 예약된 이탈 알림을 거둔다', async () => {
    // 무실드 세션이 background에서 즉시·15초 알림을 예약한 뒤 내비게이션 리셋 등으로 화면이
    // 제거되면, active 복귀 핸들러가 아니라 이펙트 cleanup의 취소가 유일한 회수 경로다 —
    // 빠지면 세션이 사라진 뒤에도 잘못된 종료 경고가 발송된다(codex 리뷰 16차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireAppState('background');
    expect(scheduleLeaveNotifications).toHaveBeenCalledTimes(1);
    const cancelsBefore = (cancelLeaveNotifications as jest.Mock).mock.calls.length;
    await view.unmount(); // 복귀 없이 화면 제거
    await act(async () => {});
    expect((cancelLeaveNotifications as jest.Mock).mock.calls.length).toBeGreaterThan(
      cancelsBefore,
    );
  });

  test('실드 뽀모도로가 백그라운드에서 집중→휴식 경계를 넘으면: 경계 벽시계로 정산하고 휴식은 제외한다', async () => {
    // 리플레이가 최종 상태만 맞추고 endedAt을 복귀 시각으로 쓰면 블록 1 업로드가 휴식까지
    // 삼키고, 경계 정산을 생략하면 마커 회전도 빠진다 — countup 리플레이 테스트로는 못 잡는
    // 모드 경계 계약(codex 리뷰 4차).
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(50_000); // 블록 1 집중 50초
    await fireAppState('background');
    await jumpWallClock(30_000); // 벽시계 30초 — 집중 잔여 10초 + 휴식 20초를 백그라운드로 통과
    await fireAppState('active');
    await flush();

    // 블록 1은 '복귀 시각'이 아니라 실제 경계 벽시계(시작+60초)로 정산됐다
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const replayBody = mockedUpload.mock.calls[0][0];
    expect(replayBody.sessionId).toBe('marker-1');
    expect(Date.parse(replayBody.body.endedAt) - Date.parse(replayBody.body.startedAt)).toBe(
      60_000,
    );
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(60); // 크레딧 10초 포함 블록 몫만
    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 휴식 중 복귀 — 새 마커는 아직
    // 라이브 레코드도 비어 있어야 한다 — 경계 정산이 지운 레코드를 리플레이 끝의 saveLive가
    // 전체 누적으로 되살리면(미정산 가드 부재) 휴식 중 강제종료 시 고아 정산이 블록 1의
    // 60초를 다시 적립·업로드한다(codex 리뷰 16차).
    expect(await readLiveRecord()).toBeNull();

    await advance(40_000); // 남은 휴식 40초 소진 → 블록 2 시작: 마커 회전
    await flush();
    expect(mockedStartMarker).toHaveBeenCalledTimes(2);
    await advance(60_000); // 블록 2 완주 — 게이트 + 정산
    expect(view.getByText('집중이 끝났어요!')).toBeTruthy();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload.mock.calls[1][0].sessionId).toBe('marker-2'); // 회전된 마커로 종료
    expect(
      Date.parse(mockedUpload.mock.calls[1][0].body.endedAt) -
        Date.parse(mockedUpload.mock.calls[1][0].body.startedAt),
    ).toBe(60_000); // 블록 2도 자기 60초만 — 휴식·이탈은 어느 블록에도 없다
    await fireEvent.press(view.getByText('확인'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 120, completed: true });
  });

  test('실드 이탈 크레딧은 세션 누적 8시간 상한 — 왕복해도 다시 차지 않고, 상한 시각에 부분 정산한다', async () => {
    // 상한이 '복귀 1회당'으로 회귀하면 왕복마다 8시간씩 새로 붙는다(GROMO-1253의 34시간 사례).
    // 두 번의 이탈(5h+4h=9h)로 넘겨 크레딧이 8h에서 멈추고, 상한 시각으로 부분 정산 후
    // 새 블록이 열리는 것까지 고정한다(codex 리뷰 6차).
    jest.setSystemTime(new Date('2026-08-18T01:00:00+09:00')); // 자정 경계를 피해 하루 안에서 진행
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({ mode: 'countup' });
    await advance(10_000);
    await fireAppState('background');
    await jumpWallClock(5 * 3600 * 1000); // 이탈 1: 5h — 전부 크레딧
    await fireAppState('active');
    expect((await readLiveRecord())!.elapsed).toBe(10 + 5 * 3600);

    await fireAppState('background');
    await jumpWallClock(4 * 3600 * 1000); // 이탈 2: 4h — 잔여 3h만 크레딧
    await fireAppState('active');
    await flush();

    // 상한 시각(시작+10초+8h)으로 부분 정산 — 미인정 1h는 어느 구간에도 없다
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const capBody = mockedUpload.mock.calls[0][0];
    expect(Date.parse(capBody.body.endedAt) - Date.parse(capBody.body.startedAt)).toBe(
      (10 + 8 * 3600) * 1000,
    );
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(10 + 8 * 3600);

    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 최종 경과 = 10 + 8h(크레딧 상한) + 복귀 후 2 — 9h가 아니다
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 10 + 8 * 3600 + 2 });
    // 상한 정산 후 새 블록은 '복귀 시각'부터 회전된 마커로 열린다 — 배선이 빠지면 두 번째
    // 업로드 구간이 상한 시각부터 시작돼 미인정 1시간이 서버 보상에 들어간다(codex 리뷰 7차).
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    const cap1 = mockedUpload.mock.calls[0][0];
    const cap2 = mockedUpload.mock.calls[1][0];
    expect(cap2.sessionId).toBe('marker-2');
    expect(Date.parse(cap2.body.endedAt) - Date.parse(cap2.body.startedAt)).toBe(2000);
    // 상한 종료 ↔ 새 블록 시작 사이의 미인정 1시간은 어느 구간에도 없다
    expect(Date.parse(cap2.body.startedAt) - Date.parse(cap1.body.endedAt)).toBe(3600 * 1000);
  });

  test('자정을 넘는 실드 리플레이: 업로드 바디의 날짜별 집중초가 실제 벽시계 날짜로 분할된다', async () => {
    // focusSecondsByDate 전달이 빠지거나 축이 뭉개지면 서버 일별 통계·스트릭 귀속이 조용히
    // 오염된다 — 이 파일에 이 필드 단언이 없었다(codex 리뷰 8차).
    jest.setSystemTime(new Date('2026-08-18T23:59:20+09:00'));
    await renderSession({ mode: 'countup' });
    await advance(30_000); // 23:59:50까지 30초 집중
    await fireAppState('background');
    await jumpWallClock(90_000); // 자정을 넘겨 00:00:50 복귀 — 리플레이가 90초 크레딧
    await fireAppState('active');
    await flush();
    // 영속 레코드의 날짜 맵도 같은 귀속이어야 한다 — 자정 후 강제종료 시 고아 정산은 이 레코드의
    // server 맵을 그대로 업로드하고(OrphanFocusSettler:114-118) local 맵으로 오늘 몫을 정한다.
    // 합계·메모리 값만 보면 날짜 키가 복귀일로 뭉개지는 영속 회귀를 못 잡는다(codex 리뷰 17차).
    const midnightRecord = (await readLiveRecord())!;
    expect(midnightRecord.focusDays!.local).toEqual({ '2026-08-18': 40, '2026-08-19': 80 });
    expect(midnightRecord.focusDays!.server).toEqual({ '2026-08-18': 40, '2026-08-19': 80 });
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();

    const { focusSecondsByDate } = mockedUpload.mock.calls[0][0].body;
    expect(Object.keys(focusSecondsByDate).sort()).toEqual(['2026-08-18', '2026-08-19']);
    expect(focusSecondsByDate['2026-08-18'] + focusSecondsByDate['2026-08-19']).toBe(120);
    expect(focusSecondsByDate['2026-08-18']).toBe(40); // 30(포그라운드) + 자정 전 리플레이 10
    expect(focusSecondsByDate['2026-08-19']).toBe(80);
    // 로컬 '오늘' 적립도 자정 이후 몫(80)만 — 전체 델타(120)를 더하면 홈·과목 오늘 통계가
    // 40초 부푼다(codex 리뷰 14차)
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(80);
    expect(mockAddFocusToSubject).toHaveBeenCalledWith('s1', 80);
    // 오늘 판정의 입력도 업로드 본문 그대로다 — 판정 날짜는 endedAt이 아니라 분포 맵의 마지막
    // 귀속일이므로, 맵이 빠지거나 다른 값이 넘어가면 전날 저장 응답이 오늘 판정으로 발행돼
    // 스트릭·목표 결과가 오염된다(codex 리뷰 27차).
    const verdictBody = mockedUpload.mock.calls[0][0].body;
    expect(isTodayVerdict).toHaveBeenCalledWith(
      verdictBody.focusSecondsByDate,
      verdictBody.endedAt,
    );
  });

  test('실드 네이티브 호출이 거부돼도: 세션은 계속되고 폴백(15초 정책) 세션으로 취급된다', async () => {
    // startFocusShield의 false 반환만이 아니라 브리지 거부(.catch)도 폴백이어야 한다 —
    // catch가 빠지면 미처리 거부로 죽거나, 실드 성공으로 오인해 이탈 정책이 뒤바뀐다(codex 리뷰 8차).
    mockedShieldStart.mockRejectedValueOnce(new Error('native bridge'));
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    expect(scheduleLeaveNotifications).toHaveBeenCalled(); // 폴백 세션의 이탈 경고
    await jumpWallClock(20_000);
    await fireAppState('active');
    await flush();
    // 폴백 정책 그대로 — 15초 초과 이탈은 자동 종료, 이탈 시간 미적립
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'leave_timeout' }),
    );
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: false });
  });

  test('무실드 짧은 이탈(15초 이내): app_backgrounded 이탈 계측의 전체 페이로드가 정확하다', async () => {
    // objectContaining만으로는 blocked가 true로 뒤집히거나 app_category가 오배선돼도 못 잡는다 —
    // 차단 안 된 이탈이 차단 성공으로 집계되면 실드 효과 지표가 왜곡된다(codex 리뷰 29차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireAppState('background');
    await jumpWallClock(5000);
    await fireAppState('active');
    await flush();
    expect(logFocusDistractionDetected).toHaveBeenCalledWith({
      reason: 'app_backgrounded',
      app_category: 'other',
      blocked: false,
      returned_to_focus: true,
    });
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
  });

  test('inactive를 거쳐 background로 이어지는 이탈: 체류 시작점은 inactive 시각으로 유지된다', async () => {
    // 두 이벤트에서 시작 시각을 무조건 덮어쓰면 inactive~background 사이 시간이 화면 체류로
    // 잘못 들어가 dwell_seconds가 부푼다 — null 가드가 계약이다(codex 리뷰 29차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('inactive');
    await jumpWallClock(7000); // 앱 전환기에서 7초
    await fireAppState('background'); // 이어지는 background — 시작점을 덮어쓰면 안 된다
    await jumpWallClock(13_000);
    await fireAppState('active'); // 세션 이탈은 background 기준 13초 — 15초 정책 미발동
    await flush();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(logFocusViewChanged).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'character', dwell_seconds: 5 }), // 이탈 20초 전체 제외
    );
  });

  test('이탈 알림 예약·취소가 거부돼도: 이탈 판정과 자동 종료 흐름은 계속된다', async () => {
    // scheduleLeaveNotifications·cancelLeaveNotifications는 fire-and-forget(.catch 삼킴)이
    // 현행이다 — 전파·await로 바뀌면 알림 브리지가 고장난 기기에서 복귀 처리·15초 자동 종료가
    // 통째로 멈춘다(codex 리뷰 27차).
    (scheduleLeaveNotifications as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
    (cancelLeaveNotifications as jest.Mock).mockRejectedValueOnce(new Error('bridge'));
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    expect(scheduleLeaveNotifications).toHaveBeenCalledTimes(1); // 거부돼도 호출 자체는 됐다
    await jumpWallClock(20_000);
    await fireAppState('active'); // 복귀의 취소도 거부되지만
    await flush();
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'leave_timeout' }),
    ); // 15초 판정·finish는 그대로 진행된다
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: false });
  });

  test('실드 응답이 이탈보다 늦게 성공해도: 복귀 판정은 최신 실드 상태를 읽는다', async () => {
    // 이탈 시점 스냅샷의 false를 고정하면 정상 차단된 사용자의 세션이 leave_timeout으로
    // 종료된다 — 복귀는 shieldedRef의 최신 값을 읽어 크레딧 경로로 가야 한다(codex 리뷰 27차).
    let resolveShield!: (ok: boolean) => void;
    mockedShieldStart.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          resolveShield = r;
        }),
    );
    await renderSession({ mode: 'countup' }); // 실드 응답 보류 상태로 시작
    await advance(3000);
    await fireAppState('background'); // 이탈 시점엔 아직 무실드 — 경고 예약됨
    expect(scheduleLeaveNotifications).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveShield(true); // 백그라운드 사이 네이티브가 차단 성공을 확정
    });
    await jumpWallClock(20_000); // 15초를 넘긴 이탈
    await fireAppState('active');
    await flush();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled(); // 포기 아님 — 차단된 이탈
    expect(cancelLeaveNotifications).toHaveBeenCalled(); // 복귀가 예약 경고를 거둔다
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 23 }); // 3 + 이탈 20 적립
  });

  test('실드가 정상적으로 false를 반환해도: 폴백(15초 정책) 세션으로 취급된다', async () => {
    // 브리지 거부(위)와 별개 경로 — 권한 없음·미지원 플랫폼의 정상 false 반환. 반환값을 무시하고
    // resolve만 보고 실드 성공으로 표시하면, 차단 안 된 사용자의 이탈이 집중으로 적립되고
    // 경고 알림·15초 자동 종료가 통째로 빠진다(codex 리뷰 21차).
    mockedShieldStart.mockResolvedValueOnce(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    expect(scheduleLeaveNotifications).toHaveBeenCalledTimes(1); // 폴백 세션의 이탈 경고
    await jumpWallClock(20_000);
    await fireAppState('active');
    await flush();
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'leave_timeout' }),
    );
    // 타임아웃 이탈 계측도 전체 페이로드 — blocked가 뒤집히면 차단 지표 오염(codex 리뷰 29차)
    expect(logFocusDistractionDetected).toHaveBeenCalledWith({
      reason: 'leave_timeout',
      app_category: 'other',
      blocked: false,
      returned_to_focus: false,
    });
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: false });
  });

  test('무실드 세션의 휴식 이탈: 15초 정책 없이 휴식으로 처리된다 — 넘기면 일시정지 대기', async () => {
    // 폴백 15초 자동 종료는 집중 페이즈 전용이다 — 모든 페이즈에 적용되면 권한 없는 사용자가
    // 휴식에 잠깐 나갔다 와도 세션이 포기 처리되거나 이탈 경고가 발송된다(codex 리뷰 21차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'pomodoro', pomodoro: { focusMin: 1, breakMin: 1, sets: 2 } });
    await advance(60_000); // 블록 1 완주 → 휴식 진입
    await advance(10_000); // 휴식 10초 소진
    await fireAppState('background');
    expect(scheduleLeaveNotifications).not.toHaveBeenCalled(); // 휴식 이탈은 경고 없음
    await jumpWallClock(80_000); // 남은 휴식(50초)을 넘겨 복귀
    await fireAppState('active');
    await flush();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 다음 블록은 일시정지 대기 — 새 마커 없음
  });

  test('이탈 중 시계가 뒤로 가도: 크레딧 잔량이 늘지 않고 상한은 8시간에 고정된다', async () => {
    // away 계산의 0 하한이 빠지면 음수 크레딧이 누적을 되돌려 세션당 상한을 초과한다(codex 리뷰 8차).
    jest.setSystemTime(new Date('2026-08-18T01:00:00+09:00'));
    await renderSession({ mode: 'countup' });
    await advance(10_000);
    await fireAppState('background');
    await jumpWallClock(-3600 * 1000); // 시계 역행 1시간 — 크레딧 변화 없어야 한다
    await fireAppState('active');
    await fireAppState('background');
    await jumpWallClock(10 * 3600 * 1000); // 이후 10시간 이탈(역행 1시간 상쇄 후 실경과 9시간)
    await fireAppState('active');
    await flush();
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 크레딧은 여전히 8시간 상한 — 역행이 잔량을 되돌렸다면 9시간이 전부 인정됐을 것
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 10 + 8 * 3600 });
  });

  test('실드 뽀모도로가 백그라운드에서 두 경계(집중→휴식→집중)를 넘으면: 블록 정산·과거 경계 마커·2블록 적립까지', async () => {
    // 리플레이가 최종 페이즈만 비교하면 같은 페이즈 복귀(focus→…→focus)에서 경계 처리를
    // 통째로 건너뛴다 — 휴식이 집중으로 귀속되거나 새 마커가 안 열린다(codex 리뷰 13차).
    mockedStartMarker
      .mockResolvedValueOnce({ sessionId: 'marker-1' })
      .mockResolvedValueOnce({ sessionId: 'marker-2' });
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(50_000); // 블록 1 집중 50초
    await fireAppState('background');
    await jumpWallClock(80_000); // 집중 잔여 10 + 휴식 60 + 블록 2 집중 10을 전부 백그라운드로
    await fireAppState('active');
    await flush();

    // 블록 1 정산(구간 60초·marker-1) + 과거 휴식 종료 시각으로 새 마커
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const multi1 = mockedUpload.mock.calls[0][0];
    expect(multi1.sessionId).toBe('marker-1');
    expect(Date.parse(multi1.body.endedAt) - Date.parse(multi1.body.startedAt)).toBe(60_000);
    expect(mockedStartMarker).toHaveBeenCalledTimes(2);
    // 새 마커의 시작 = 휴식 종료의 실제 벽시계(블록 1 종료 + 60초) — 복귀 시각이 아니다
    expect(
      Date.parse(mockedStartMarker.mock.calls[1][0].startedAt) - Date.parse(multi1.body.endedAt),
    ).toBe(60_000);

    await advance(2000); // 복귀 후 블록 2 계속
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload.mock.calls[1][0].sessionId).toBe('marker-2');
    // 블록 2 구간 = 리플레이 10초 + 복귀 후 2초 — 휴식은 어느 쪽에도 없다
    expect(
      Date.parse(mockedUpload.mock.calls[1][0].body.endedAt) -
        Date.parse(mockedUpload.mock.calls[1][0].body.startedAt),
    ).toBe(12_000);
    expect(mockAddFocusSeconds.mock.calls).toEqual([[60], [12]]);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 72 });
  });

  test('서스펜드 직전에 틱이 더 돌아도: 복귀 리플레이는 이탈 시점 스냅샷에서 다시 계산한다', async () => {
    // 실기기는 background 이벤트 뒤에도 JS가 몇 틱 더 돈다 — 최신 상태에서 away 전체를 또
    // 전진시키면 그 틱들이 이중 적립된다. 리플레이는 leftSessionRef 스냅샷 기준 덮어쓰기가
    // 현행 계약이다(codex 리뷰 13차).
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    await advance(3000); // 서스펜드 전 잔여 틱 3개(경과 8) — 벽시계도 3초 전진
    await jumpWallClock(117_000); // 나머지는 JS 정지 — 총 이탈 120초
    await fireAppState('active');
    await flush();

    // 5(스냅샷) + 120(away) = 125 — 최신 상태(8)에서 다시 전진한 128이 아니다
    expect((await readLiveRecord())!.elapsed).toBe(125);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(125);
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 125 });
  });

  test('실드 실패(폴백) 세션: 15초 초과 이탈은 abandoned(leave_timeout)로 자동 종료 — 이탈 시간은 미적립', async () => {
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    // 과목명·15초 지연까지 정확히 — 지연이 짧아지면 허용된 15초 안에 복귀할 수 있는데도
    // 종료 안내가 먼저 발송된다(codex 리뷰 8차)
    expect(scheduleLeaveNotifications).toHaveBeenCalledWith('수학', 15);
    // 벽시계만 20초 전진(틱 없음 = 실기기의 JS suspend). 폴백 경로는 되감기가 없으므로
    // 여기서 advance를 쓰면 이탈 20초가 집중으로 적립되는 회귀를 못 잡는다(codex 리뷰).
    await jumpWallClock(20_000);
    // 취소는 아직 없어야 한다 — 이펙트 재구독 cleanup이 미리 불러 두면 아래 단언이 공허해진다
    // (codex 리뷰 5차: 목 안정화로 이 사전 조건이 성립하게 됐다).
    expect(cancelLeaveNotifications).not.toHaveBeenCalled();
    await fireAppState('active');
    await flush();

    expect(cancelLeaveNotifications).toHaveBeenCalled();
    expect(logFocusDistractionDetected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'leave_timeout', returned_to_focus: false }),
    );
    expect(logFocusSessionAbandoned).toHaveBeenCalledWith(
      expect.objectContaining({ elapsed_seconds: 5, reason: 'leave_timeout' }),
    );
    // 이탈 전 5초만 적립·결과에 반영 — 자리 비운 20초는 집중이 아니다
    expect(mockAddFocusSeconds).toHaveBeenCalledTimes(1);
    expect(mockAddFocusSeconds).toHaveBeenCalledWith(5);
    // ⚠️ 서버 업로드 구간은 현행이 [시작, 복귀 시각]이다 — 타임아웃 경로의 finish가 endedAt을
    // 지정하지 않아 settle이 Date.now()(복귀 시각)로 닫고, 일시정지가 없었으므로 방해초도 0.
    // 즉 로컬(5초)과 서버 구간(25초)이 불일치하고, 서버 지급이 구간 기준이면 이탈분까지 지급될
    // 수 있다 — "옳은 동작"이 아니라 "지금의 동작"으로 고정한다(codex 리뷰 PR #676 3차).
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const { body: fallbackBody } = mockedUpload.mock.calls[0][0];
    expect(Date.parse(fallbackBody.endedAt) - Date.parse(fallbackBody.startedAt)).toBe(25_000);
    expect(fallbackBody.totalDistractionSeconds).toBe(0);
    // 중도 이탈 종료 — completed=false로 결과 화면, 완료 계측은 없다(상호배타)
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5, completed: false });
    expect(logFocusSessionCompleted).not.toHaveBeenCalled();
  });

  test('실드 실패 세션의 15초 이내 복귀: 이탈 계측·알림 취소만 하고 세션은 이어간다', async () => {
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    await jumpWallClock(10_000); // 벽시계만 — 실기기의 JS suspend 재현
    expect(cancelLeaveNotifications).not.toHaveBeenCalled(); // 사전 조건 — 취소는 복귀가 부른다
    await fireAppState('active');

    expect(cancelLeaveNotifications).toHaveBeenCalled(); // 복귀했으면 예약 알림을 거둔다(codex 리뷰)
    expect(logFocusDistractionDetected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'app_backgrounded', returned_to_focus: true }),
    );
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();

    // "이어간다" = 복귀 후 타이머가 실제로 다시 전진한다(codex 리뷰 — 동결 회귀 방지)
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 7 }); // 5 + 복귀 후 2
  });

  test('폴백 세션의 정확히 15초 복귀: 경계값은 계속이다 — 종료는 15초 초과부터', async () => {
    // 현행 종료 조건은 away > LEAVE_END_S(엄격 초과)다 — >= 로 바뀌면 정확히 15초에 돌아온
    // 사용자가 자동 종료된다. 10초·20초 케이스 사이의 경계를 고정한다(codex 리뷰 6차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(5000);
    await fireAppState('background');
    await jumpWallClock(15_000); // 정확히 경계값
    await fireAppState('active');
    await flush();

    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 7 }); // 5 + 복귀 후 2
  });

  test('일시정지 중 이탈은 무시된다 — 알림 예약·자동 종료 없이 정지 상태만 유지', async () => {
    // 백그라운드 핸들러의 pausedRef 가드가 현행이다 — 빠지면 정지 중 15초 초과 이탈이 일반
    // 집중 이탈로 취급돼 복귀 즉시 자동 종료되거나 이탈 알림이 간다(codex 리뷰 6차).
    mockedShieldStart.mockResolvedValue(false);
    await renderSession({ mode: 'countup' });
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.pause'));
    await fireAppState('background');
    await jumpWallClock(20_000); // 15초 정책을 넘는 이탈 — 정지 중이라 무시돼야 한다
    await fireAppState('active');
    await flush();

    expect(scheduleLeaveNotifications).not.toHaveBeenCalled();
    expect(logFocusSessionAbandoned).not.toHaveBeenCalled();
    expect(mockNavigation.replace).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('focus.pause')); // 재개
    await advance(2000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 경과는 정지 전 3 + 재개 후 2, 이탈 20초는 방해초(닫힌 정지 구간)로만 실린다
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 5 });
    expect(mockedUpload.mock.calls[0][0].body.totalDistractionSeconds).toBe(20);
  });

  test('뽀모도로 휴식 중 짧은 이탈: 남은 휴식만 이어지고 경계 전엔 새 마커를 열지 않는다', async () => {
    // away < 남은 휴식 분기 — 깨지면 짧은 이탈에도 휴식이 조기 종료되거나 다음 블록이
    // 불필요하게 일시정지 대기로 넘어간다(codex 리뷰 12차).
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(60_000); // 블록 1 완료 → 휴식
    await advance(10_000); // 휴식 10초 소진(남은 50초)
    await fireAppState('background');
    await jumpWallClock(20_000); // 남은 휴식(50초)보다 짧은 이탈
    await fireAppState('active');
    await flush();

    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 경계 전 — 새 마커 없음
    await advance(29_000); // 남은 휴식 30초 중 29초
    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 여전히 휴식 — 조기 종료 아님
    await advance(1000); // 휴식 종료 → 블록 2 자동 시작(일시정지 대기 아님)
    await flush();
    expect(mockedStartMarker).toHaveBeenCalledTimes(2);
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 63 }); // 60 + 블록 2 3초
  });

  test('뽀모도로 휴식 중 이탈: 휴식만 소진하고, 남은 휴식을 넘겨 복귀하면 다음 블록을 일시정지 대기시킨다', async () => {
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 2 },
    });
    await advance(60_000); // 블록 1 완료 → 휴식 진입
    expect(mockedStartMarker).toHaveBeenCalledTimes(1);
    await advance(10_000); // 휴식 10초 소진(남은 50초)
    await fireAppState('background');
    await jumpWallClock(80_000); // 남은 휴식(50초)을 넘겨서 복귀
    await fireAppState('active');
    await flush();

    // 집중 경과는 동결(60), 자동 종료 없음, 다음 집중 블록은 일시정지 대기 — 마커도 안 연다
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(mockedStartMarker).toHaveBeenCalledTimes(1); // 사용자가 없는 동안 새 마커 금지
    await advance(10_000); // 대기 중 시간이 흘러도
    await fireEvent.press(view.getByTestId('focus.pause')); // 재개
    await flush();
    expect(mockedStartMarker).toHaveBeenCalledTimes(2); // 재개 시점에야 다음 블록 마커
    await advance(3000);
    await fireEvent.press(view.getByTestId('focus.stop'));
    await flush();
    // 60(블록1) + 재개 후 3 — 휴식·대기·이탈은 한 초도 집중으로 안 들어간다
    expect(mockedNavigationReplace()?.[1]).toMatchObject({ focusSeconds: 63 });
    // 새 블록의 구간은 재개 시각부터다 — markerDeferred 분기가 startBlockAt(재개 시각)을
    // 빠뜨리면 시작점이 복귀 시각에 남아 대기 10초가 두 번째 마커·업로드 구간에 섞인다
    // (codex 리뷰 17차).
    expect(mockedStartMarker.mock.calls[1][0].startedAt).toBe(
      mockedUpload.mock.calls[1][0].body.startedAt,
    );
    expect(
      Date.parse(mockedUpload.mock.calls[1][0].body.endedAt) -
        Date.parse(mockedUpload.mock.calls[1][0].body.startedAt),
    ).toBe(3000);
  });

  test('8시간 상한이 휴식→집중 경계와 정확히 겹치면: 경계 마커를 명시 취소하고 복귀 시각의 새 마커를 연다', async () => {
    // 상한 부분 정산의 델타가 0인 유일한 경우 — 상한이 경계 직후에 떨어지면 settle이 마커를
    // 회전하지 않으므로, 별도 cancelLiveSession이 없으면 경계 시각에 연 과거 마커가 복귀
    // 시각의 새 마커에 참조만 덮여 서버 스윕(12h)까지 '집중 중'으로 남는다(codex 리뷰 18차).
    // 이탈을 t=0(집중 시작 직후)에 걸면 상한 28,800초 = 120초 주기(집중60+휴식60)의 배수라
    // 정확히 240번째 휴식→집중 경계에 떨어진다.
    jest.setSystemTime(new Date('2026-08-18T01:00:00+09:00'));
    let markerSeq = 0;
    mockedStartMarker.mockImplementation(() =>
      Promise.resolve({ sessionId: `marker-${(markerSeq += 1)}` }),
    );
    await renderSession({
      mode: 'pomodoro',
      pomodoro: { focusMin: 1, breakMin: 1, sets: 250 },
    });
    await fireAppState('background'); // 경과 0에서 이탈
    await jumpWallClock((28_800 + 600) * 1000); // 상한 초과 이탈
    await fireAppState('active');
    await flush();

    // 리플레이: 240개 집중 블록 정산 + 240번의 경계 마커 오픈(2~241) + 상한 후 재시작(242)
    expect(mockedUpload).toHaveBeenCalledTimes(240);
    expect(mockedStartMarker).toHaveBeenCalledTimes(242);
    // 상한이 경계와 겹쳐 정산 델타 0 — 경계에 연 marker-241은 명시 취소로 닫힌다
    expect(cancelMarker).toHaveBeenCalledTimes(1);
    expect(cancelMarker).toHaveBeenCalledWith('marker-241', 'user-1');
    // 복귀 시각부터 새 블록·새 마커
    await advance(5000);
    const capRecord = (await readLiveRecord())!;
    expect(capRecord.elapsed).toBe(5);
    expect(capRecord.serverSessionId).toBe('marker-242');
  });
});

// navigation.replace의 마지막 호출 인자 — 단언을 읽기 쉽게 하는 헬퍼
function mockedNavigationReplace(): [string, Record<string, unknown>] | undefined {
  return mockNavigation.replace.mock.calls.at(-1) as [string, Record<string, unknown>] | undefined;
}
