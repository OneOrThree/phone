// 집중 세션 드로어의 허용앱 UI — GROMO-1592 (코드리뷰 반영).
//
// MenuScreen.platformGating.test.tsx와 같은 목적이지만 **다른 화면**이다. 「전체」 탭만
// 고쳤을 때 집중 중 드로어에 같은 거짓 안내가 그대로 남아 있었다 — 리뷰어 둘이 독립적으로
// 같은 자리를 짚었다. 화면 단위로 술어를 거는 방식은 이렇게 한 곳을 빠뜨리기 쉬워서,
// 빠뜨린 자리마다 테스트를 남긴다.
//
// ⚠️ 안드로이드 실드 구현이 붙는 PR에서 이 파일도 함께 뒤집힌다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { FocusMenuDrawer } from './FocusMenuDrawer';
import ScreenTimeModule from '@/services/ScreenTimeModule';

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

async function renderDrawer() {
  await act(async () => {
    render(<FocusMenuDrawer open onClose={jest.fn()} liveSubjectId="s1" liveSeconds={120} />);
  });
}

const originalPlatformOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => jest.clearAllMocks());
afterEach(() => setPlatform(originalPlatformOS));

describe('안드로이드 — 허용앱 UI를 그리지 않는다', () => {
  beforeEach(() => setPlatform('android'));

  test('「허용앱 사용하기」 카드가 없다', async () => {
    await renderDrawer();

    expect(screen.queryByText('허용앱 사용하기')).toBeNull();
  });

  // 카드가 없으면 그 값도 필요 없다. null을 0으로 읽어 '허용앱이 없어요'가 되는 경로 자체를 막는다.
  test('허용앱 개수를 조회하지도 않는다', async () => {
    await renderDrawer();

    expect(ScreenTimeModule.getAllowedSelectionCounts).not.toHaveBeenCalled();
  });

  // 이 PR이 MenuScreen에서 걷어낸 것과 같은 종류의 거짓 안내다.
  //
  // ⚠️ 이 단언은 **결과**를 본다. 지금 이걸 성립시키는 건 위 카드 게이팅이다 — 카드가 없으니
  //    apps 단에 도달할 수 없고, 그래서 문구도 안 그려진다. warnBox에 따로 건
  //    enforcesFocusShield() 가드는 이 테스트로 증명되지 않는다(가드만 되돌려도 초록이다).
  //    그쪽은 아래 iOS 케이스가 반대 방향으로 잡는다.
  test('「잠겨서 열 수 없어요」 안내가 없다', async () => {
    await renderDrawer();

    expect(screen.queryByText('허용 안 된 앱은 잠겨서 열 수 없어요')).toBeNull();
  });

  // 드로어 자체는 남는다 — 집중 현황은 안드로이드에서도 실제로 동작한다.
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
