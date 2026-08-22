// 「전체」 탭의 스크린타임 진입점 — GROMO-1592.
//
// 여기서 잠그는 건 **눌러도 아무 일이 없는 행을 그리지 않는다**는 것이다.
// 안드로이드엔 아직 앱 피커도 집중 실드도 없어서, 행을 남겨 두면
//   - 「집중 중 허용 앱 관리」는 탭해도 피커가 안 뜨고, 게다가 '집중 중 모든 앱이 잠겨요'로
//     **안 잠기는 걸 잠긴다고** 안내한다
//   - 「스크린타임 관리」 부제의 '측정 대상 앱'은 하위 화면에 없는 항목을 약속한다
// 둘 다 사용자에겐 그냥 고장이다.
//
// ⚠️ 이 파일은 **구현이 붙는 PR에서 함께 뒤집힌다.** 안드로이드 구현이 들어오면
//    screenTimeCapabilities의 해당 술어가 열리고, 여기 단언도 '보인다'로 바뀐다.
//    지금 단언을 미리 열어 두면 그 PR이 아무것도 검증하지 못한다.
import { act, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MenuScreen from './MenuScreen';
import ScreenTimeModule from '@/services/ScreenTimeModule';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));

jest.mock('@/store/UserContext', () => ({
  useUser: () => ({
    userId: 'me',
    nickname: '나',
    goalSeconds: 7200,
    screenTimeGoalSeconds: 7200,
  }),
}));

jest.mock('@/store/CharacterContext', () => ({
  useCharacter: () => ({
    choice: 'default',
    customUri: null,
    setChoice: jest.fn(),
    setCustomUri: jest.fn(),
    activeSource: null,
  }),
}));

jest.mock('@/store/CoinContext', () => ({
  useCoins: () => ({ coins: 0 }),
  useRefreshCoinsOnFocus: jest.fn(),
}));

jest.mock('@/services/statsApi', () => ({ getStreak: jest.fn(async () => ({ current: 3 })) }));
jest.mock('@/services/screentimeSync', () => ({
  registerUsageBucketMonitoring: jest.fn(async () => true),
}));
jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAllowedSelectionCounts: jest.fn(async () => ({ applications: 3 })),
    getAuthorizationStatus: jest.fn(async () => 'approved'),
    getUsageBucketDebugInfo: jest.fn(async () => null),
  },
}));

jest.mock('@/services/analyticsEvents', () => ({
  logGroupChallengeResultShown: jest.fn(),
  logGroupChallengeResultClosed: jest.fn(),
  logTabGuideCompleted: jest.fn(),
}));

// MenuScreen은 포커스 이펙트에서 네이티브·API를 여러 개 호출한다 — 렌더를 act로 감싸야
// 그 setState들이 한 배치로 정리된다(MenuScreen.inquiry.test.tsx와 같은 이유).
async function renderMenu() {
  await act(async () => {
    render(<MenuScreen />);
  });
}

const originalPlatformOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => setPlatform(originalPlatformOS));

describe('안드로이드 — 아직 못 하는 진입점은 그리지 않는다', () => {
  beforeEach(() => setPlatform('android'));

  test('허용앱 관리 행이 없다', async () => {
    await renderMenu();

    expect(screen.queryByText('집중 중 허용 앱 관리')).toBeNull();
  });

  // 행을 안 그리면 그 값도 필요 없다. 헛도는 네이티브 왕복이 매 진입마다 남지 않게 한다.
  test('허용앱 개수를 조회하지도 않는다', async () => {
    await renderMenu();

    expect(ScreenTimeModule.getAllowedSelectionCounts).not.toHaveBeenCalled();
  });

  // 스크린타임 관리 자체는 남는다 — 권한·사용시간 측정은 안드로이드에서도 실제로 동작한다.
  test('스크린타임 관리는 남되 부제가 없는 항목을 약속하지 않는다', async () => {
    await renderMenu();

    expect(screen.getByText('스크린타임 관리')).toBeOnTheScreen();
    expect(screen.queryByText('권한 · 측정 대상 앱')).toBeNull();
    expect(screen.getByText('권한 · 사용시간 측정')).toBeOnTheScreen();
  });
});

describe('iOS — 전부 그대로다', () => {
  beforeEach(() => setPlatform('ios'));

  test('허용앱 관리 행과 측정 대상 부제가 살아 있다', async () => {
    await renderMenu();

    expect(screen.getByText('집중 중 허용 앱 관리')).toBeOnTheScreen();
    expect(screen.getByText('권한 · 측정 대상 앱')).toBeOnTheScreen();
  });
});
