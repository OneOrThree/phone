// 앱별 사용 시간 상세(안드로이드) — GROMO-1602.
//
// iOS는 DeviceActivityReport 익스텐션이 화면을 통째로 그려주지만(수치는 JS로 못 온다),
// 안드로이드는 UsageStats 수치를 받아 RN이 그린다. 그래서 **여기서만 검증할 수 있는 것들**이
// 생긴다 — 정렬·단위·실패 구분.
import { act, render, screen } from '@testing-library/react-native';
import { AppState, Platform } from 'react-native';
import UsageDetailScreen from './UsageDetailScreen';
import ScreenTimeModule, { type AppUsage } from '@/services/ScreenTimeModule';

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
    getUsageBreakdown: jest.fn(),
    getAuthorizationStatus: jest.fn(),
    getAppIcon: jest.fn(),
  },
}));

const mockGetUsage = ScreenTimeModule.getUsageBreakdown as jest.MockedFunction<
  typeof ScreenTimeModule.getUsageBreakdown
>;

/**
 * 한 번의 조회 결과 — 총계·'그 외'·목록이 **같은 스냅샷**이라는 게 요점이다(코드리뷰 4차).
 * 셋을 따로 받던 시절엔 시점이 갈려 1초 차이가 그대로 허위 '그 외' 행이 됐다.
 *
 * @param other 목록에 안 잡히는 시간(런처·시스템 UI) 초.
 */
function usage(apps: AppUsage[], other = 0) {
  const listed = apps.reduce((sum, a) => sum + a.seconds, 0);
  return { totalSeconds: listed + other, otherSeconds: other, apps };
}

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
  mockGetUsage.mockResolvedValue(usage([]));
  (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('approved');
  (ScreenTimeModule.getAppIcon as jest.Mock).mockResolvedValue(null);
});

afterEach(() => setPlatform(originalPlatformOS));

describe('안드로이드 앱별 사용시간', () => {
  test('오늘(dayOffset 0) 사용량을 조회해 앱 이름과 시간을 보여준다', async () => {
    mockGetUsage.mockResolvedValue(
      usage([
        { packageName: 'com.a', label: '에이', seconds: 3600 },
        { packageName: 'com.b', label: '비', seconds: 600 },
      ]),
    );

    await renderScreen();

    expect(mockGetUsage).toHaveBeenCalledWith(0);
    expect(screen.getByText('에이')).toBeOnTheScreen();
    expect(screen.getByText('비')).toBeOnTheScreen();
  });

  // 1분 미만을 분으로 뭉개면 목록 하단이 전부 '0분'이 되어 순서가 의미를 잃는다.
  test('1분 미만은 초로 보여준다', async () => {
    mockGetUsage.mockResolvedValue(
      usage([
        { packageName: 'com.a', label: '에이', seconds: 42 },
        { packageName: 'com.b', label: '비', seconds: 3 },
      ]),
    );

    await renderScreen();

    expect(screen.getByText('42초')).toBeOnTheScreen();
    expect(screen.getByText('3초')).toBeOnTheScreen();
  });

  test('시간 단위는 iOS와 같은 「N시간 M분」으로 쓴다', async () => {
    mockGetUsage.mockResolvedValue(usage([{ packageName: 'com.a', label: '에이', seconds: 7200 }]));

    await renderScreen();

    // 총계 카드와 앱 행이 같은 규칙으로 찍힌다.
    expect(screen.getAllByText('2시간 0분')).toHaveLength(2);
  });

  test('기록이 없으면 없다고 알린다', async () => {
    await renderScreen();

    expect(screen.getByText('사용 기록이 없어요')).toBeOnTheScreen();
  });

  // 실패를 빈 목록으로 뭉개면 '오늘 아무 앱도 안 씀'과 구분이 안 된다.
  test('조회 실패는 「사용 없음」이 아니라 실패로 알린다', async () => {
    mockGetUsage.mockRejectedValue(new Error('denied'));

    await renderScreen();

    expect(screen.getByText('사용 기록을 불러오지 못했어요')).toBeOnTheScreen();
    expect(screen.queryByText('사용 기록이 없어요')).toBeNull();
  });
});

// 한 화면 안에서 숫자가 어긋나던 것들 — GROMO-1608 코드리뷰.
describe('총계와 목록이 어긋나지 않는다', () => {
  // 총계는 모든 패키지를 더하고 목록은 런처 앱만 남긴다 — 홈 런처·시스템 UI 시간이 총계에만
  // 들어가 "총 21분인데 더하면 18분"이 된다. 그 차이를 '그 외' 행으로 드러낸다.
  test('목록에 안 잡히는 시간을 「그 외」 행으로 메운다', async () => {
    mockGetUsage.mockResolvedValue(
      usage(
        [
          { packageName: 'com.a', label: '에이', seconds: 600 },
          { packageName: 'com.b', label: '비', seconds: 480 },
        ],
        180,
      ),
    );

    await renderScreen();

    expect(screen.getByText('그 외')).toBeOnTheScreen();
    expect(screen.getByText('3분')).toBeOnTheScreen();
  });

  test('1분 미만이면 「그 외」 행을 만들지 않는다', async () => {
    mockGetUsage.mockResolvedValue(
      usage([{ packageName: 'com.a', label: '에이', seconds: 610 }], 30),
    );

    await renderScreen();

    expect(screen.queryByText('그 외')).toBeNull();
  });

  // ⚠️ 이 값은 이제 **네이티브가 계산한다**(코드리뷰 4차). 화면에서 빼던 시절엔 두 반례가
  //    있었다: 초 합을 내림된 분에서 빼면 행이 안 생기고, 내림한 분의 합에서 빼면 없는 행이
  //    생겼다(각 40초 쓴 앱 둘 → 허위 '그 외 1분'). 그 계산이 화면에 없다는 걸 잠근다.
  test('앱을 여러 개 짧게 써도 없는 「그 외」가 생기지 않는다', async () => {
    mockGetUsage.mockResolvedValue(
      usage([
        { packageName: 'com.a', label: '에이', seconds: 40 },
        { packageName: 'com.b', label: '비', seconds: 40 },
      ]),
    );

    await renderScreen();

    expect(screen.queryByText('그 외')).toBeNull();
  });

  // 총계는 네이티브가 내림하고 iOS formatDuration 도 내린다 — 앱별만 반올림하면 90초가
  // 총계 1분 · 행 2분으로 갈린다.
  test('앱별 분 표시는 총계와 같이 내림한다', async () => {
    mockGetUsage.mockResolvedValue(usage([{ packageName: 'com.a', label: '에이', seconds: 90 }]));

    await renderScreen();

    // 총계 카드와 앱 행이 **둘 다** '1분'
    expect(screen.getAllByText('1분')).toHaveLength(2);
    expect(screen.queryByText('2분')).toBeNull();
  });

  // iOS·구 바이너리는 이 조회 자체가 없다 — 목록도 총계도 그리지 않는다.
  test('조회 결과가 없으면 빈 상태로 둔다', async () => {
    mockGetUsage.mockResolvedValue(null);

    await renderScreen();

    expect(screen.getByText('사용 기록이 없어요')).toBeOnTheScreen();
    expect(screen.queryByText('그 외')).toBeNull();
  });
});

// 사용 정보 접근을 끄면 네이티브가 예외가 아니라 빈 결과를 준다 — Promise 는 성공한다.
// 그대로 그리면 '오늘 아무 앱도 안 썼다'로 읽혀서 화면이 거짓말을 한다.
describe('권한 상실을 기록 없음과 구분한다', () => {
  test('권한이 꺼져 있으면 권한 안내를 보여준다', async () => {
    (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockResolvedValue('denied');

    await renderScreen();

    expect(screen.getByText(/사용 정보 접근 권한이 꺼져 있어요/)).toBeOnTheScreen();
    expect(screen.queryByText('사용 기록이 없어요')).toBeNull();
  });

  // 화면을 연 채 설정에서 권한을 끄고 돌아오는 경로.
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

// 이 화면을 열어 둔 채 나가서 다른 앱을 쓰고 돌아오면, 컴포넌트가 계속 마운트돼 있어
// effect 가 다시 돌지 않는다 — 처음 열 때의 숫자가 그대로 남는다.
test('앱 복귀 시 사용 내역을 다시 조회한다', async () => {
  await renderScreen();
  expect(mockGetUsage).toHaveBeenCalledTimes(1);

  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1][1] as (state: string) => void;
  await act(async () => {
    handler('active');
  });

  expect(mockGetUsage).toHaveBeenCalledTimes(2);
});

// 첫 조회가 도는 중에 복귀 재조회가 시작되면 둘이 나란히 돈다. 느린 기기에선 먼저 시작한
// 쪽이 나중에 끝나서, 언마운트만 확인하면 **낡은 결과가 최신을 덮어쓴다.**
test('겹친 조회에서 낡은 결과가 최신을 덮어쓰지 않는다', async () => {
  const deferred: ((v: 'approved' | 'denied') => void)[] = [];
  (ScreenTimeModule.getAuthorizationStatus as jest.Mock).mockImplementation(
    () => new Promise((resolve) => deferred.push(resolve)),
  );

  await render(<UsageDetailScreen />);
  await act(async () => {}); // 첫 조회 시작(아직 미완)

  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1][1] as (s: string) => void;
  await act(async () => {
    handler('active');
  });

  // 두 번째(최신)가 먼저 끝나 '권한 없음'을 세우고, 첫 번째(낡은)가 뒤늦게 '허용'을 들고 온다.
  await act(async () => {
    deferred[1]?.('denied');
  });
  await act(async () => {
    deferred[0]?.('approved');
  });

  expect(screen.getByText(/사용 정보 접근 권한이 꺼져 있어요/)).toBeOnTheScreen();
});
