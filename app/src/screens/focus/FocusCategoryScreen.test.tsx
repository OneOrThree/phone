// FocusCategoryScreen — 잠그는 규칙: '동작 줄이기' 설정이 **확정되기 전에는**(콜드 스타트의
// 비동기 조회 구간) 과목 선택 시퀀스(알약 슬라이드 → 타이머 방식 시트)를 시작하지 않는다
// (codex 리뷰, PR #558). 미확정 구간의 useReduceMotion은 보수적으로 true라, 그대로 시작하면
// 대기가 0으로 눌려 설정을 켜지 않은 사용자도 연출을 통째로 잃는다. 일회성 시퀀스라
// 나중에 false로 확정돼도 되돌릴 수 없다.
//
// ⚠️ 애니메이션 중간 프레임·이징은 단언하지 않는다 — jest에서 워클릿·CSS 전환은 목이다.
//    여기서 보는 건 "시퀀스가 언제 시작·완주하는가"라는 순서 계약뿐이다.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import FocusCategoryScreen from './FocusCategoryScreen';
import type { Subject } from './types';

let mockReduce = true;
let mockReady = false;
let mockRouteParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockAddNavigationListener = jest.fn();
let mockAppStateHandler: ((state: AppStateStatus) => void) | null = null;
let mockBlurHandler: (() => void) | null = null;
const mockNavigation = {
  navigate: mockNavigate,
  goBack: jest.fn(),
  setParams: mockSetParams,
  addListener: mockAddNavigationListener,
};
// ⚠️ 두 export를 모두 목킹해야 한다 — 하나만 두면 나머지를 쓰는 코드가 undefined를 부른다.
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => mockReady,
  whenReduceMotionReady: () => Promise.resolve(),
}));

// 네이티브 리퀴드 글래스는 jest에서 로드할 수 없다 — 대기 시간(SLIDE_MS)만 고정값으로 준다.
const MOCK_SLIDE_MS = 350;
jest.mock('@/components/liquidGlass', () => ({
  SLIDE_MS: 350,
  glassSlide: {},
  glassPill: {},
}));
const WAIT_MS = MOCK_SLIDE_MS + 60;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: RNView,
  };
});

jest.mock('@/utils/sound', () => ({ playTapSound: jest.fn(), preloadTapSound: jest.fn() }));
jest.mock('@/utils/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticSelect: jest.fn(),
}));
jest.mock('@/services/analyticsEvents', () => ({
  logFocusTagCreated: jest.fn(),
  logFocusTagUpdated: jest.fn(),
  logFocusTagDeleted: jest.fn(),
}));
jest.mock('@/services/focusApi', () => ({
  getDefaultTags: jest.fn(() => Promise.resolve({ tags: [] })),
}));
// 카테고리 미설정으로 확정 — 추천 과목 조회 분기를 타지 않게 해 시퀀스만 남긴다.
jest.mock('@/hooks/useFocusCategory', () => ({ useFocusCategory: () => null }));
jest.mock('@/components/TabGuideOverlay', () => ({ TabGuideOverlay: () => null }));

const SUBJECTS: Subject[] = [
  { id: 's1', name: '수학', accumulatedSeconds: 0, color: '#FFB4A2' },
  { id: 's2', name: '영어', accumulatedSeconds: 0, color: '#A2D2FF' },
];
jest.mock('@/store/SubjectContext', () => ({
  useSubjects: () => ({
    subjects: [
      { id: 's1', name: '수학', accumulatedSeconds: 0, color: '#FFB4A2' },
      { id: 's2', name: '영어', accumulatedSeconds: 0, color: '#A2D2FF' },
    ],
    ready: true,
    addSubject: jest.fn(),
    renameSubject: jest.fn(),
    deleteSubject: jest.fn(),
    deleteSubjects: jest.fn(),
    reorderSubjects: jest.fn(),
    setSubjectColor: jest.fn(),
    addFocusToSubject: jest.fn(),
  }),
}));
jest.mock('@/store/FocusContext', () => ({ useFocus: () => ({ removeFocusSeconds: jest.fn() }) }));

// 과목 목록은 드래그·측정이 얽혀 있어 jest에서 그대로 쓰기 어렵다 — 이 테스트가 보는 건
// "행 탭 → 시퀀스" 배선이므로, 탭만 올려 보내고 현재 선택(activeId)을 드러내는 스텁으로 바꾼다.
jest.mock('./components/DraggableSubjectRows', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    DraggableSubjectRows: ({
      subjects,
      activeId,
      onPressRow,
    }: {
      subjects: { id: string; name: string }[];
      activeId?: string;
      onPressRow: (s: unknown) => void;
    }) =>
      mockReact.createElement(
        View,
        null,
        mockReact.createElement(Text, { testID: 'rows.activeId' }, activeId ?? ''),
        subjects.map((s) =>
          mockReact.createElement(
            Text,
            { key: s.id, testID: `row.${s.id}`, onPress: () => onPressRow(s) },
            s.name,
          ),
        ),
      ),
  };
});
// 시트가 열렸는지만 보면 되므로 껍데기로 바꾼다(실제 시트는 자체 테스트가 있다).
jest.mock('./components/TimerMethodSheet', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    TimerMethodSheet: () => mockReact.createElement(Text, { testID: 'method.sheet' }, 'method'),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockReduce = true;
  mockReady = false;
  mockRouteParams = undefined;
  mockAppStateHandler = null;
  mockBlurHandler = null;
  mockAddNavigationListener.mockImplementation((event: string, handler: () => void) => {
    if (event === 'blur') mockBlurHandler = handler;
    return jest.fn();
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    mockAppStateHandler = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

async function renderScreen() {
  const view = await render(<FocusCategoryScreen />);
  return { rerender: () => view.rerender(<FocusCategoryScreen />) };
}

// 첫 과목(s1)이 기본 선택이라, 다른 과목(s2)을 눌러야 알약이 이동하는 시퀀스를 탄다.
const pressOther = () => fireEvent.press(screen.getByTestId(`row.${SUBJECTS[1].id}`));
// 기본 선택과 같은 과목(s1) — 알약이 움직이지 않으므로 기다릴 연출이 없다.
const pressSame = () => fireEvent.press(screen.getByTestId(`row.${SUBJECTS[0].id}`));

test('카드 focus CTA 문맥은 앱 비활성 전환에서 즉시 취소한다', async () => {
  mockRouteParams = {
    entrySource: 'group_card',
    interactionId: 'interaction-1',
    interactionAcceptedAt: Date.now(),
  };
  await renderScreen();

  await act(async () => mockAppStateHandler?.('background'));

  expect(mockSetParams).toHaveBeenCalledWith({
    interactionId: undefined,
    interactionAcceptedAt: undefined,
  });
});

test('카드 focus CTA 문맥은 route blur에서도 즉시 취소한다', async () => {
  mockRouteParams = {
    entrySource: 'group_card',
    interactionId: 'interaction-before-blur',
    interactionAcceptedAt: Date.now(),
  };
  await renderScreen();

  await act(async () => mockBlurHandler?.());

  expect(mockSetParams).toHaveBeenCalledWith({
    interactionId: undefined,
    interactionAcceptedAt: undefined,
  });
});

describe('FocusCategoryScreen 과목 선택 시퀀스 게이트', () => {
  test('설정이 확정되기 전에는 시퀀스를 시작하지 않는다', async () => {
    await renderScreen();
    await pressOther();
    // 선택 반영도 미룬다 — 알약을 먼저 옮기면 확정된 뒤엔 미끄러질 자리가 남지 않는다.
    expect(screen.getByTestId('rows.activeId').props.children).toBe('s1');
    expect(screen.queryByTestId('method.sheet')).toBeNull();
    await advance(WAIT_MS * 5);
    expect(screen.queryByTestId('method.sheet')).toBeNull();
  });

  test('확정되면 보류해 둔 탭이 확정된 값으로 진행한다 — 확정 전 탭도 씹히지 않는다', async () => {
    const { rerender } = await renderScreen();
    await pressOther();
    // 미확정 구간에서는 시간이 아무리 흘러도 시퀀스가 시작되지 않는다(대기가 0으로 눌리지 않았다).
    await advance(WAIT_MS * 5);
    expect(screen.queryByTestId('method.sheet')).toBeNull();

    // 실제 설정은 꺼져 있었다 — 확정되면 알약이 미끄러질 시간을 기다렸다가 시트를 연다.
    mockReady = true;
    mockReduce = false;
    await rerender();
    expect(screen.getByTestId('rows.activeId').props.children).toBe('s2');
    expect(screen.queryByTestId('method.sheet')).toBeNull();

    await advance(WAIT_MS);
    expect(screen.getByTestId('method.sheet')).toBeTruthy();
  });

  test('reduce=true로 확정되면 기다릴 연출이 없어 곧바로 시트가 열린다', async () => {
    mockReady = true;
    mockReduce = true;
    await renderScreen();
    await pressOther();
    await advance(0);
    expect(screen.getByTestId('method.sheet')).toBeTruthy();
  });

  // ⚠️ 같은 과목 재탭은 알약이 움직이지 않는다 = 기다릴 연출이 없다. 확정 대기에 묶으면
  //    콜드 스타트에서 탭이 무반응으로 보인다(codex 리뷰).
  test('확정 전이어도 같은 과목 재탭은 곧바로 시트가 열린다', async () => {
    await renderScreen();
    await pressSame();
    expect(screen.getByTestId('method.sheet')).toBeTruthy();
  });

  // ⚠️ 대기 시간은 예약할 때 한 번 계산된다. 재생 도중 '동작 줄이기'를 켜면 알약은 이미
  //    제자리인데 아무 일도 없는 410ms가 그대로 남는다(codex 리뷰).
  test('재생 도중 동작 줄이기를 켜면 남은 대기를 버리고 즉시 연다', async () => {
    mockReady = true;
    mockReduce = false;
    const { rerender } = await renderScreen();
    await pressOther();
    await advance(100); // 아직 410ms 전 — 시트는 닫혀 있다
    expect(screen.queryByTestId('method.sheet')).toBeNull();

    mockReduce = true; // 사용자가 재생 도중 설정을 켰다
    await rerender();
    expect(screen.getByTestId('method.sheet')).toBeTruthy();
  });
});
