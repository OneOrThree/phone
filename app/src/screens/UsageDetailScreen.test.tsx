// 앱별 사용 시간 상세(안드로이드) — GROMO-1602.
//
// iOS는 DeviceActivityReport 익스텐션이 화면을 통째로 그려주지만(수치는 JS로 못 온다),
// 안드로이드는 UsageStats 수치를 받아 RN이 그린다. 그래서 **여기서만 검증할 수 있는 것들**이
// 생긴다 — 정렬·단위·실패 구분.
import { act, render, screen } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import UsageDetailScreen from './UsageDetailScreen';
import ScreenTimeModule from '@/services/ScreenTimeModule';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

// iOS 네이티브 뷰는 안드로이드 경로를 볼 때 항상 null이어야 한다(실제 런타임과 같은 조건).
jest.mock('@/components/ScreenTimeReportView', () => ({ __esModule: true, default: null }));
jest.mock('@/components/ScreenTimeAnalyzingOverlay', () => ({
  __esModule: true,
  default: () => null,
  ANALYZE_MS: 0,
}));

jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getUsageByApp: jest.fn(),
    getTodayUsageBucketMinutes: jest.fn(),
    getAuthorizationStatus: jest.fn(),
    getAppIcon: jest.fn(),
  },
}));

const mockGetUsageByApp = ScreenTimeModule.getUsageByApp as jest.MockedFunction<
  typeof ScreenTimeModule.getUsageByApp
>;

const originalPlatformOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

async function renderScreen() {
  await act(async () => {
    render(<UsageDetailScreen />);
  });
}

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  jest.clearAllMocks();
  setPlatform('android');
  mockGetUsageByApp.mockResolvedValue([]);
  (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(0);
  (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('approved');
  (ScreenTimeModule.getAppIcon as jest.Mock).mockResolvedValue(null);
});

afterEach(() => setPlatform(originalPlatformOS));

describe('앱별 사용 시간 목록', () => {
  test('오늘(dayOffset 0) 사용량을 조회해 앱 이름과 시간을 보여준다', async () => {
    mockGetUsageByApp.mockResolvedValue([
      { packageName: 'com.kakao.talk', label: '카카오톡', seconds: 4500 },
      { packageName: 'com.google.android.youtube', label: 'YouTube', seconds: 600 },
    ]);

    await renderScreen();

    expect(mockGetUsageByApp).toHaveBeenCalledWith(0);
    expect(screen.getByText('카카오톡')).toBeOnTheScreen();
    expect(screen.getByText('1시간 15분')).toBeOnTheScreen();
    expect(screen.getByText('YouTube')).toBeOnTheScreen();
    expect(screen.getByText('10분')).toBeOnTheScreen();
  });

  // 1분 미만을 분으로 반올림하면 목록 하단이 전부 '0분'이 되어 순서가 의미를 잃는다.
  test('1분 미만은 초로 보여준다', async () => {
    mockGetUsageByApp.mockResolvedValue([
      { packageName: 'com.a', label: 'A', seconds: 42 },
      { packageName: 'com.b', label: 'B', seconds: 3 },
    ]);
    // 총계는 0이 아닌 값으로 둔다 — 0이면 총 사용시간 카드가 '0분'을 정당하게 보여줘서,
    // 아래 '행에 0분이 없다' 단언이 그 카드를 잘못 잡는다.
    (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(1);

    await renderScreen();

    expect(screen.getByText('42초')).toBeOnTheScreen();
    expect(screen.getByText('3초')).toBeOnTheScreen();
    expect(screen.queryByText('0분')).toBeNull();
  });

  // iOS TotalActivityReport.formatDuration과 같은 규칙 — 시간이 있으면 분을 항상 붙인다.
  // 여기서 '2시간'으로 줄이면 같은 사용량이 두 플랫폼에서 다르게 읽힌다.
  test('시간 단위는 iOS와 같은 「N시간 M분」으로 쓴다', async () => {
    mockGetUsageByApp.mockResolvedValue([{ packageName: 'com.a', label: 'A', seconds: 7200 }]);

    await renderScreen();

    expect(screen.getByText('2시간 0분')).toBeOnTheScreen();
  });

  test('기록이 없으면 없다고 알린다', async () => {
    await renderScreen();

    expect(screen.getByText('사용 기록이 없어요')).toBeOnTheScreen();
  });

  // 실패를 빈 목록으로 뭉개면 '안 썼다'와 '못 읽었다'가 화면에서 같아진다.
  test('조회 실패는 「사용 없음」이 아니라 실패로 알린다', async () => {
    mockGetUsageByApp.mockRejectedValue(new Error('denied'));

    await renderScreen();

    expect(screen.getByText('사용 기록을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('사용 기록이 없어요')).toBeNull();
  });
});

// 코드리뷰(GROMO-1608)에서 잡힌 것들 — 전부 **한 화면 안에서 숫자가 어긋나는** 문제였다.
describe('총계와 목록이 어긋나지 않는다', () => {
  // 총계는 모든 패키지를 더하고 목록은 런처 앱만 남긴다 — 홈 런처·시스템 UI 시간이 총계에만
  // 들어가 "총 21분인데 더하면 18분"이 된다. 그 차이를 '그 외' 행으로 드러낸다.
  test('총계와 목록 합의 차이를 「그 외」 행으로 메운다', async () => {
    mockGetUsageByApp.mockResolvedValue([
      { packageName: 'com.a', label: '에이', seconds: 600 },
      { packageName: 'com.b', label: '비', seconds: 480 },
    ]);
    (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(21);

    await renderScreen();

    // 21분 = 1260초, 목록 합 1080초 → 180초
    expect(screen.getByText('그 외')).toBeOnTheScreen();
    expect(screen.getByText('3분')).toBeOnTheScreen();
  });

  // 총계는 분 단위로 내림돼 오고 행은 초 단위라 최대 59초 오차가 있다. 그걸 행으로 만들면
  // 반올림 잡음이 UI 에 노출된다.
  test('1분 미만 차이는 행을 만들지 않는다', async () => {
    mockGetUsageByApp.mockResolvedValue([{ packageName: 'com.a', label: '에이', seconds: 610 }]);
    (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(10);

    await renderScreen();

    expect(screen.queryByText('그 외')).toBeNull();
  });

  // 총계는 네이티브가 내림하는데 행만 반올림하면 90초가 총계 1분 · 행 2분으로 갈린다.
  test('앱별 분 표시는 총계와 같이 내림한다', async () => {
    mockGetUsageByApp.mockResolvedValue([{ packageName: 'com.a', label: '에이', seconds: 90 }]);
    (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(1);

    await renderScreen();

    // 총계 카드와 앱 행이 **둘 다** '1분' — 반올림이면 행만 '2분'이 되어 갈린다.
    expect(screen.getAllByText('1분')).toHaveLength(2);
    expect(screen.queryByText('2분')).toBeNull();
  });
});

// 이 화면을 열어 둔 채 나가서 다른 앱을 쓰고 돌아오면, 컴포넌트가 계속 마운트돼 있어
// effect 가 다시 돌지 않는다 — 처음 열 때의 숫자가 그대로 남는다.
test('앱 복귀 시 사용 내역을 다시 조회한다', async () => {
  mockGetUsageByApp.mockResolvedValue([]);
  await renderScreen();
  expect(mockGetUsageByApp).toHaveBeenCalledTimes(1);

  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1][1] as (state: string) => void;
  await act(async () => {
    handler('active');
  });

  expect(mockGetUsageByApp).toHaveBeenCalledTimes(2);
});

// 표시 단위 정합 · 권한 상실 구분 — GROMO-1608 코드리뷰 2차.
describe('화면에 찍히는 숫자가 서로 맞는다', () => {
  // 초 단위로 빼면 실제 차이가 1분을 넘어도 행이 안 생긴다: 601초(→10분) + 118초 = 719초,
  // 총계 11분(660초). 660-601=59초라 행이 없고, 화면엔 총계 11분·행 합 10분만 남는다.
  test('내림 오차가 있어도 총계와 행 합이 맞는다', async () => {
    mockGetUsageByApp.mockResolvedValue([{ packageName: 'com.a', label: '에이', seconds: 601 }]);
    (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(11);

    await renderScreen();

    // 앱 행 10분 + 그 외 1분 = 총계 11분
    expect(screen.getByText('그 외')).toBeOnTheScreen();
    expect(screen.getAllByText('1분')).toHaveLength(1);
    expect(screen.getByText('10분')).toBeOnTheScreen();
  });
});

// 사용 정보 접근을 끄면 네이티브가 예외가 아니라 빈 배열·0 을 준다 — Promise 는 성공한다.
// 그대로 그리면 '오늘 아무 앱도 안 썼다'로 읽혀서 화면이 거짓말을 한다.
describe('권한 상실을 기록 없음과 구분한다', () => {
  test('권한이 꺼져 있으면 권한 안내를 보여준다', async () => {
    (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('denied');
    mockGetUsageByApp.mockResolvedValue([]);
    (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(0);

    await renderScreen();

    expect(screen.getByText(/사용 정보 접근 권한이 꺼져 있어요/)).toBeOnTheScreen();
    expect(screen.queryByText('사용 기록이 없어요')).toBeNull();
  });

  // 화면을 연 채 설정에서 권한을 끄고 돌아오는 경로 — 재조회가 이걸 잡아야 한다.
  test('복귀 재조회에서 권한이 사라졌으면 안내로 바뀐다', async () => {
    await renderScreen();
    expect(screen.getByText('사용 기록이 없어요')).toBeOnTheScreen();

    (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('denied');
    const calls = (AppState.addEventListener as jest.Mock).mock.calls;
    const handler = calls[calls.length - 1][1] as (s: string) => void;
    await act(async () => {
      handler('active');
    });

    expect(screen.getByText(/사용 정보 접근 권한이 꺼져 있어요/)).toBeOnTheScreen();
  });
});
