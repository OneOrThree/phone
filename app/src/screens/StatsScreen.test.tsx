// StatsScreen 로딩 분기 테스트(GROMO-1381) — 가운데 스피너 하나를 카드 스켈레톤으로 바꾸면서
// 잠가야 하는 것은 **분기 자체**다:
//   ① 첫 로딩(데이터 없음 또는 카드 순서 미로드) 동안 스켈레톤이 보인다.
//   ② 데이터가 도착하면 스켈레톤이 **트리에서 사라진다**(숨는 게 아니라 언마운트).
//      펄스가 무한 루프라 남아 있으면 화면 뒤에서 계속 돈다.
//   ③ 그때 실제 카드 목록이 대신 뜬다.
// 애니메이션 중간 프레임·타이밍은 단언하지 않는다.
//
// 카드 목록 자체는 이 테스트의 관심사가 아니라 CardOrderEditor를 스텁으로 세운다 — 분기만 본다.
import { render, screen, waitFor } from '@testing-library/react-native';
import StatsScreen from './StatsScreen';
import type { StatsData } from './stats/useStatsData';

jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: RNView,
  };
});

// UserContext → services/analytics → firebase 네이티브 모듈까지 전이 import된다(카드 트리의
// ShareDayFrame 경로). 목으로 막지 않으면 스위트가 로드 단계에서 죽는다.
jest.mock('@/services/analytics', () => ({
  track: jest.fn(),
  initAnalytics: jest.fn(),
  setAnalyticsUserId: jest.fn(),
  clearAnalyticsUserId: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), isFocused: () => true }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => cb(), [cb]);
  },
}));

const EMPTY: StatsData = {
  focus: null,
  category: null,
  screenTime: null,
  today: null,
  heatmap: [],
  heatmapFailed: false,
};
let mockStats: { data: StatsData; loading: boolean } = { data: EMPTY, loading: true };
jest.mock('./stats/useStatsData', () => ({
  useStatsData: () => ({ ...mockStats, refetch: jest.fn() }),
}));

// 카드 목록은 분기 확인용 스텁 — 실제 카드들은 각자 조회를 시작해 이 테스트와 무관한 잡음이 된다
jest.mock('./stats/CardOrderEditor', () => {
  const { View } = require('react-native');
  return { CardOrderEditor: () => <View testID="stats.cards" /> };
});
jest.mock('@/components/TabGuideOverlay', () => ({ TabGuideOverlay: () => null }));
jest.mock('@/store/FocusContext', () => ({ useFocus: () => ({ todayFocusSeconds: 0 }) }));
jest.mock('@/store/SubjectContext', () => ({ useSubjects: () => ({ subjects: [] }) }));
jest.mock('@/services/analyticsEvents', () => ({
  logStatsViewed: jest.fn(),
  logStatsPeriodChanged: jest.fn(),
  logStatsCardReordered: jest.fn(),
}));

const HIDDEN = { includeHiddenElements: true } as const;

// 로드 완료 상태 — focus가 채워지면 firstLoad 조건(focus === null)이 풀린다
const LOADED: StatsData = { ...EMPTY, focus: null, heatmap: [] };

beforeEach(() => {
  mockStats = { data: EMPTY, loading: true };
});

describe('StatsScreen 첫 로딩', () => {
  test('로딩 중에는 카드 스켈레톤이 보이고 실제 카드 목록은 없다', async () => {
    await render(<StatsScreen />);
    expect(screen.getByTestId('stats.skeleton', HIDDEN)).toBeTruthy();
    // 기본 탭(WEEK) 구성 그대로
    expect(screen.getAllByTestId(/^stats\.skeleton\./, HIDDEN)).toHaveLength(9);
    expect(screen.queryByTestId('stats.cards')).toBeNull();
  });

  test('데이터가 도착하면 스켈레톤이 언마운트되고 카드 목록이 뜬다', async () => {
    const view = await render(<StatsScreen />);
    expect(screen.queryByTestId('stats.skeleton', HIDDEN)).not.toBeNull();

    mockStats = {
      data: { ...LOADED, heatmap: [] },
      loading: false,
    };
    // firstLoad = loading && focus === null && heatmap 비었음 — loading이 풀리면 해제된다
    await view.rerender(<StatsScreen />);

    await waitFor(() => {
      // ⚠️ 숨김 포함으로 조회해도 없어야 한다 — opacity 0으로 가린 게 아니라 트리에서 빠져야 한다
      expect(screen.queryByTestId('stats.skeleton', HIDDEN)).toBeNull();
    });
    expect(screen.queryByTestId('stats.cards')).not.toBeNull();
  });

  test('데이터가 이미 있어도 카드 순서 조회가 끝난 뒤에야 카드 목록으로 넘어간다', async () => {
    // 첫 렌더 시점엔 orderLoaded=false — 기본 순서가 잠깐 보였다 튀는 것을 막는 기존 규칙이다
    mockStats = { data: LOADED, loading: false };
    const view = await render(<StatsScreen />);
    // 저장소 조회가 끝나면(다음 tick) 카드로 넘어간다
    await waitFor(() => expect(screen.queryByTestId('stats.cards')).not.toBeNull());
    expect(screen.queryByTestId('stats.skeleton', HIDDEN)).toBeNull();
    view.unmount();
  });
});
