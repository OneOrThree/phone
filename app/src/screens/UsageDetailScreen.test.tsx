// 앱별 사용 시간 상세(안드로이드) — GROMO-1602.
//
// iOS는 DeviceActivityReport 익스텐션이 화면을 통째로 그려주지만(수치는 JS로 못 온다),
// 안드로이드는 UsageStats 수치를 받아 RN이 그린다. 그래서 **여기서만 검증할 수 있는 것들**이
// 생긴다 — 정렬·단위·실패 구분.
import { act, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
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
  jest.clearAllMocks();
  setPlatform('android');
  mockGetUsageByApp.mockResolvedValue([]);
  (ScreenTimeModule.getTodayUsageBucketMinutes as jest.Mock).mockResolvedValue(0);
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
