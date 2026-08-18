// 「전체」 탭의 스크린타임 진입점 — GROMO-1592 / 1593 / 1604.
//
// 구현이 다 붙어 안드로이드에서도 진입점이 전부 살아 있다. 여기서 잠그는 건 **되는데 없다고
// 말하지 않는다**는 것이다 — 게이팅을 되돌려 한 화면이라도 숨겨지면 재영님이 확인할 방법이
// 없어진다("구현 안 됐다고 UI에서 감추지 마라", 2026-08-18).
//
// 반대 방향의 거짓(안 되는데 된다고 안내)은 screenTimeCapabilities의 술어 분리가 막는다 —
// 고르기(supportsFocusShield)와 실제 차단(enforcesFocusShield)은 여전히 다른 질문이다.
//
// ⚠️ 이 파일은 **구현이 붙는 PR에서 함께 뒤집힌다.** 안드로이드 구현이 들어오면
//    screenTimeCapabilities의 해당 술어가 열리고, 여기 단언도 '보인다'로 바뀐다.
//    지금 단언을 미리 열어 두면 그 PR이 아무것도 검증하지 못한다.
import { act, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MenuScreen from './MenuScreen';
import ScreenTimeModule from '@/services/ScreenTimeModule';

// screenTimeCapabilities 는 ScreenTimeModule 을 거치지 않고 네이티브를 직접 찾는다(그 모듈을
// 통째로 jest.mock 하는 테스트들이 술어까지 지워버리지 않게). 그래서 여기서도 네이티브가
// '있는' 상태를 만들어 줘야 안드로이드 술어가 실제 기기와 같게 열린다.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: () => ({
    getUsageByApp: jest.fn(),
    getInstalledApps: jest.fn(),
    getSelectionPackages: jest.fn(),
  }),
}));

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

describe('안드로이드 — 진입점이 전부 살아 있다', () => {
  beforeEach(() => setPlatform('android'));

  test('허용앱 관리 행이 보인다', async () => {
    await renderMenu();

    expect(screen.getByText('집중 중 허용 앱 관리')).toBeOnTheScreen();
  });

  // 행을 그리면 그 값도 실제로 읽는다 — 개수 없이 '허용앱 없음'만 뜨면 저장이 안 된 것처럼 보인다.
  test('허용앱 개수를 조회한다', async () => {
    await renderMenu();

    expect(ScreenTimeModule.getAllowedSelectionCounts).toHaveBeenCalled();
  });

  test('스크린타임 관리 부제가 측정 대상 앱을 약속한다', async () => {
    await renderMenu();

    expect(screen.getByText('스크린타임 관리')).toBeOnTheScreen();
    expect(screen.getByText('권한 · 측정 대상 앱')).toBeOnTheScreen();
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
