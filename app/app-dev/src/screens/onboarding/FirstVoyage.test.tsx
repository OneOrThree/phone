import React, { useReducer } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import { initialState, reducer } from '@/services/model';
import { request } from '@/services/api/client';
import { FIRST_VOYAGE_DONE, prepareFirstVoyage, readFirstVoyage } from '@/services/firstVoyage';
import { useTelescope } from '@/screens/island/useTelescope';
import type { TelescopeItem } from '@/services/api/telescope';
import { OnboardingFlow } from './OnboardingFlow';
import { Telescope } from '@/screens/island/Telescope';
import { MotionContext } from '@/design-system/primitives';

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
function Harness({ telescope = false }: { telescope?: boolean }) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState(),
    name: '하루',
    onboardingStory: 'scope' as const,
  });
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
      {telescope ? <Telescope e={e} /> : <OnboardingFlow e={e} />}
    </MotionContext.Provider>
  );
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockGeneration = 1;
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
