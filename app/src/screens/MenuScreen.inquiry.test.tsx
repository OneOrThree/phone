// 1:1 문의 진입점 테스트 — 「전체」 탭 → 계정 · 정보 → `1:1 문의`.
//
// 이 행이 앱 전체에서 **유일한 문의 창구**다(docs/prd/inquiry/information-architecture.md §5).
// 화면 본체(GROMO-1573)는 이 행보다 하루 먼저 머지됐고, 그동안 라우트가 없어 도달이 아예
// 불가능했다 — 테스트는 전부 통과하는데 사용자에겐 없는 기능이었다. 그 상태로 되돌아가는 것을
// 막는 게 이 파일의 전부다.
//
// ⚠️ 잠기지 않는 것: `RootNavigator`의 `Stack.Screen` 등록. 라우트 이름을 `types.ts`에만 넣고
//    navigator에서 빠뜨려도 tsc 는 통과하고 여기 navigate 단언도 통과한다(목이라 실제로 안 민다).
//    그 구멍은 수동 QA로만 잡힌다 — navigator 렌더 테스트는 이 레포에 선례가 없다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MenuScreen from './MenuScreen';

const mockNavigate = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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
// 그 setState들이 한 배치로 정리된다(MenuScreen.dev.test.tsx와 같은 이유).
async function renderMenu() {
  await act(async () => {
    render(<MenuScreen />);
  });
}

// 렌더 트리의 텍스트를 DFS(= 화면에 나타나는) 순서로 모은다.
// `JSON.stringify(...).indexOf(...)` 로 순서를 보면 안 된다 — indexOf 는 **첫 등장만** 보므로
// 같은 문구가 접근성 라벨 등으로 한 번 더 나타나는 순간 엉뚱한 위치를 조용히 비교한다.
// 실패하지 않고 틀린 걸 통과시키는 종류의 취약함이라 트리를 직접 훑는다.
type RenderedNode = { children?: unknown } | string | number | null;

function textsInRenderOrder(node: RenderedNode): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return [];
  return children.flatMap((child) => textsInRenderOrder(child as RenderedNode));
}

/** 화면에 나타나는 순서에서의 위치. 없으면 -1. */
function positionOf(texts: string[], needle: string): number {
  return texts.findIndex((t) => t.includes(needle));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('1:1 문의 진입점', () => {
  test('「계정 · 정보」에 1:1 문의 행이 있다', async () => {
    await renderMenu();

    expect(screen.getByText('1:1 문의')).toBeOnTheScreen();
    expect(screen.getByText('궁금한 점 · 오류 신고')).toBeOnTheScreen();
  });

  // 라우트 이름이 어긋나면 런타임에만 터진다 — 문자열이라 tsc 가 잡아주는 건 param list 뿐이다.
  test('누르면 SettingsInquiry 로 이동한다', async () => {
    await renderMenu();

    await act(async () => {
      fireEvent.press(screen.getByText('1:1 문의'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('SettingsInquiry');
  });

  // 문의 행은 __DEV__ 게이트 밖에 있어야 한다 — dev 섹션 안으로 밀려 들어가면 릴리즈 빌드에서만
  // 조용히 사라진다. 테스트 런은 __DEV__ 가 true 라 '보인다'는 단언만으로는 그걸 못 잡는다.
  // 그래서 렌더 트리의 **등장 순서**로 본다 — dev 섹션 제목보다 앞에 있어야 한다(정책 D1).
  test('개발 전용 섹션보다 앞에 있다 (릴리즈 빌드에서 사라지지 않는다)', async () => {
    await renderMenu();

    const texts = textsInRenderOrder(screen.toJSON() as RenderedNode);
    const inquiryAt = positionOf(texts, '1:1 문의');
    const accountAt = positionOf(texts, '계정 설정');
    const privacyAt = positionOf(texts, '개인정보 처리방침');
    const devSectionAt = positionOf(texts, '개발 (dev)');

    expect(devSectionAt).toBeGreaterThan(-1); // dev 섹션이 실제로 렌더된 런에서만 의미가 있다
    expect(inquiryAt).toBeGreaterThan(-1);
    expect(inquiryAt).toBeLessThan(devSectionAt);
    // 「계정 · 정보」 안에서의 자리 — 계정 설정 다음, 개인정보 처리방침 앞(LLD §6.5).
    expect(inquiryAt).toBeGreaterThan(accountAt);
    expect(inquiryAt).toBeLessThan(privacyAt);
  });
});
