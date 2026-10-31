import React, { useReducer } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { initialState, reducer, type State } from '@/services/model';
import { updateProfile } from '@/services/api/account';
import { ApiError } from '@/services/api/client';
import { useTelescope } from '@/screens/island/useTelescope';
import { OnboardingFlow } from './OnboardingFlow';
import { applyLocalePref } from '@/i18n';
import { ISLAND_STAGE_ART } from '@/constants/magazineAssets';
import type { TelescopeItem } from '@/services/api/telescope';

const mockCapture = jest.fn();
jest.mock('@/services/posthog', () => ({
  captureProductEvent: (...a: unknown[]) => mockCapture(...a),
}));
jest.mock('@/services/api/account', () => ({ updateProfile: jest.fn() }));
jest.mock('@/screens/island/useTelescope', () => ({ useTelescope: jest.fn() }));
jest.mock('@/screens/island/sceneKit', () => ({ useGowun: () => 'Gowun' }));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));
let mockGeneration = 1;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('./StoryRaft', () => ({
  StoryRaft: () => null,
  storyCats: { black: 1, ginger: 1, cream: 1, gray: 1, white: 1, calico: 1 },
}));
const destination: TelescopeItem = {
  islandId: 'island-1',
  name: '별빛섬',
  sailingMinutes: 15,
  intro: '',
  memberCount: 1,
  maxMembers: 10,
  buildingCount: 1,
  approvalRequired: false,
  membershipStatus: 'none',
  slot: 'nearby',
  averageFocusMinutesPerDay: null,
  full: false,
  arrivedBefore: false,
};
const reset = jest.fn(),
  startSea = jest.fn(),
  recover = jest.fn();
let current: State;
function Harness({
  checkpoint,
  savedName = '',
}: {
  checkpoint?: State['onboardingStory'];
  savedName?: string;
}) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState(),
    name: savedName,
    onboardingStory: checkpoint,
  });
  current = state;
  return (
    <MotionContext.Provider value={true}>
      <OnboardingFlow
        e={{
          state,
          dispatch,
          reset,
          now: Date.now(),
          back: jest.fn(),
          islands: {},
          focus: { startSea, recover },
        }}
      />
    </MotionContext.Provider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration = 1;
  applyLocalePref('ko');
  (useTelescope as jest.Mock).mockImplementation(({ active }) => ({
    items: active ? [destination] : [],
    status: 'ready',
    reload: jest.fn(),
  }));
  (updateProfile as jest.Mock).mockImplementation(async (body) => ({
    ...body,
    name: body.name,
    catColor: body.catColor,
  }));
});
const pressContinue = async (screen: Awaited<ReturnType<typeof render>>) =>
  fireEvent.press(screen.getByTestId('onboarding-continue'));

test('장면 진입마다 onboarding_scene_viewed 를 storySteps 인덱스와 함께 1회 발행한다', async () => {
  const screen = await render(<Harness />);
  expect(mockCapture.mock.calls).toEqual([
    ['onboarding_scene_viewed', { scene: 'choose', scene_index: 0 }],
  ]);
  await fireEvent.press(screen.getByTestId('onboarding-choose-next'));
  expect(mockCapture.mock.calls).toEqual([
    ['onboarding_scene_viewed', { scene: 'choose', scene_index: 0 }],
    ['onboarding_scene_viewed', { scene: 'arrival', scene_index: 1 }],
  ]);
});

test('선택한 색과 이름을 함께 저장하고 건너뛰면 망원경 체크포인트로 이동한다', async () => {
  const screen = await render(<Harness />);
  expect(current.onboardingStory).toBe('intro');
  await fireEvent.press(screen.getByTestId('onboarding-cat-calico'));
  await fireEvent.press(screen.getByTestId('onboarding-choose-next'));
  // 첫 바다는 안내·건너뛰기 없이 고양이만 보여 준다.
  expect(screen.queryByTestId('onboarding-skip')).toBeNull();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1250));
  });
  await fireEvent.press(screen.getByTestId('onboarding-skip'));
  expect(screen.getByTestId('onboarding-name')).toBeTruthy();
  expect(screen.queryByTestId('onboarding-skip')).toBeNull();
  for (const value of [
    ' 하 루 ',
    '하\t루',
    '하\n루',
    '하\u3000루',
    '하\u00a0루',
    '하\u0085루',
    '하\ufeff루',
    '하\u2028루',
    '하\u202f루',
  ]) {
    await fireEvent.changeText(screen.getByTestId('onboarding-name'), value);
    expect(screen.getByTestId('onboarding-name').props.value).toBe('하루');
  }
  await pressContinue(screen);
  expect(updateProfile).toHaveBeenCalledWith(
    { name: '하루', catColor: 'calico' },
    expect.any(String),
  );
  expect(current.name).toBe('하루');
  expect(current.color).toBe('calico');
  expect(current.onboardingStory).toBe('scope');
  expect(screen.getByTestId('onboarding-scope')).toBeTruthy();
});

test('프로필 저장 실패는 이름 입력을 유지하고 같은 의도 키로 재시도한다', async () => {
  (updateProfile as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  const screen = await render(<Harness savedName="하루" />);
  await fireEvent.press(screen.getByTestId('onboarding-choose-next'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1250));
  });
  await fireEvent.press(screen.getByTestId('onboarding-skip'));
  await pressContinue(screen);
  expect(current.onboardingStory).toBe('intro');
  await pressContinue(screen);
  const calls = (updateProfile as jest.Mock).mock.calls;
  expect(calls[0][1]).toBe(calls[1][1]);
  expect(current.onboardingStory).toBe('scope');
});

const openName = async (screen: Awaited<ReturnType<typeof render>>) => {
  await fireEvent.press(screen.getByTestId('onboarding-choose-next'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1250));
  });
  await fireEvent.press(screen.getByTestId('onboarding-skip'));
};

test('닉네임 형식 거절은 서버 메시지를 이름 칸 아래에 표시하고 편집하면 지운다', async () => {
  const message = '서버가 보낸 닉네임 형식 안내';
  (updateProfile as jest.Mock).mockRejectedValueOnce(
    new ApiError('NICKNAME_INVALID', message, 400),
  );
  const screen = await render(<Harness savedName="하루" />);
  await openName(screen);
  await pressContinue(screen);

  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(current.onboardingStory).toBe('intro');
  expect(screen.getByTestId('onboarding-name').props.value).toBe('하루');
  await fireEvent.changeText(screen.getByTestId('onboarding-name'), '새 이름');
  expect(screen.getByTestId('onboarding-name').props.value).toBe('새이름');
  expect(screen.queryByText(message)).toBeNull();
});

test('기존 공백 닉네임은 입력을 바꾸지 않으면 저장 요청과 저장된 상태에서 그대로 유지한다', async () => {
  const legacy = '\u00a0하루\ufeff';
  const screen = await render(<Harness savedName={legacy} />);
  await openName(screen);
  expect(screen.getByTestId('onboarding-name').props.value).toBe(legacy);
  await pressContinue(screen);

  expect(updateProfile).toHaveBeenCalledWith(
    expect.objectContaining({ name: legacy }),
    expect.any(String),
  );
  expect(current.name).toBe(legacy);
});

test('망원경 재진입은 안내부터 시작하며 실제 세션 시작 성공 뒤에만 완료한다', async () => {
  startSea.mockResolvedValue({ id: 's1', kind: 'sea', islandId: 'island-1' });
  const screen = await render(<Harness checkpoint="scope" savedName="하루" />);
  expect(screen.getByTestId('onboarding-scope')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('onboarding-island-island-1'));
  expect(current.onboardingStory).toBe('scope');
  await pressContinue(screen);
  expect(startSea).toHaveBeenCalledTimes(1);
  expect(startSea).toHaveBeenCalledWith('island-1');
  expect(current.onboardingStory).toBe('done');
  expect(screen.getByTestId('onboarding-depart')).toBeTruthy();
  expect(screen.getByText('별빛섬으로 가는 중')).toBeTruthy();
  await pressContinue(screen);
  expect(reset).toHaveBeenCalledWith('sea', '별빛섬');
});

test('출발 실패 시 완료하지 않고 목적지를 유지한다', async () => {
  startSea.mockRejectedValue(new Error('offline'));
  const screen = await render(<Harness checkpoint="scope" />);
  await fireEvent.press(screen.getByTestId('onboarding-island-island-1'));
  await pressContinue(screen);
  expect(current.onboardingStory).toBe('scope');
  expect(reset).not.toHaveBeenCalled();
  expect(screen.getByTestId('onboarding-ready')).toBeTruthy();
});

test('계정 세대가 바뀐 뒤 도착한 출항 응답은 진행도와 화면을 바꾸지 않는다', async () => {
  let resolve!: (value: unknown) => void;
  startSea.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const screen = await render(<Harness checkpoint="scope" />);
  await fireEvent.press(screen.getByTestId('onboarding-island-island-1'));
  const pressing = pressContinue(screen);
  await new Promise((r) => setTimeout(r, 0));
  mockGeneration++;
  await act(async () => {
    resolve({ id: 's1', kind: 'sea', islandId: 'island-1' });
    await new Promise((r) => setTimeout(r, 0));
  });
  await pressing;
  expect(current.onboardingStory).toBe('scope');
  expect(reset).not.toHaveBeenCalled();
  // 같은 사용자 ID로 세대만 바뀌어 화면이 유지돼도 대기 상태가 남지 않는다.
  startSea.mockResolvedValue({ id: 's2', kind: 'sea', islandId: 'island-1' });
  await pressContinue(screen);
  expect(startSea).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('onboarding-depart')).toBeTruthy();
});

test.each(['focus', 'rest', 'sea'])(
  '다른 기기의 %s 충돌은 기존 세션으로 복구하며 바다 항해만 완료 처리한다',
  async (route) => {
    startSea.mockRejectedValue({ code: 'STATE_CONFLICT' });
    recover.mockResolvedValue(route);
    const screen = await render(<Harness checkpoint="scope" />);
    await fireEvent.press(screen.getByTestId('onboarding-island-island-1'));
    await pressContinue(screen);
    expect(reset).toHaveBeenCalledWith(route);
    expect(current.onboardingStory).toBe(route === 'sea' ? 'done' : 'scope');
  },
);

test.each([false, true])(
  '기존 섬이 없거나 모두 정원이 찼으면 무인도 하나로 15분 항해를 시작한다 (만원 섬: %s)',
  async (hasFullIsland) => {
    const deserted = {
      ...destination,
      islandId: 'reserved-island',
      name: '무인도',
      memberCount: 0,
      buildingCount: 0,
    };
    (useTelescope as jest.Mock).mockReturnValue({
      status: 'ready',
      items: [
        deserted,
        ...(hasFullIsland ? [{ ...destination, full: true, memberCount: 10 }] : []),
      ],
      reload: jest.fn(),
    });
    const screen = await render(<Harness checkpoint="scope" />);
    expect(screen.queryByTestId('onboarding-island-island-1')).toBeNull();
    expect(screen.getByLabelText('무인도까지 15분')).toBeTruthy();
    expect(screen.getByTestId('onboarding-island-art-reserved-island').props.source).toEqual(
      ISLAND_STAGE_ART.houses0,
    );
    await fireEvent.press(screen.getByTestId('onboarding-island-reserved-island'));
    startSea.mockResolvedValue({ kind: 'sea', islandId: deserted.islandId, targetMinutes: 15 });
    await pressContinue(screen);
    expect(startSea).toHaveBeenCalledWith('reserved-island');
    expect(current.onboardingStory).toBe('done');
    expect(screen.getByTestId('onboarding-depart')).toBeTruthy();
  },
);

test.each([
  ['정원이 남은 섬', { full: false }],
  ['이미 가입한 정원 찬 섬', { full: true, membershipStatus: 'active' }],
] as const)('첫 항해에서도 %s이 있으면 무인도를 숨긴다', async (_, available) => {
  (useTelescope as jest.Mock).mockReturnValue({
    items: [
      {
        ...destination,
        islandId: 'reserved-island',
        name: '무인도',
        memberCount: 0,
        buildingCount: 0,
      },
      { ...destination, ...available, memberCount: available.full ? 10 : 1 },
    ],
    status: 'ready',
    reload: jest.fn(),
  });
  const screen = await render(<Harness checkpoint="scope" />);
  expect(screen.getByTestId('onboarding-island-island-1')).toBeTruthy();
  expect(screen.queryByTestId('onboarding-island-reserved-island')).toBeNull();
});
