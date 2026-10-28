// StatsScreen 로딩 분기 테스트(GROMO-1381) — 가운데 스피너 하나를 카드 스켈레톤으로 바꾸면서
// 잠가야 하는 것은 **분기 자체**다:
//   ① 첫 로딩(데이터 없음 또는 카드 순서 미로드) 동안 스켈레톤이 보인다.
//   ② 데이터가 도착하면 스켈레톤이 **트리에서 사라진다**(숨는 게 아니라 언마운트).
//      펄스가 무한 루프라 남아 있으면 화면 뒤에서 계속 돈다.
//   ③ 그때 실제 카드 목록이 대신 뜬다.
// 애니메이션 중간 프레임·타이밍은 단언하지 않는다.
//
// 카드 목록 자체는 이 테스트의 관심사가 아니라 CardOrderEditor를 스텁으로 세운다 — 분기만 본다.
import { Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import StatsScreen from './StatsScreen';
import { skeletonCards } from './stats/constants';
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
// 과목·총계는 로컬 소스(Context)라 로딩 중에도 값이 있다 — 스켈레톤 범례 행 수가 여기서 나온다
let mockSubjects: { accumulatedSeconds: number }[] = [];
let mockTodayFocusSeconds = 0;
jest.mock('@/store/FocusContext', () => ({
  useFocus: () => ({ todayFocusSeconds: mockTodayFocusSeconds }),
}));
jest.mock('@/store/SubjectContext', () => ({ useSubjects: () => ({ subjects: mockSubjects }) }));
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
  mockSubjects = [];
  mockTodayFocusSeconds = 0;
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

  // 스켈레톤은 **아는 값만** 그린다. 순서를 모르는 동안 기본 순서로 먼저 그려 두면, 저장된
  // 순서가 도착하는 순간 로딩이 끝나지도 않았는데 스켈레톤이 한 번 뒤섞인다 — 큰 카드를 위로
  // 올려 둔 사용자에겐 그 자리에서 화면 대부분이 밀린다(codex 리뷰).
  test('카드 순서를 읽기 전에는 스켈레톤도 그리지 않는다', async () => {
    let release: (v: string | null) => void = () => {};
    // ⚠️ `spyOn(...).mockReturnValue`는 쓰지 않는다 — async-storage 목의 메서드가 이미 jest.fn이라
    //    `restoreAllMocks()`로 되돌아가지 않고 뒤 테스트까지 오염된다(실제로 겪음).
    //    화면이 이 키를 한 번만 읽으므로 `mockReturnValueOnce`면 스스로 원복된다.
    (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    const view = await render(<StatsScreen />);
    expect(screen.queryByTestId('stats.skeleton', HIDDEN)).toBeNull();

    await act(async () => {
      release(JSON.stringify({ WEEK: ['firstStart', 'total'] }));
    });
    await waitFor(() => expect(screen.queryByTestId('stats.skeleton', HIDDEN)).not.toBeNull());
    // 처음 그려지는 순간부터 저장된 순서다 — 다시 섞이는 단계가 없다
    const keys = screen
      .getAllByTestId(/^stats\.skeleton\./, HIDDEN)
      .map((n) => String(n.props.testID).replace('stats.skeleton.', ''));
    expect(keys[0]).toBe('firstStart');
    view.unmount();
  });

  // 일 탭 도넛은 총계와 과목 합의 차이를 '미분류' 행으로 하나 더 그린다(SubjectDonut).
  // 둘 다 로컬 Context 값이라 로딩 중에도 정확히 알 수 있는데, 이걸 안 세면 태그 미귀속
  // 세션이 있는 사용자의 도넛 스켈레톤이 늘 한 행 짧다(codex 리뷰).
  test('일 탭에서 미분류 시간이 있으면 도넛 스켈레톤이 그만큼 높다', async () => {
    // 범례가 링(132px)을 넘는 6줄 구간이어야 행 추가가 높이에 반영된다
    mockSubjects = Array.from({ length: 6 }, () => ({ accumulatedSeconds: 600 }));
    mockTodayFocusSeconds = 6 * 600 + 300; // 태그 미귀속 5분 → 범례 한 줄 추가
    const view = await render(<StatsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('stats.tab.day'));
    });
    // 일 탭으로 실제 넘어갔다는 근거 — 타임테이블 자리표시자는 일 탭에만 있다
    expect(screen.queryByTestId('stats.skeleton.timetable', HIDDEN)).not.toBeNull();

    const donut = (unclassifiedRow: boolean) =>
      skeletonCards({
        period: 'DAY',
        calendarRows: 0,
        screenWidth: Dimensions.get('window').width,
        subjectCount: 6,
        unclassifiedRow,
      }).find((c) => c.key === 'category')!.height;
    const rendered = StyleSheet.flatten(
      screen.getByTestId('stats.skeleton.category', HIDDEN).props.style,
    ).height;
    expect(rendered).toBe(donut(true));
    expect(rendered).toBeGreaterThan(donut(false));
    // ⚠️ 타임테이블 범례엔 미분류가 없다 — 같이 키우면 이번엔 그쪽이 수축한다.
    //    (미분류 유무로 도넛만 달라진다는 것 자체는 StatsSkeleton.test.tsx가 잠근다)
    expect(
      StyleSheet.flatten(screen.getByTestId('stats.skeleton.timetable', HIDDEN).props.style).height,
    ).toBe(
      skeletonCards({
        period: 'DAY',
        calendarRows: 0,
        screenWidth: Dimensions.get('window').width,
        subjectCount: 6,
      }).find((c) => c.key === 'timetable')!.height,
    );
    view.unmount();
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
