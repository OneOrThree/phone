import { MotionContext } from '@/design-system/primitives';
import { createPreviewEnvironment } from '@/navigation/previewEnvironment';
import { Telescope } from '@/screens/island/Telescope';
import { RedesignScreens } from '@/screens/island/Screens';
import { useTelescope } from '@/screens/island/useTelescope';
import { ApiError, request } from '@/services/api/client';
import type { TelescopeItem } from '@/services/api/telescope';
import { FIRST_VOYAGE_DONE, prepareFirstVoyage, readFirstVoyage } from '@/services/firstVoyage';
import { metaContext } from '@/services/metaSdk';
import { initialState, reducer, type State } from '@/services/model';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useReducer } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { OnboardingFlow } from './OnboardingFlow';

jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  request: jest.fn(),
}));
let mockGeneration = 1;
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  getSession: () => ({ userId: 'first-user' }),
  sessionGeneration: () => mockGeneration,
}));
jest.mock('@/screens/island/useTelescope', () => ({ useTelescope: jest.fn() }));
jest.mock('@/screens/island/sceneKit', () => ({ useGowun: () => 'Gowun' }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/screens/sea/SeaScene', () => ({
  SeaScene: ({ participants }: any) => {
    const { Text, View } = require('react-native');
    return (
      <View testID="example-people">
        {participants.map((person: any) => (
          <Text key={person.userId}>{person.name}</Text>
        ))}
      </View>
    );
  },
}));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));
jest.mock('@/services/metaSdk', () => ({ metaContext: jest.fn() }));
jest.mock('./StoryRaft', () => ({ StoryRaft: () => null, storyCats: {} }));
const destination: TelescopeItem = {
  islandId: 'candidate',
  name: '무인도',
  sailingMinutes: 15,
  intro: '',
  memberCount: 0,
  maxMembers: 10,
  buildingCount: 0,
  approvalRequired: false,
  membershipStatus: 'none',
  slot: 'uninhabited',
  averageFocusMinutesPerDay: null,
  full: false,
  arrivedBefore: false,
};
const reset = jest.fn(),
  startSea = jest.fn(),
  sync = jest.fn(),
  visit = jest.fn();
let dispatched: any[] = [];
let currentState: State;
function Harness({ telescope = false, routed = false }: { telescope?: boolean; routed?: boolean }) {
  const [state, baseDispatch] = useReducer(reducer, {
    ...initialState(),
    name: '하루',
    color: 'white' as const,
    onboardingStory: 'scope' as const,
  });
  currentState = state;
  const dispatch = (a: any) => {
    dispatched.push(a);
    baseDispatch(a);
  };
  const e = {
    state,
    dispatch,
    reset,
    islands: { sync, visit },
    focus: { startSea },
    back: jest.fn(),
    notify: jest.fn(),
  };
  return (
    <MotionContext.Provider value={true}>
      {routed ? (
        <RedesignScreens e={createPreviewEnvironment({ ...e, route: 'character' })} />
      ) : telescope ? (
        <Telescope e={createPreviewEnvironment(e)} />
      ) : (
        <OnboardingFlow e={createPreviewEnvironment(e)} />
      )}
    </MotionContext.Provider>
  );
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockGeneration = 1;
  (metaContext as jest.Mock).mockReset().mockResolvedValue(undefined);
  dispatched = [];
  await AsyncStorage.clear();
  (useTelescope as jest.Mock).mockReturnValue({
    items: [destination],
    status: 'ready',
    reload: jest.fn(),
  });
  (request as jest.Mock).mockResolvedValue({
    islandId: 'real-island',
    membershipStatus: 'active',
    currentIslandId: 'real-island',
    arrivedBefore: false,
  });
  sync.mockResolvedValue({});
  visit.mockResolvedValue({});
});
afterEach(() => jest.useRealTimers());
const elapse = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

test('첫 선택은 시간을 숨기고 한 명을 보여 준 뒤 5초 후 실제 섬에 도착한다', async () => {
  const screen = await render(<Harness />);
  expect(screen.getByTestId('onboarding-island-candidate').props.accessibilityLabel).toBe('무인도');
  expect(screen.queryByText(/15분/)).toBeNull();
  await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
  expect(screen.getByTestId('first-voyage')).toBeTruthy();
  expect(screen.getByText('두부', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText(/처음 보는 친구/)).toBeTruthy();
  await elapse(4999);
  expect(request).not.toHaveBeenCalled();
  await elapse(1);
  expect(request).toHaveBeenCalledWith(
    '/islands/candidate/intro-arrivals',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(startSea).not.toHaveBeenCalled();
  expect(reset).toHaveBeenCalledWith('home', undefined);
  expect(await AsyncStorage.getItem(FIRST_VOYAGE_DONE)).toBe('1');
});

test.each([false, true])(
  '첫 도착으로 소속이 생겨도 이름·털색을 다시 묻지 않고 완료한다 (목록 동기화 실패: %s)',
  async (syncFails) => {
    let finishSync!: () => void;
    sync.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finishSync = () => (syncFails ? reject(new Error('offline')) : resolve({}));
        }),
    );
    const screen = await render(<Harness routed />);
    await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await elapse(5000);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(currentState.onboarded).toBe(true);
    expect(screen.queryByText('내 고양이와 시작')).toBeNull();
    expect(screen.getByTestId('first-voyage')).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();

    await act(async () => finishSync());

    expect(reset).toHaveBeenCalledWith('home', undefined);
    expect(await AsyncStorage.getItem(FIRST_VOYAGE_DONE)).toBe('1');
    expect((await readFirstVoyage('first-user')).pending).toBeNull();
    expect(currentState.onboardingStory).toBe('done');
    expect(currentState.name).toBe('하루');
    expect(currentState.color).toBe('white');
    expect(dispatched).toContainEqual({ type: 'ISLAND_NAMING', islandId: 'real-island' });
  },
);

describe.each([
  [
    'meta가 있으면 본문에 싣는다',
    () => (metaContext as jest.Mock).mockResolvedValue({ anonId: 'a' }),
    { meta: { anonId: 'a' } },
  ],
  [
    'meta가 없으면 본문을 비운다',
    () => (metaContext as jest.Mock).mockResolvedValue(undefined),
    undefined,
  ],
  [
    'meta가 던져도 도착은 간다',
    () => (metaContext as jest.Mock).mockRejectedValue(new Error('x')),
    undefined,
  ],
  [
    'meta가 멈추면 3초 뒤 meta 없이 도착한다',
    () => (metaContext as jest.Mock).mockReturnValue(new Promise(() => {})),
    undefined,
  ],
])('도착 요청 본문: %s', (_name, arrange, body) => {
  test('본문', async () => {
    arrange();
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await elapse(5000);
    await elapse(2999);
    if (_name.includes('멈추면')) expect(request).not.toHaveBeenCalled();
    await elapse(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect((request as jest.Mock).mock.calls[0][1].body).toEqual(body);
  });
});

test('도착까지 남은 초를 5부터 1까지 실제로 센다', async () => {
  const screen = await render(<Harness />);
  await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
  expect(screen.getByText('5초 뒤 도착해.')).toBeTruthy();
  for (const left of [4, 3, 2, 1]) {
    await elapse(1000);
    expect(screen.getByText(`${left}초 뒤 도착해.`)).toBeTruthy();
  }
  expect(request).not.toHaveBeenCalled();
  await elapse(1000);
  expect(screen.queryByText(/초 뒤 도착해/)).toBeNull();
  expect(request).toHaveBeenCalled();
});

test('화면 읽기는 남은 초를 처음 한 번만 읽고 매초 다시 읽지 않는다', async () => {
  // 프리셋의 jest.fn 구현을 지우지 않도록 원래 구현을 보관했다가 되돌린다.
  const isEnabled = AccessibilityInfo.isScreenReaderEnabled as unknown as jest.Mock;
  const original = isEnabled.getMockImplementation();
  isEnabled.mockImplementation(() => Promise.resolve(true));
  try {
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await elapse(0);
    await elapse(4000);
    expect(screen.getByText('1초 뒤 도착해.').props.accessibilityLiveRegion).toBe('none');
    const reads = (AccessibilityInfo.announceForAccessibility as jest.Mock).mock.calls.filter(
      ([text]) => /초 뒤 도착해/.test(text),
    );
    expect(reads).toEqual([['5초 뒤 도착해.']]);
  } finally {
    isEnabled.mockImplementation(original);
  }
});

test('백그라운드에 간 동안은 남은 초가 멈췄다가 돌아오면 이어서 센다', async () => {
  // RN jest 프리셋의 addEventListener 는 이미 jest.fn 이라 spyOn·mockRestore 를 쓰면 구현이 지워진다.
  const addListener = AppState.addEventListener as unknown as jest.Mock;
  const original = addListener.getMockImplementation();
  const listeners: ((state: string) => void)[] = [];
  addListener.mockImplementation((type: string, fn: (state: string) => void) => {
    listeners.push(fn);
    return original ? original(type, fn) : { remove: jest.fn() };
  });
  const appState = (state: string) => act(async () => listeners.forEach((fn) => fn(state)));
  try {
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await elapse(1500);
    expect(screen.getByText('4초 뒤 도착해.')).toBeTruthy();
    await appState('background');
    await elapse(10000);
    expect(screen.getByText('4초 뒤 도착해.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    await appState('active');
    await elapse(500);
    expect(screen.getByText('3초 뒤 도착해.')).toBeTruthy();
    await elapse(2999);
    expect(request).not.toHaveBeenCalled();
    await elapse(1);
    expect(request).toHaveBeenCalled();
  } finally {
    addListener.mockImplementation(original);
  }
});

test('무인도 첫 도착이면 홈 이름 짓기 모달 트리거(ISLAND_NAMING)를 띄운다', async () => {
  const screen = await render(<Harness />);
  await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
  await elapse(5000);
  // 생성된 실제 섬 id 로 이름 짓기 전이 상태를 둔다 — 일반 바다 항해의 createdIsland 경로와 같은 모달.
  expect(dispatched).toContainEqual({ type: 'ISLAND_NAMING', islandId: 'real-island' });
  expect(reset).toHaveBeenCalledWith('home', undefined);
});

test('실패 재시도는 같은 키를 사용하고 성공 전에는 완료하지 않는다', async () => {
  (request as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  const screen = await render(<Harness />);
  await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
  await elapse(5000);
  expect((await readFirstVoyage('first-user')).eligible).toBe(true);
  await fireEvent.press(screen.getByTestId('first-voyage-retry'));
  expect((request as jest.Mock).mock.calls[0]).toEqual((request as jest.Mock).mock.calls[1]);
  expect(reset).toHaveBeenCalledWith('home', undefined);
});

test('재시작 뒤 일반 망원경에서도 보류된 이동을 복원한다', async () => {
  await prepareFirstVoyage('first-user', destination);
  const screen = await render(<Harness telescope />);
  expect(screen.getByTestId('first-voyage')).toBeTruthy();
  await elapse(5000);
  expect(reset).toHaveBeenCalledWith('home', undefined);
});

test('계정 세대가 바뀐 응답으로 이동하거나 완료하지 않는다', async () => {
  let resolve!: (value: unknown) => void;
  (request as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const screen = await render(<Harness />);
  await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
  await elapse(5000);
  mockGeneration++;
  await act(async () =>
    resolve({
      islandId: 'real-island',
      membershipStatus: 'active',
      currentIslandId: 'real-island',
    }),
  );
  expect(reset).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(FIRST_VOYAGE_DONE)).toBeNull();
});

test('일반 망원경의 첫 이동도 섬 아래 시간을 숨기고 체험으로 연결한다', async () => {
  const screen = await render(<Harness telescope />);
  expect(screen.queryByText(/15분/)).toBeNull();
  await fireEvent.press(screen.getByTestId('telescope-island-candidate'));
  await fireEvent.press(screen.getByText('이 섬으로 가기'));
  expect(screen.getByTestId('first-voyage')).toBeTruthy();
});

test.each([
  ['FACILITY_LOCKED', 403],
  ['ISLAND_LIMIT_EXCEEDED', 409],
  ['RESOURCE_NOT_FOUND', 404],
] as const)('%s 확정 거절은 완료하지 않고 목적지를 다시 선택할 수 있다', async (code, status) => {
  (request as jest.Mock).mockRejectedValueOnce(new ApiError(code, '이동할 수 없어요', status));
  const screen = await render(<Harness />);
  await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
  await fireEvent.press(screen.getByTestId('onboarding-continue'));
  await elapse(5000);
  expect(await AsyncStorage.getItem(FIRST_VOYAGE_DONE)).toBeNull();
  await fireEvent.press(screen.getByText('다른 섬 고르기'));
  expect(screen.queryByTestId('first-voyage')).toBeNull();
  expect((await readFirstVoyage('first-user')).pending).toBeNull();
});

test.each(['SERVICE_UNAVAILABLE', 'UPSTREAM_TIMEOUT'])(
  '%s 결과 불명은 HTTP 400이어도 같은 키를 보존한다',
  async (code) => {
    (request as jest.Mock).mockRejectedValueOnce(new ApiError(code, '연결 확인 중', 400));
    const screen = await render(<Harness />);
    await fireEvent.press(screen.getByTestId('onboarding-island-candidate'));
    await fireEvent.press(screen.getByTestId('onboarding-continue'));
    await elapse(5000);
    expect(screen.queryByText('다른 섬 고르기')).toBeNull();
    const saved = (await readFirstVoyage('first-user')).pending;
    expect(saved?.key).toBe((request as jest.Mock).mock.calls[0][1].idempotencyKey);
    await fireEvent.press(screen.getByTestId('first-voyage-retry'));
    expect((request as jest.Mock).mock.calls[0]).toEqual((request as jest.Mock).mock.calls[1]);
  },
);
