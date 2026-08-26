// HomeScreen 모션 배선 테스트(GROMO-1381) — 잠그는 것은 **값이 어디로 흘러가는가**다.
//   ① 오늘 카드의 목표 대비 진행률이 ProgressBar에 그대로 전달된다(치수는 기존 바를 승계).
//   ② 목표를 넘긴 값도 호출부에서 자르지 않는다 — 클램프 규칙은 ProgressBar 한 곳에만 산다.
//   ③ 코인·스트릭 숫자는 AnimatedNumber가 그리되 단위 텍스트('연속 공부 … 일')는 그대로 읽힌다.
//   ④ 진입 stagger가 접근성 트리·문구를 바꾸지 않는다(카드 컨테이너를 Animated.View로 바꾼 것뿐).
// 애니메이션 중간 프레임·타이밍·이징은 단언하지 않는다 — jest에서 워클릿은 목이라 거짓 안정감이다.
import { act, render, screen, waitFor } from '@testing-library/react-native';
import HomeScreen from './HomeScreen';
import { tabBarSafeBottom } from '@/components/tabBarLayout';
import { T } from '@/constants/theme';

jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: RNView,
  };
});

// ⚠️ navigation 객체는 **모듈 스코프에 한 번만** 만든다. 렌더마다 새 객체를 돌려주면
//    checkGoalCelebration(useCallback deps에 navigation)이 매번 새로 생겨 포커스 이펙트가
//    다시 돌고, 그 안의 setReportRefresh가 또 렌더를 부른다 → 무한 루프.
const mockNavigation = { navigate: jest.fn(), isFocused: () => true };
let mockIsFocused = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => mockIsFocused,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));

// ── 데이터 원천 ── 화면이 그리는 값만 제어하고 나머지는 무해한 기본값으로 막는다
let mockCoins = 0;
let mockStreak = 0;
let mockTodayFocusSeconds = 0;
jest.mock('@/store/UserContext', () => ({
  useUser: () => ({
    nickname: '재영',
    userId: 'u1',
    goalSeconds: 3600,
    screenTimeGoalSeconds: 7200,
  }),
}));
jest.mock('@/store/FocusContext', () => ({
  useFocus: () => ({ todayFocusSeconds: mockTodayFocusSeconds }),
}));
jest.mock('@/store/CharacterContext', () => ({ useCharacter: () => ({ activeSource: null }) }));
jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: mockCoins }),
  useRefreshCoinsOnFocus: jest.fn(),
}));
jest.mock('@/screens/league/useLeagueMeta', () => ({
  useLeagueMeta: () => ({ tier: { tierLevel: 1 } }),
}));
jest.mock('@/screens/league/useLeagueRanking', () => ({
  useLeagueRanking: () => ({ myLeagueRank: 3 }),
}));

jest.mock('@/services/statsApi', () => ({
  getTodayStats: jest.fn().mockRejectedValue(new Error('offline')), // 로컬 폴백 경로로 고정
  getStreak: jest.fn(() => Promise.resolve({ currentStreak: mockStreak })),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAuthorizationStatus: jest.fn().mockResolvedValue('approved'),
    requestAuthorization: jest.fn().mockResolvedValue(true),
    getTodayUsageBucketMinutes: jest.fn().mockResolvedValue(0),
  },
  androidNativeModuleAvailable: () => false,
}));
jest.mock('@/components/ScreenTimeReportView', () => ({ __esModule: true, default: null }));
jest.mock('@/services/userApi', () => ({ updateScreenTimePermission: jest.fn() }));
jest.mock('@/services/notificationInbox', () => ({
  hasUnread: jest.fn().mockResolvedValue(false),
  subscribeInbox: () => () => {},
}));
jest.mock('@/services/goalCelebration', () => ({
  celebrationDayKey: () => '2026-01-01',
  readPendingCelebration: jest.fn().mockResolvedValue(null),
  clearPendingCelebration: jest.fn().mockResolvedValue(undefined),
  subscribeCelebration: () => () => {},
}));
jest.mock('@/services/screentimeCelebration', () => ({
  readPendingScreenTimeCelebration: jest.fn().mockResolvedValue(null),
  clearScreenTimeCelebration: jest.fn().mockResolvedValue(undefined),
  subscribeScreenTimeCelebration: () => () => {},
}));
jest.mock('@/services/analyticsEvents', () => ({
  logHomeViewed: jest.fn(),
  logTodaySummaryViewed: jest.fn(),
  logHomeButtonTapped: jest.fn(),
  logHomeRefreshed: jest.fn(),
}));
jest.mock('@/components/TabGuideOverlay', () => ({ TabGuideOverlay: () => null }));
// (TabBar에서 fabWindowRect(투어 스포트라이트 좌표) 하나만 쓴다. 전이로 딸려오던
//  @callstack/liquid-glass는 jest.setup.js가 통째로 스텁하므로 목이 필요없다.)

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
  whenReduceMotionReady: () => Promise.resolve(),
}));

const BAR = 'home.metric.focus.bar';
const barFill = () => screen.getByTestId(`${BAR}.fill`).props.style;
const flatten = (style: unknown) => require('react-native').StyleSheet.flatten(style);
const styleOf = (testID: string) => flatten(screen.getByTestId(testID).props.style) ?? {};

beforeEach(() => {
  mockCoins = 0;
  mockStreak = 0;
  mockTodayFocusSeconds = 0;
  mockReduce = false;
  mockIsFocused = true;
});

describe('HomeScreen 오늘 카드 진행바', () => {
  test('목표 대비 진행률이 ProgressBar로 전달된다 — 30분/60분이면 50%', async () => {
    mockTodayFocusSeconds = 1800; // 30분, 목표 3600초(60분)
    await render(<HomeScreen />);
    const bar = screen.getByTestId(BAR);
    // 접근성 값은 0~100 스케일 — 진행률이 실제로 넘어갔다는 계약
    expect(bar.props.accessibilityValue).toEqual({ now: 50, min: 0, max: 100 });
    expect(flatten(barFill()).width).toBe('50%');
  });

  test('기존 바의 치수(높이 6·반지름 3)를 그대로 승계한다', async () => {
    await render(<HomeScreen />);
    const style = flatten(screen.getByTestId(BAR).props.style);
    expect(style.height).toBe(6);
    expect(style.borderRadius).toBe(3);
  });

  test('목표를 넘긴 값은 호출부가 아니라 ProgressBar가 100%로 자른다', async () => {
    mockTodayFocusSeconds = 7200; // 목표의 2배
    await render(<HomeScreen />);
    expect(screen.getByTestId(BAR).props.accessibilityValue.now).toBe(100);
    expect(flatten(barFill()).width).toBe('100%');
  });
});

describe("HomeScreen '동작 줄이기'", () => {
  test('reduce여도 값·문구는 그대로 보인다 — 사라지는 건 움직임뿐이다', async () => {
    mockReduce = true;
    mockCoins = 300;
    mockStreak = 4;
    mockTodayFocusSeconds = 1800;
    await render(<HomeScreen />);
    expect(screen.getByTestId(BAR).props.accessibilityValue.now).toBe(50);
    expect(screen.getByText('300')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('home.streak')).toBeTruthy());
    expect(screen.getByTestId('home.today.detail')).toBeTruthy();
  });
});

describe('HomeScreen 코인·스트릭 칩', () => {
  test('코인은 천단위 구분 기호가 붙은 최종값으로 읽힌다', async () => {
    mockCoins = 12345;
    await render(<HomeScreen />);
    const coins = screen.getByTestId('home.coins');
    // VoiceOver가 중간 숫자를 읽지 않도록 라벨은 항상 최종값이다
    expect(coins.props.accessibilityLabel).toBe('12,345');
  });

  test("스트릭은 숫자만 감싸고 '연속 공부 … 일' 단위 텍스트는 그대로 남는다", async () => {
    mockStreak = 7;
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home.streak')).toBeTruthy());
    expect(screen.getByTestId('home.streak').props.accessibilityLabel).toBe('7');
    expect(screen.getByText(/연속 공부/)).toBeTruthy();
    expect(screen.getByText(/일/)).toBeTruthy();
  });

  // 칩이 0일이면 숨겨지므로, 첫 응답이 오는 순간에야 서브트리가 마운트된다. 그때 최종값으로
  // 초기화되면 카운트업이 아예 안 돈다(codex 리뷰) — 표시값을 한 커밋 늦춰 0에서 출발시킨다.
  //
  // ⚠️ 가짜 타이머로 시계를 멈춘 채 확인한다. 실제 타이머를 쓰면 rAF 보간이 조금씩 진행돼
  //    "아직 최종값이 아니다"가 기기 부하에 따라 흔들린다(병렬 실행 중 600ms를 넘기면 오탐).
  test('처음 스트릭이 도착하면 최종값이 아니라 0에서 세어 올라가기 시작한다', async () => {
    mockStreak = 7;
    jest.useFakeTimers();
    try {
      const view = await render(<HomeScreen />);
      // getStreak 응답 → setStreakDays → effect → setStreakShown 까지 마이크로태스크만 비운다
      await act(async () => {});
      await act(async () => {});
      const node = screen.getByTestId('home.streak');
      // 라벨(스크린리더가 읽는 값)은 언제나 최종값
      expect(node.props.accessibilityLabel).toBe('7');
      // 화면에 그려지는 값은 아직 0 = 0에서 세어 올라가기 시작했다(시계를 멈춰 뒀으므로 확정적)
      expect(node.props.children).toBe('0');
      await view.unmount(); // 남은 rAF 취소 — 뒤 테스트로 새지 않게
    } finally {
      jest.useRealTimers();
    }
  });

  test('스트릭 0일이면 칩 자체가 없다(기존 규칙)', async () => {
    mockStreak = 0;
    await render(<HomeScreen />);
    expect(screen.queryByTestId('home.streak')).toBeNull();
  });
});

describe('HomeScreen 접근성', () => {
  test('알림 버튼은 읽지 않은 알림 상태를 레이블에 포함한다', async () => {
    const { hasUnread } = jest.requireMock('@/services/notificationInbox') as {
      hasUnread: jest.Mock;
    };
    hasUnread.mockResolvedValueOnce(true);

    await render(<HomeScreen />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '알림 보기, 읽지 않은 알림 있음' })).toBeTruthy(),
    );
  });

  test('읽지 않은 알림이 없으면 기본 알림 레이블을 사용한다', async () => {
    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByRole('button', { name: '알림 보기' })).toBeTruthy());
  });
});

describe('HomeScreen 진입 stagger', () => {
  test('컨테이너를 Animated.View로 바꿔도 기존 testID·문구가 그대로 있다', async () => {
    await render(<HomeScreen />);
    // 오늘 카드(진입 stagger 2)와 그 안의 '자세히' 버튼 — Maestro 셀렉터 계약
    expect(screen.getByTestId('home.screen')).toBeTruthy();
    expect(screen.getByTestId('home.today.detail')).toBeTruthy();
    expect(screen.getByText('공부 집중')).toBeTruthy();
  });
});

describe('HomeScreen 오늘 카드 여백(GROMO-1487)', () => {
  test('카드 아래 여백은 탭바가 덮는 높이에서 나온다 — 매직넘버 74가 아니다', async () => {
    await render(<HomeScreen />);
    // 하단 인셋 34(목) → 탭바가 덮는 높이 + 한 칸. 예전 규칙(34 + 74 = 108)과는 다른 값이다.
    expect(styleOf('home.today.card').marginBottom).toBe(tabBarSafeBottom(34) + T.space.sm);
    expect(styleOf('home.today.card').marginBottom).toBeGreaterThan(34 + 74);
  });
});

describe('HomeScreen 캐릭터', () => {
  test('홈이 포커스를 잃으면 호흡을 멈춘다 — 안 보이는 화면의 무한 루프를 끊는다', async () => {
    mockIsFocused = false;
    await render(<HomeScreen />);
    // active=false면 AnimatedCharacter가 반복을 끊고 정지 프레임으로 돌아간다(프리미티브 계약)
    // — 호흡 transform 자체가 붙지 않는다. 중간 프레임 값은 단언하지 않는다.
    expect(styleOf('home.character').transform).toBeUndefined();
  });

  test('메인 캐릭터(216)만 호흡 래퍼로 감싼다 — 프로필 아바타는 그대로다', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('home.character')).toBeTruthy();
    // 포커스 중에는 호흡이 붙어 있다 — 위 '멈춘다' 단언의 대조군
    expect(styleOf('home.character').transform).toBeDefined();
    // 상단 프로필 아바타(38)는 s.avatar의 overflow:'hidden' 안이라 호흡을 붙이면 잘린다.
    // 화면에 호흡 래퍼는 정확히 하나여야 한다(무한 루프 화면당 1개 상한).
    expect(screen.getAllByTestId('home.character')).toHaveLength(1);
  });
});
