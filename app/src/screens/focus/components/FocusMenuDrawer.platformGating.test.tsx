// 집중 세션 드로어의 허용앱 UI — GROMO-1592 (코드리뷰 반영).
//
// MenuScreen.platformGating.test.tsx와 같은 목적이지만 **다른 화면**이다. 「전체」 탭만
// 고쳤을 때 집중 중 드로어에 같은 거짓 안내가 그대로 남아 있었다 — 리뷰어 둘이 독립적으로
// 같은 자리를 짚었다. 화면 단위로 술어를 거는 방식은 이렇게 한 곳을 빠뜨리기 쉬워서,
// 빠뜨린 자리마다 테스트를 남긴다.
//
// ⚠️ GROMO-1604에서 안드로이드 실드가 붙어 **이 파일은 이미 한 번 뒤집혔다.** 아래 단언은
//    '안드로이드에서도 iOS와 같이 보인다'가 됐다. 게이팅 술어는 그대로 남겨 둔다 — 술어가
//    사라지면 다음에 또 다른 플랫폼이 붙을 때 같은 자리를 다시 빠뜨린다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { FocusMenuDrawer } from './FocusMenuDrawer';
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
    startFocusShield: jest.fn(),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@/services/ScreenTimeModule', () => ({
  __esModule: true,
  default: {
    getAllowedSelectionCounts: jest.fn(async () => ({ applications: 3 })),
  },
}));

jest.mock('@/components/AllowedAppsListView', () => ({ __esModule: true, default: null }));

jest.mock('@/store/FocusContext', () => ({
  useFocus: () => ({ todayFocusSeconds: 600 }),
}));

jest.mock('@/store/SubjectContext', () => ({
  useSubjects: () => ({
    subjects: [{ id: 's1', name: '수학', color: '#5E6AD2', todaySeconds: 300 }],
  }),
}));

async function renderDrawer(shieldActive = true) {
  await act(async () => {
    render(
      <FocusMenuDrawer
        open
        onClose={jest.fn()}
        liveSubjectId="s1"
        liveSeconds={120}
        shieldActive={shieldActive}
      />,
    );
  });
}

const originalPlatformOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => jest.clearAllMocks());
afterEach(() => setPlatform(originalPlatformOS));

describe('안드로이드 — 실드가 붙어 iOS와 같아졌다 (GROMO-1604)', () => {
  beforeEach(() => setPlatform('android'));

  // GROMO-1592 시점엔 이 카드가 '눌러도 아무 일 없는 행'이라 숨겼다. 1604가 폴링+가림막을
  // 붙이면서 실제로 동작하게 됐고, supportsFocusShield()가 열려 다시 보인다.
  test('「허용앱 사용하기」 카드가 보인다', async () => {
    await renderDrawer();

    expect(screen.getByText('허용앱 사용하기')).toBeOnTheScreen();
  });

  test('허용앱 개수를 조회한다', async () => {
    await renderDrawer();

    expect(ScreenTimeModule.getAllowedSelectionCounts).toHaveBeenCalled();
  });

  // 1592에서 '거짓 안내'였던 문구가 1604에선 사실이 됐다 — enforcesFocusShield()가 열린다.
  //
  // ⚠️ '이번 세션에 실제로 걸렸는지'는 이 술어가 답하지 않는다. '다른 앱 위에 표시' 권한이
  //    꺼져 있으면 고를 수는 있어도 가림막이 안 올라간다 — 그건 startFocusShield()의 반환값이
  //    정본이고, 그 분기는 이 드로어가 아니라 세션 화면이 다룬다.
  test('카드를 누르면 「잠겨서 열 수 없어요」 안내가 나온다', async () => {
    await renderDrawer();

    await act(async () => {
      fireEvent.press(screen.getByText('허용앱 사용하기'));
    });

    expect(screen.getByText('허용 안 된 앱은 잠겨서 열 수 없어요')).toBeOnTheScreen();
  });

  test('오늘 전체 집중 현황은 그대로 보인다', async () => {
    await renderDrawer();

    expect(screen.getByText('오늘 전체 집중 현황')).toBeOnTheScreen();
  });
});

describe('iOS — 전부 그대로다', () => {
  beforeEach(() => setPlatform('ios'));

  test('허용앱 카드가 살아 있고 개수를 조회한다', async () => {
    await renderDrawer();

    expect(screen.getByText('허용앱 사용하기')).toBeOnTheScreen();
    expect(ScreenTimeModule.getAllowedSelectionCounts).toHaveBeenCalled();
  });

  // 권한이 없거나 백그라운드에서 서비스가 죽어 실드가 안 걸린 세션 — 모든 앱이 열리는데
  // "잠겨서 열 수 없어요"라고 하면 거짓 안내다(코드리뷰 반영).
  test('실드가 안 걸린 세션에서는 잠금 안내를 하지 않는다', async () => {
    await renderDrawer(false);

    await act(async () => {
      fireEvent.press(screen.getByText('허용앱 사용하기'));
    });

    expect(screen.queryByText('허용 안 된 앱은 잠겨서 열 수 없어요')).toBeNull();
  });

  // warnBox의 enforcesFocusShield() 가드를 실제로 지나는 유일한 경로 — 카드를 눌러 apps
  // 단까지 열어야 문구가 그려진다. 가드를 false로 되돌리면 여기서만 빨개진다.
  test('카드를 누르면 「잠겨서 열 수 없어요」 안내가 나온다', async () => {
    await renderDrawer();

    await act(async () => {
      fireEvent.press(screen.getByText('허용앱 사용하기'));
    });

    expect(screen.getByText('허용 안 된 앱은 잠겨서 열 수 없어요')).toBeOnTheScreen();
  });
});
