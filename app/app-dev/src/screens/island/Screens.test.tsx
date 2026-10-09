/**
 * GROMO-2006 화면 통합 회귀 — `e.islands` 서버 명령이 있을 때 Screens가
 * 로컬 성공 action을 부르지 않고 서버 콜백만으로 loading/error/retry/pending/cancel을 그리는지 고정한다.
 * api 목은 App 의 orchestration 과 같이 dispatch 로 스냅샷을 돌려준다.
 */
import assert from 'node:assert/strict';
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, View } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { RedesignScreens } from '@/screens/island/Screens';
import { art } from '@/constants/art';
import { buildingNames, initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';
import { createRouteTransitionShield } from '@/services/routeTransition';
import { RouteTransitionShield } from '@/components/RouteTransitionShield';
import { updateProfile, withdrawAccount } from '@/services/api/account';
import {
  clearLocalDataOwner,
  clearSession,
  getLastSessionUserId,
  rememberLocalDataOwner,
  saveSession,
} from '@/services/api/session';
import type { IslandSummary } from '@/services/api/islands';
import { applyLocalePref } from '@/i18n';

let mockFontScale = 1;
jest.mock('@/services/api/account', () => ({
  updateProfile: jest.fn(),
  withdrawAccount: jest.fn(),
}));
// 홈 위젯 비우기만 관찰한다 — 스냅샷 계산·전송(WorldMap)은 실제 구현(안드로이드 외 no-op)을 쓴다.
const mockClearStudyWidget = jest.fn().mockResolvedValue(false);
jest.mock('@/services/studyWidget', () => ({
  ...jest.requireActual('@/services/studyWidget'),
  clearStudyWidget: () => mockClearStudyWidget(),
}));
const mockUpdateProfile = updateProfile as jest.Mock;
const mockWithdrawAccount = withdrawAccount as jest.Mock;
const mockShopBuy = jest.fn();
const mockShopState: any = {
  items: [],
  detail: null,
  detailLoading: false,
  detailError: null,
  wallets: null,
  shared: null,
  my: null,
  writing: false,
  titles: {},
  kinds: {},
  orders: [],
  ordersLoading: false,
  ordersError: null,
  ordersScope: null,
  ordersNextCursor: null,
  buy: mockShopBuy,
  applyTheme: jest.fn(),
  equip: jest.fn(),
  retry: jest.fn(),
};
jest.mock('@/screens/island/useShop', () => ({ useShop: () => mockShopState }));
const notifyMock = jest.fn();
const backMock = jest.fn();
beforeEach(() => {
  mockUpdateProfile.mockReset();
  mockWithdrawAccount.mockReset();
  mockClearStudyWidget.mockClear();
  mockShopBuy.mockReset();
  Object.assign(mockShopState, {
    items: [],
    detail: null,
    detailLoading: false,
    detailError: null,
    wallets: null,
    shared: null,
    my: null,
    writing: false,
    titles: {},
    kinds: {},
    orders: [],
    ordersLoading: false,
    ordersError: null,
    ordersScope: null,
    ordersNextCursor: null,
  });
  notifyMock.mockClear();
  backMock.mockClear();
});
// 언어 화면 테스트가 i18n 모듈 싱글턴 상태를 건드릴 수 있어 매 테스트 뒤 되돌린다(T1 패턴과 동일).
const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;
afterEach(() => {
  applyLocalePref('system');
  mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]); // 이 파일 다른 테스트로 안 새게
});
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: mockFontScale,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

const islandSummary = (over: Partial<IslandSummary> = {}): IslandSummary => ({
  id: 'isl-1',
  name: '바람 섬',
  intro: '바람이 부는 섬',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 3,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});
const pendingReq = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  islandId: 'isl-9',
  status: 'pending' as const,
  version: 1,
  islandName: '승인 섬',
  memberCount: 2,
  maxMembers: 15,
  createdAt: '2026-09-21T00:00:00Z',
  ...over,
});

// 실제 reducer 로 state 를 돌리고 api 목이 dispatch 까지 하게 만든다(App orchestration 축약본).
function Harness({
  route,
  api,
  expose,
  seed,
  initial,
  bootError,
  startGuest,
  guestError,
  loginProviders,
  startSocial,
  detail: detailProp,
  full = false,
  flow = false,
  homeError = false,
  retryHome,
  friendsScreen,
  conversion,
  localePref = 'system',
}: any) {
  const [activeRoute, setActiveRoute] = useState(route);
  const [shielded, setShielded] = useState(false);
  const [state, baseDispatch] = useReducer(
    reducer,
    initial,
    // 신규 계정 기본값은 이름이 비어 있다 — 기존 시나리오는 이름이 있는 사용자로 시작한다.
    (value) => value ?? { ...initialState(full), name: '수빈', profileNames: ['수빈'] },
  );
  const actions = useRef<string[]>([]);
  const dispatch = useMemo(() => {
    const d = (a: any) => {
      actions.current.push(a.type);
      return baseDispatch(a);
    };
    return d;
  }, []);
  const [text, setText] = useState(''),
    [body, setBody] = useState(''),
    [terms, setTerms] = useState(false),
    [approval, setApproval] = useState(false),
    [detail] = useState(detailProp ?? '');
  const islands = useMemo(() => api?.(dispatch), []);
  const transitionShield = useRef(createRouteTransitionShield(setShielded)).current;
  const go = useRef(
    jest.fn((nextRoute: string) => {
      if (flow) {
        transitionShield();
        setActiveRoute(nextRoute);
      }
    }),
  ).current;
  const home = useRef(jest.fn()).current;
  const reset = useRef(jest.fn()).current;
  const signOut = useRef(jest.fn(async () => {})).current;
  const confirm = useRef(jest.fn((_title, _body, ok) => ok())).current;
  const setLocalePref = useRef(jest.fn()).current;
  useEffect(() => {
    seed?.(dispatch);
    expose?.({
      dispatch,
      actions: actions.current,
      go,
      home,
      reset,
      signOut,
      confirm,
      setLocalePref,
    });
  }, []);
  const screens = (
    <RedesignScreens
      e={{
        state,
        route: flow ? activeRoute : route,
        dispatch,
        go,
        replace: jest.fn(),
        reset,
        home,
        back: backMock,
        notify: notifyMock,
        confirm,
        signOut,
        build: jest.fn(),
        text,
        setText,
        body,
        setBody,
        tab: '',
        setTab: jest.fn(),
        detail,
        now: Date.now(),
        terms,
        setTerms,
        startGuest,
        guestError,
        loginProviders,
        startSocial,
        socialBusy: null,
        socialError: '',
        approval,
        setApproval,
        visited: '',
        setVisited: jest.fn(),
        guideStep: 0,
        setGuideStep: jest.fn(),
        player: { addListener: () => ({ remove() {} }), replace() {}, play() {}, pause() {} },
        previewAudio: false,
        setPreviewAudio: jest.fn(),
        walkTo: jest.fn(),
        newQuest: jest.fn(),
        walkRequest: null,
        islands,
        islandBootError: !!bootError,
        homeError,
        retryHome,
        friendsScreen,
        conversion,
        localePref,
        setLocalePref,
      }}
    />
  );
  return flow ? (
    <View style={{ flex: 1 }}>
      {screens}
      <RouteTransitionShield visible={shielded} />
    </View>
  ) : (
    screens
  );
}

test('첫 화면은 약관 동의 뒤 게스트 세션 요청만 시작하고 로컬 LOGIN은 하지 않는다', async () => {
  const startGuest = jest.fn();
  let exposed: any;
  const screen = await render(
    <Harness
      route="login"
      startGuest={startGuest}
      guestError="게스트 계정을 열지 못했어요. 잠시 후 다시 시도해 주세요."
      expose={(value: any) => (exposed = value)}
    />,
  );

  assert.ok(screen.getByText('게스트 계정을 열지 못했어요. 잠시 후 다시 시도해 주세요.'));
  await fireEvent.press(screen.getByText('게스트로 시작하기'));
  assert.equal(startGuest.mock.calls.length, 0);
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByText('게스트로 시작하기'));
  assert.equal(startGuest.mock.calls.length, 1);
  assert.equal(exposed.actions.includes('LOGIN'), false);
});

test('실제 로그인 구성에서는 약관 동의 뒤 소셜 제공자 로그인을 시작한다', async () => {
  const startSocial = jest.fn();
  const screen = await render(
    <Harness
      route="login"
      loginProviders={['kakao', 'google']}
      startSocial={startSocial}
      startGuest={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('카카오로 계속하기')).toBeTruthy();
  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByLabelText('카카오로 계속하기'));
  expect(startSocial).toHaveBeenCalledWith('kakao');
});

test('게스트 세션 콜백이 없는 미리보기 구성은 로컬 로그인으로 폴백한다', async () => {
  let exposed: any;
  const screen = await render(
    <Harness
      route="login"
      loginProviders={['google']}
      expose={(value: any) => (exposed = value)}
    />,
  );

  await fireEvent.press(screen.getByRole('checkbox'));
  await fireEvent.press(screen.getByText('게스트로 시작하기'));
  expect(exposed.actions).toContain('LOGIN');
});

test('닉네임 키보드 표시 이벤트를 두 번 처리해도 값이 유지되고 첫 섬으로 이동하지 않는다', async () => {
  const listeners: Record<string, () => void> = {};
  let exposed: any;
  const addListener = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    callback: (...args: any[]) => void,
  ) => {
    listeners[event] = callback as () => void;
    return { remove: jest.fn() } as any;
  }) as any);
  try {
    const s = await render(
      <Harness route="character" expose={(value: any) => (exposed = value)} />,
    );
    const nickname = s.getByLabelText('닉네임');
    await fireEvent.changeText(nickname, '구름이');
    await fireEvent(nickname, 'focus');
    await act(async () => listeners.keyboardWillShow?.());
    assert.ok(addListener.mock.calls.some(([event]) => event === 'keyboardWillShow'));
    assert.ok(addListener.mock.calls.some(([event]) => event === 'keyboardDidHide'));
    assert.equal(s.queryByText('내 고양이와 시작'), null);
    assert.equal(s.getByLabelText('닉네임').props.value, '구름이');
    assert.equal(exposed.go.mock.calls.length, 0);
    await act(async () => listeners.keyboardDidHide?.());
    assert.ok(s.getByText('내 고양이와 시작'));
    await fireEvent(s.getByLabelText('닉네임'), 'focus');
    await act(async () => listeners.keyboardWillShow?.());
    assert.equal(s.queryByText('내 고양이와 시작'), null);
    assert.equal(s.getByLabelText('닉네임').props.value, '구름이');
    assert.equal(exposed.go.mock.calls.length, 0);
    await act(async () => listeners.keyboardDidHide?.());
    assert.equal(s.getByLabelText('닉네임').props.value, '구름이');
  } finally {
    addListener.mockRestore();
  }
});

test('GROMO 시작하기 전환 후 100ms에는 터치 차단막이 있고 만료 뒤 CTA가 동작한다', async () => {
  jest.useFakeTimers();
  try {
    const screen = await render(<Harness route="login" flow />);
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByText('GROMO 시작하기'));
    expect(screen.getByText('어떤 고양이로 시작할까요?')).toBeTruthy();
    expect(
      screen.getByTestId('route-transition-shield', { includeHiddenElements: true }).props
        .pointerEvents,
    ).toBe('box-only');
    await fireEvent.press(
      screen.getByTestId('route-transition-shield', { includeHiddenElements: true }),
    );
    expect(screen.getByText('어떤 고양이로 시작할까요?')).toBeTruthy();
    expect(screen.queryByText('첫 섬 선택')).toBeNull();

    await act(async () => jest.advanceTimersByTime(100));
    expect(screen.getByText('어떤 고양이로 시작할까요?')).toBeTruthy();
    expect(screen.queryByText('첫 섬 선택')).toBeNull();

    await act(async () => jest.advanceTimersByTime(250));
    expect(
      screen.queryByTestId('route-transition-shield', { includeHiddenElements: true }),
    ).toBeNull();
    await fireEvent.press(screen.getByText('내 고양이와 시작'));
    expect(screen.getByText('첫 섬 선택')).toBeTruthy();
  } finally {
    await act(async () => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  }
});

// 티켓 2006 재실행 복구 회귀 — character CTA는 서버 모드에서 PATCH /me(name+catColor)가
// 성공한 뒤에만 chooseIsland로 넘어간다. 로컬 dispatch만으로 넘어가면 GET /me.onboardingComplete가
// 갱신되지 않아, 재실행 복구(restoredRoute)가 서버값을 정본으로 봐서 이 화면으로 되돌아간다.
test('character CTA는 서버 모드에서 PATCH /me 성공 뒤에만 PROFILE을 반영하고 chooseIsland로 넘어간다', async () => {
  let exposed: any;
  mockUpdateProfile.mockResolvedValue({
    id: 'u1',
    name: '수빈',
    catColor: 'black',
    mainIslandId: null,
  });
  const s = await render(
    <Harness route="character" api={() => ({})} expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByText('내 고양이와 시작'));
  await waitFor(() => assert.equal(mockUpdateProfile.mock.calls.length, 1));
  assert.deepEqual(mockUpdateProfile.mock.calls[0][0], { name: '수빈', catColor: 'black' });
  await waitFor(() => assert.ok(exposed.actions.includes('PROFILE')));
  assert.equal(exposed.go.mock.calls.length, 1);
  assert.equal(exposed.go.mock.calls[0][0], 'chooseIsland');
});

test('character CTA의 PATCH /me 실패는 PROFILE·화면 전환 없이 서버 오류 문구만 보여준다', async () => {
  let exposed: any;
  mockUpdateProfile.mockRejectedValue(
    new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0),
  );
  const s = await render(
    <Harness route="character" api={() => ({})} expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByText('내 고양이와 시작'));
  await waitFor(() => s.getByText('네트워크에 연결할 수 없어요.'));
  assert.ok(!exposed.actions.includes('PROFILE'));
  assert.equal(exposed.go.mock.calls.length, 0);
});

test('character CTA는 실패 뒤 같은 입력으로 다시 눌러도 같은 멱등 키로 다시 보낸다', async () => {
  mockUpdateProfile
    .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0))
    .mockResolvedValueOnce({ id: 'u1', name: '수빈', catColor: 'black', mainIslandId: null });
  const s = await render(<Harness route="character" api={() => ({})} />);

  await fireEvent.press(s.getByText('내 고양이와 시작'));
  await waitFor(() => s.getByText('네트워크에 연결할 수 없어요.'));
  await fireEvent.press(s.getByText('내 고양이와 시작'));
  await waitFor(() => assert.equal(mockUpdateProfile.mock.calls.length, 2));

  assert.ok(mockUpdateProfile.mock.calls[0][1]);
  assert.equal(mockUpdateProfile.mock.calls[1][1], mockUpdateProfile.mock.calls[0][1]);
});

test('character CTA는 저장 응답 전에 화면을 떠났으면 chooseIsland로 다시 끌어오지 않는다', async () => {
  let exposed: any;
  let resolveSave: (v: unknown) => void = () => {};
  mockUpdateProfile.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)));
  const s = await render(
    <Harness route="character" api={() => ({})} expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByText('내 고양이와 시작'));
  await waitFor(() => assert.equal(mockUpdateProfile.mock.calls.length, 1));
  await s.rerender(
    <Harness route="login" api={() => ({})} expose={(value: any) => (exposed = value)} />,
  );
  await act(async () => {
    resolveSave({ id: 'u1', name: '수빈', catColor: 'black', mainIslandId: null });
  });

  assert.equal(exposed.go.mock.calls.length, 0);
});

test('목업 모드 character CTA는 PATCH 없이 바로 chooseIsland로 넘어간다', async () => {
  let exposed: any;
  const s = await render(<Harness route="character" expose={(value: any) => (exposed = value)} />);

  await fireEvent.press(s.getByText('내 고양이와 시작'));
  assert.equal(mockUpdateProfile.mock.calls.length, 0);
  assert.equal(exposed.go.mock.calls.length, 1);
  assert.equal(exposed.go.mock.calls[0][0], 'chooseIsland');
});

const flush = async () => act(async () => {});

// 서버 폴링·진행 중 Promise가 다음 테스트를 오염시키지 않게 매번 언마운트한다
afterEach(() => {
  mockFontScale = 1;
  cleanup();
});

test('joinIsland 진입 시 explore를 호출하고 실패하면 오류+재시도를 보여준다', async () => {
  let calls = 0;
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ApiError('CLIENT_NETWORK_ERROR', '네트워크', 0);
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
      return { items: [islandSummary()], nextCursor: null };
    }),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('다시 불러오기'));
  await fireEvent.press(s.getByText('다시 불러오기'));
  await waitFor(() => s.getByText('바람 섬'));
  assert.equal(calls, 2);
});

test('active 가입은 서버 응답 뒤 성공 확인 카드를 보여주고 arrival로 가지 않는다', async () => {
  // 실제 islandCommands.join()은 active 확정 전에 syncIslands()로 snap.currentIslandId를
  // 이미 맞춘다 — 그 순서를 여기서도 흉내내 joined와 serverDone이 같은 가입에 동시에
  // true가 되는 실제 상황을 재현한다(GROMO-2006 join 참조).
  const join = jest.fn(async (id: string, dispatch: any) => {
    dispatch({
      type: 'ISLAND_SYNC',
      memberships: {
        items: [islandSummary({ id, membershipStatus: 'active' })],
        nextCursor: null,
        currentIslandId: id,
        lossReason: null,
      },
    });
    return { status: 'active' as const };
  });
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join: (id: string) => join(id, dispatch),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await waitFor(() => s.getByText('가입이 완료됐어요'));
  assert.equal(join.mock.calls.length, 1);
  // 확정 스냅숏(joined)과 방금 응답(serverDone)이 같은 가입을 가리킬 때 카드가 두 번 그려지지 않는다.
  assert.equal(s.getAllByText('가입이 완료됐어요').length, 1);
});

test('pending 가입은 대기 카드와 취소 버튼을 보여주고 취소는 서버 명령을 부른다', async () => {
  const cancel = jest.fn(async (_id: string) => {});
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary({ approvalRequired: true })],
        nextCursor: null,
        reset: true,
      });
    }),
    join: jest.fn(async () => {
      dispatch({ type: 'ISLAND_REQUEST', request: pendingReq({ islandId: 'isl-1' }) });
      return { status: 'pending' as const, requestId: 'req-1' };
    }),
    cancel,
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('가입 신청'));
  await fireEvent.press(s.getByText('가입 신청'));
  await waitFor(() => s.getByText('가입 신청 대기 중'));
  await fireEvent.press(s.getByText('가입 신청 취소'));
  await flush();
  assert.equal(cancel.mock.calls[0][0], 'req-1');
});

test('join 실패는 로컬 성공으로 바꾸지 않고 오류 문구를 보여준다', async () => {
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join: jest.fn(async () => {
      throw new ApiError('FORBIDDEN', '강퇴된 섬에는 다시 가입할 수 없어요.', 403);
    }),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await waitFor(() => s.getByText('강퇴된 섬에는 다시 가입할 수 없어요.'));
  assert.ok(s.queryByText('가입이 완료됐어요') === null);
});

test('제출 중 중복 탭은 join을 두 번 부르지 않는다', async () => {
  let release: (v: unknown) => void = () => {};
  const join = jest.fn((_id: string) => new Promise((resolve) => (release = resolve)));
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join,
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await act(async () => release({ status: 'active' }));
  assert.equal(join.mock.calls.length, 1);
});

test('createIsland 서버 실패는 로컬 CREATE 없이 오류를 보여준다', async () => {
  const create = jest.fn(async () => {
    throw new ApiError('SERVICE_UNAVAILABLE', '잠시 뒤 다시 시도해 주세요.', 503);
  });
  let exposed: any;
  const api = () => ({ create });
  const s = await render(
    <Harness route="createIsland" api={api} expose={(x: any) => (exposed = x)} />,
  );
  // 이름이 비어 있으면 제출 버튼이 비활성 — create를 부르지 않는다
  const submit = s.getByLabelText('섬 만들기');
  assert.equal(submit.props.accessibilityState?.disabled, true);
  await fireEvent.changeText(s.getByLabelText('섬 이름'), '새 섬');
  await fireEvent.press(s.getByLabelText('섬 만들기'));
  await waitFor(() => s.getByText('잠시 뒤 다시 시도해 주세요.'));
  assert.equal(create.mock.calls.length, 1);
  // 실패를 로컬 성공 action 으로 치환하지 않았다 — CREATE_ISLAND 디스패치 없음
  assert.ok(!exposed.actions.includes('CREATE_ISLAND'));
  assert.ok(s.queryByText('섬을 만들었어요') === null);
});

test('createIsland 서버 성공은 memberships 재조회 뒤 확인 카드를 보여준다', async () => {
  const create = jest.fn(async (_input: any) => {});
  const api = () => ({ create });
  const s = await render(<Harness route="createIsland" api={api} />);
  await fireEvent.changeText(s.getByLabelText('섬 이름'), '새 섬');
  await fireEvent.press(s.getByLabelText('섬 만들기'));
  await waitFor(() => s.getByText('섬을 만들었어요'));
  // 보낸 input 은 공개 계약 필드만 — name/intro/approvalRequired/maxMembers
  assert.deepEqual(create.mock.calls[0][0], {
    name: '새 섬',
    intro: undefined,
    approvalRequired: false,
    maxMembers: 15,
  });
});

test('approval 경로는 서버 pending 신청을 복구해 대기 카드를 보여준다', async () => {
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_SYNC_REQUESTS',
        requests: [pendingReq()],
      });
    }),
    status: jest.fn(async (id: string) => ({
      id,
      islandId: 'isl-9',
      status: 'pending',
      version: 1,
    })),
  });
  const s = await render(
    <Harness
      route="approval"
      api={api}
      seed={(d: any) => d({ type: 'ISLAND_SYNC_REQUESTS', requests: [pendingReq()] })}
    />,
  );
  await waitFor(() => s.getByText('가입 신청 대기 중'));
  s.getByText('가입 신청 취소');
});

test('외부 승인으로 current가 바뀌면 approval 화면이 성공 확인을 보여준다', async () => {
  let exposed: any;
  const api = () => ({
    explore: jest.fn(async () => {}),
    status: jest.fn(),
  });
  const s = await render(
    <Harness
      route="approval"
      api={api}
      expose={(x: any) => (exposed = x)}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC_REQUESTS',
          requests: [pendingReq({ status: 'pending' })],
        })
      }
    />,
  );
  await waitFor(() => s.getByText('가입 신청 대기 중'));
  // 다른 기기에서 승인 → 폴링이 ISLAND_REQUEST(approved)+memberships 재조회를 디스패치한 상황을 재현
  await act(async () => {
    exposed.dispatch({
      type: 'ISLAND_REQUEST',
      request: { ...pendingReq({ status: 'approved' }) },
    });
  });
  await waitFor(() => s.getByText('가입이 완료됐어요'));
});

test('다른 섬의 승인 이력이 requestStatus에 남아도 joinIsland의 참여 CTA는 숨지 않는다', async () => {
  const join = jest.fn(async (_id: string) => ({ status: 'active' as const }));
  const api = () => ({ explore: jest.fn(async () => {}), join });
  const s = await render(
    <Harness
      route="joinIsland"
      api={api}
      seed={(d: any) => {
        // 섬 A의 승인 결과 — 세션 동안 requestStatus에 남는다(재현 경로의 핵심)
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA', islandId: 'isl-A', status: 'approved', version: 2 },
        });
        d({
          type: 'ISLAND_CANDIDATES',
          items: [islandSummary({ id: 'isl-B', name: '숲 섬' })],
          nextCursor: null,
          reset: true,
        });
      }}
    />,
  );
  await waitFor(() => s.getByText('숲 섬에 참여하기'));
  await fireEvent.press(s.getByText('숲 섬에 참여하기'));
  await waitFor(() => assert.equal(join.mock.calls[0]?.[0], 'isl-B'));
});

test('같은 섬의 옛 approved 이력보다 새 pending 신청이 우선한다 — 취소 CTA가 새 requestId를 부른다', async () => {
  const cancel = jest.fn(async (_id: string) => ({}));
  const api = () => ({ explore: jest.fn(async () => {}), cancel, status: jest.fn() });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) => {
        // 승인 → 탈퇴 → 같은 섬에 재신청한 사이클: 옛 종결 + 새 pending이 공존한다
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA-old', islandId: 'isl-A', status: 'approved', version: 2 },
        });
        d({
          type: 'ISLAND_SYNC_REQUESTS',
          requests: [pendingReq({ id: 'rA-new', islandId: 'isl-A', islandName: '바람 섬' })],
        });
      }}
    />,
  );
  await waitFor(() => s.getByText('가입 신청 취소'));
  await fireEvent.press(s.getByText('가입 신청 취소'));
  await waitFor(() => assert.equal(cancel.mock.calls[0]?.[0], 'rA-new'));
});

test('같은 섬의 종결 이력이 여러 개면 최신 것을 보여준다 — 옛 approved가 새 rejected를 덮지 않는다', async () => {
  const api = () => ({ explore: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) => {
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA-old', islandId: 'isl-A', status: 'approved', version: 2 },
        });
        // 탈퇴·재신청 뒤 거절 — requestStatus 끝에 append된 최신 이력
        d({
          type: 'ISLAND_REQUEST',
          request: { id: 'rA-new', islandId: 'isl-A', status: 'rejected', version: 1 },
        });
      }}
    />,
  );
  await waitFor(() => s.getByText('신청이 거절됐어요'));
  assert.equal(s.queryByText('가입이 완료됐어요'), null);
});

test('approval A 화면은 다른 섬 B의 pending을 가로채지 않는다', async () => {
  const api = () => ({ explore: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC_REQUESTS',
          requests: [pendingReq({ id: 'rB', islandId: 'isl-B', islandName: '숲 섬' })],
        })
      }
    />,
  );
  await flush();
  assert.equal(s.queryByText('가입 신청 대기 중'), null);
  assert.equal(s.queryByText('가입 신청 취소'), null);
});

test('approval 경로는 detail과 매칭된 approved 이력의 완료 카드를 보여준다', async () => {
  const api = () => ({ explore: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="approval"
      detail="isl-A"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_REQUEST',
          request: {
            id: 'rA',
            islandId: 'isl-A',
            status: 'approved',
            version: 2,
            islandName: '바람 섬',
          },
        })
      }
    />,
  );
  await waitFor(() => s.getByText('가입이 완료됐어요'));
});

test('CLIENT_STALE_SESSION 실패는 오류 문구 없이 버린다', async () => {
  const api = (dispatch: any) => ({
    explore: jest.fn(async () => {
      dispatch({
        type: 'ISLAND_CANDIDATES',
        items: [islandSummary()],
        nextCursor: null,
        reset: true,
      });
    }),
    join: jest.fn(async () => {
      throw new ApiError('CLIENT_STALE_SESSION', 'stale', 0);
    }),
  });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => s.getByText('바람 섬에 참여하기'));
  await fireEvent.press(s.getByText('바람 섬에 참여하기'));
  await flush();
  assert.ok(s.queryByText('가입이 완료됐어요') === null);
});

test('초대 코드는 해석 뒤 미리보기를 보여주고 명시 확인 전에 join하지 않는다', async () => {
  const join = jest.fn(async (_id: string) => ({ status: 'active' as const }));
  const api = () => ({
    resolveInvite: jest.fn(async (_code: string) =>
      islandSummary({ id: 'inv-1', name: '초대 섬' }),
    ),
    join,
  });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await fireEvent.press(s.getByTestId('invite-open'));
  await fireEvent.changeText(s.getByLabelText('초대 코드'), 'ABC123');
  await fireEvent.press(s.getByLabelText('확인'));
  await waitFor(() => s.getByText('초대 섬'));
  assert.equal(join.mock.calls.length, 0);
  await fireEvent.press(s.getByText('이 섬에 참여'));
  await waitFor(() => s.getByText('가입이 완료됐어요'));
  assert.equal(join.mock.calls.length, 1);
});

// join()은 active 확정 전에 syncIslands()로 snap.currentIslandId를 이미 그 섬으로 맞춘다.
// chooseIsland의 「재시작 복구」 카드(cur)와 방금 가입 응답 카드(serverDone)가 같은 섬을 가리키면
// 정본 스냅숏(cur) 카드만 남기고 serverDone 카드는 건너뛴다(joinIsland 화면과 같은 dedupe 규칙).
test('초대 코드로 가입한 직후 chooseIsland는 확인 카드를 한 번만 보여준다', async () => {
  const join = jest.fn(async (id: string, dispatch: any) => {
    dispatch({
      type: 'ISLAND_SYNC',
      memberships: {
        items: [islandSummary({ id, name: '초대 섬', membershipStatus: 'active' })],
        nextCursor: null,
        currentIslandId: id,
        lossReason: null,
      },
    });
    return { status: 'active' as const };
  });
  const api = (dispatch: any) => ({
    resolveInvite: jest.fn(async (_code: string) =>
      islandSummary({ id: 'inv-1', name: '초대 섬' }),
    ),
    join: (id: string) => join(id, dispatch),
  });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await fireEvent.press(s.getByTestId('invite-open'));
  await fireEvent.changeText(s.getByLabelText('초대 코드'), 'ABC123');
  await fireEvent.press(s.getByLabelText('확인'));
  await waitFor(() => s.getByText('초대 섬'));
  await fireEvent.press(s.getByText('이 섬에 참여'));

  await waitFor(() => s.getByText('가입이 확인됐어요'));
  s.getByText('서버에서 「초대 섬」 소속이 확인됐어요.');
  assert.equal(s.queryByText('가입이 완료됐어요'), null);
});

test('이전 섬과 이름이 같아도 방금 가입한 섬(id 다름)의 완료 카드는 숨기지 않는다', async () => {
  // 서버가 current 를 바꾸지 않은 채 같은 이름의 다른 섬을 가리키는 경우 — 이름 비교면 완료 카드가 사라진다.
  const join = jest.fn(async (id: string, dispatch: any) => {
    dispatch({
      type: 'ISLAND_SYNC',
      memberships: {
        items: [
          islandSummary({ id: 'old-1', name: '같은 이름', membershipStatus: 'active' }),
          islandSummary({ id, name: '같은 이름', membershipStatus: 'active' }),
        ],
        nextCursor: null,
        currentIslandId: 'old-1',
        lossReason: null,
      },
    });
    return { status: 'active' as const };
  });
  const api = (dispatch: any) => ({
    resolveInvite: jest.fn(async (_code: string) =>
      islandSummary({ id: 'inv-2', name: '같은 이름' }),
    ),
    join: (id: string) => join(id, dispatch),
  });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await fireEvent.press(s.getByTestId('invite-open'));
  await fireEvent.changeText(s.getByLabelText('초대 코드'), 'ABC123');
  await fireEvent.press(s.getByLabelText('확인'));
  await waitFor(() => s.getByText('같은 이름'));
  await fireEvent.press(s.getByText('이 섬에 참여'));

  await waitFor(() => s.getByText('가입이 완료됐어요'));
});

test('부팅 동기화 실패는 chooseIsland에 명시 오류+재시도를 띄우고 재시도가 sync를 부른다', async () => {
  const sync = jest.fn(async () => {});
  const api = () => ({ sync });
  const s = await render(<Harness route="chooseIsland" api={api} bootError />);
  await waitFor(() => s.getByText('섬 정보를 불러오지 못했어요'));
  await fireEvent.press(s.getByLabelText('다시 시도'));
  await flush();
  assert.equal(sync.mock.calls.length, 1);
});

test('재시작 복구 — 서버 current가 있으면 chooseIsland에 소속 확인 카드를 보여준다', async () => {
  const api = () => ({ sync: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="chooseIsland"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC',
          memberships: {
            items: [islandSummary({ id: 'srv-1', name: '복구 섬' })],
            nextCursor: null,
            currentIslandId: 'srv-1',
            lossReason: null,
          },
        })
      }
    />,
  );
  await waitFor(() => s.getByText('가입이 확인됐어요'));
  s.getByText('서버에서 「복구 섬」 소속이 확인됐어요.');
});

test('재시작 후 pending 신청은 발견 후보와 무관하게 chooseIsland에서 approval로 닿는다', async () => {
  let exposed: any;
  const api = () => ({ sync: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="chooseIsland"
      api={api}
      expose={(x: any) => (exposed = x)}
      seed={(d: any) => d({ type: 'ISLAND_SYNC_REQUESTS', requests: [pendingReq()] })}
    />,
  );
  await waitFor(() => s.getByTestId('pending-resume'));
  await fireEvent.press(s.getByTestId('pending-resume'));
  assert.equal(exposed.go.mock.calls[0][0], 'approval');
  assert.equal(exposed.go.mock.calls[0][1], 'isl-9');
});

test('joinIsland를 나갔다 같은 route로 재진입하면 explore를 다시 부른다', async () => {
  const explore = jest.fn(async () => {});
  const api = () => ({ explore });
  const s = await render(<Harness route="joinIsland" api={api} />);
  await waitFor(() => assert.equal(explore.mock.calls.length, 1));
  await s.rerender(<Harness route="chooseIsland" api={api} />);
  await s.rerender(<Harness route="joinIsland" api={api} />);
  await waitFor(() => assert.equal(explore.mock.calls.length, 2));
});

test('초대 코드가 없으면 resolve 오류를 코드별 문구로 보여준다', async () => {
  const api = () => ({
    resolveInvite: jest.fn(async () => {
      throw new ApiError('SLUG_NOT_FOUND', 'not found', 404);
    }),
  });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await fireEvent.press(s.getByTestId('invite-open'));
  await fireEvent.changeText(s.getByLabelText('초대 코드'), 'WRONG');
  await fireEvent.press(s.getByLabelText('확인'));
  await waitFor(() => s.getByText('초대 코드를 다시 확인해 주세요.'));
});

test('축음기에서 판매곡을 구매한 뒤 바로 공용 재생한다', async () => {
  let exposed: any;
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].fish = 10_000;
  const s = await render(
    <Harness route="sound" initial={state} expose={(value: any) => (exposed = value)} />,
  );
  await fireEvent.press(s.getByLabelText('빗방울 소리, 30마리로 구매'));
  s.getByText('빗방울 소리를 구매할까요?');
  const background = s.getByTestId('sound-background-content', {
    includeHiddenElements: true,
  });
  assert.equal(background.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(background.props.pointerEvents, 'none');
  await fireEvent.press(s.getByText('30마리로 구매'));
  s.getByText('구매했어요');
  await fireEvent.press(s.getByText('지금 재생하기'));
  assert.ok(exposed.actions.includes('BUY'));
  assert.ok(exposed.actions.includes('TRACK'));
});

test('축음기 배경은 집중 세션이 없을 때 축음기 전용 일러스트를 그린다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  const s = await render(<Harness route="sound" initial={state} />);
  // 렌더 트리에서 Image 의 source 만 모은다
  const imageSources = (node: any): unknown[] =>
    !node || typeof node === 'string'
      ? []
      : Array.isArray(node)
        ? node.flatMap(imageSources)
        : [...(node.type === 'Image' ? [node.props.source] : []), ...imageSources(node.children)];
  const sources = imageSources(s.toJSON());
  assert.ok(sources.includes(art['interior/gram']));
  assert.ok(!sources.includes(art['bldbg/gram']));
});

test('축음기 조작 요소는 44pt 터치 영역을 확보하고 곡 헤더 높이를 고정하지 않는다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  const s = await render(<Harness route="sound" initial={state} />);
  assert.ok(StyleSheet.flatten(s.getByLabelText('재생').props.style).height >= 44);
  assert.ok(StyleSheet.flatten(s.getByLabelText('섬으로 돌아가기').props.style).width >= 44);
  assert.ok(
    StyleSheet.flatten(s.getByLabelText('빗방울 소리, 30마리로 구매').props.style).minHeight >= 44,
  );
  assert.equal(
    StyleSheet.flatten(s.getByTestId('sound-current-track').props.style).height,
    undefined,
  );
  assert.equal(
    StyleSheet.flatten(s.getByTestId('sound-track-title-rain').props.style).flexShrink,
    1,
  );
  const statusStyle = StyleSheet.flatten(s.getByTestId('sound-track-status-rain').props.style);
  assert.equal(statusStyle.flexShrink, 1);
  assert.equal(statusStyle.maxWidth, '45%');
});

test('보유곡이 없으면 재생을 막고 빈 상태를 표시한다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].sharedOwned = [];
  const s = await render(<Harness route="sound" initial={state} />);

  s.getByText('보유한 곡이 없어요');
  s.getByText('곡을 구매해 주세요');
  assert.equal(s.getByLabelText('재생').props.accessibilityState.disabled, true);
});

test('현재 곡을 보유하지 않았으면 다른 보유곡이 있어도 재생을 막는다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].sharedOwned = ['rain'];
  state.islands[0].track = 'waves';
  const s = await render(<Harness route="sound" initial={state} />);

  s.getByText('재생할 곡을 골라 주세요');
  assert.equal(s.getByLabelText('재생').props.accessibilityState.disabled, true);
  await fireEvent.press(s.getByLabelText('빗방울 소리, 보유'));
  await waitFor(() =>
    assert.equal(s.getByLabelText('재생').props.accessibilityState.disabled, false),
  );
});

test('집중 중 축음기는 보유곡만 표시하고 복귀 목적지를 정확히 안내한다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].sharedOwned = ['waves'];
  state.session = {
    id: 'focus-1',
    islandId: state.islands[0].id,
    subject: '수학',
    startedAt: 1000,
    seconds: 0,
    status: 'active',
  };
  const s = await render(<Harness route="sound" initial={state} />);

  s.getByLabelText('집중으로 돌아가기');
  s.getByLabelText('잔잔한 파도, 보유');
  assert.equal(s.queryByLabelText('빗방울 소리, 30마리로 구매'), null);
});

test('공동 보유품 중 실제 음원만 축음기 목록에 표시한다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].sharedOwned = ['waves', 'pine'];
  const s = await render(<Harness route="sound" initial={state} />);

  s.getByLabelText('잔잔한 파도, 보유');
  assert.equal(s.queryByText('pine'), null);
});

test('축음기에서 내 기기 음량을 조절한다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  const s = await render(<Harness route="sound" initial={state} />);
  const volume = s.getByLabelText('내 기기 음량');

  assert.equal(volume.props.accessibilityValue.now, 55);
  await fireEvent(volume, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  await waitFor(() =>
    assert.equal(s.getByLabelText('내 기기 음량').props.accessibilityValue.now, 65),
  );
});

test('큰 글자에서는 구매 창을 스크롤하고 동작 버튼을 세로로 배치한다', async () => {
  mockFontScale = 1.5;
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].fish = 100;
  const s = await render(<Harness route="sound" initial={state} />);
  await fireEvent.press(s.getByLabelText('빗방울 소리, 30마리로 구매'));

  assert.ok(StyleSheet.flatten(s.getByTestId('sound-dialog-card').props.style).maxHeight > 0);
  assert.equal(StyleSheet.flatten(s.getByTestId('sound-dialog-scroll').props.style).flexShrink, 1);
  assert.equal(
    StyleSheet.flatten(s.getByTestId('sound-dialog-actions').props.style).flexDirection,
    'column',
  );
  const purchaseStyle = StyleSheet.flatten(s.getByLabelText('30마리로 구매').props.style);
  assert.equal(purchaseStyle.height, undefined);
  assert.ok(purchaseStyle.minHeight >= 52);
  await fireEvent.press(s.getByLabelText('30마리로 구매'));
  const successStyle = StyleSheet.flatten(s.getByLabelText('지금 재생하기').props.style);
  assert.equal(successStyle.height, undefined);
  assert.ok(successStyle.minHeight >= 52);
});

test('Android 뒤로가기는 축음기 구매 창만 닫는다', async () => {
  const handlers: Array<Parameters<typeof BackHandler.addEventListener>[1]> = [];
  const remove = jest.fn();
  const backSpy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, handler) => {
    handlers.push(handler);
    return { remove };
  });
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  const s = await render(<Harness route="sound" initial={state} />);

  await fireEvent.press(s.getByLabelText('빗방울 소리, 30마리로 구매'));
  await waitFor(() => assert.equal(handlers.length, 1));
  await act(async () => assert.equal(handlers[0]({} as never), true));
  await waitFor(() => assert.equal(s.queryByText('빗방울 소리를 구매할까요?'), null));

  backSpy.mockRestore();
});

test('축음기 음원 구매 잔액이 부족하면 수량 없이 실패만 알린다', async () => {
  const state = initialState(false);
  state.islands[0].joined = true;
  state.islands[0].buildings.push('gram');
  state.islands[0].fish = 0;
  const s = await render(<Harness route="sound" initial={state} />);
  await fireEvent.press(s.getByLabelText('빗방울 소리, 30마리로 구매'));
  await fireEvent.press(s.getByText('30마리로 구매'));
  s.getByText('물고기가 부족해요');
  assert.equal(s.queryByText(/더 필요해요/), null);
  assert.equal(s.queryByText(/지금 섬에는/), null);
});

test('친구 관리는 검색과 요청·친구 목록을 한 화면에서 이어서 보여준다', async () => {
  const s = await render(<Harness route="friends" full />);

  s.getByLabelText('닉네임으로 친구 찾기');
  s.getByText('받은 요청');
  s.getByText('보낸 요청');
  s.getByText('친구');
  s.getByText('수락');
  s.getByText('거절');
  assert.equal(s.queryByText('닉네임이 정확히 일치하는 친구만 보여요.'), null);

  await fireEvent.changeText(s.getByLabelText('닉네임으로 친구 찾기'), '하늘');
  s.getByText('검색 결과');
  s.getByLabelText('검색어 지우기');
});

test('서버 차단 목록 재검증 중에는 뗏목의 이전 친구 요청 배지를 숨긴다', async () => {
  const initial = initialState(true);
  initial.friends = [
    {
      id: 'requester-stale',
      name: '이전 요청자',
      color: 'white',
      island: '',
      status: 'received',
      messages: [],
    },
  ];
  const friendsScreen = {
    data: null,
    status: 'loading',
    error: null,
    busy: false,
    query: '',
    searchItems: [],
    refresh: jest.fn(),
    retry: jest.fn(),
    setQuery: jest.fn(),
    command: jest.fn((fn: () => Promise<unknown>) => fn()),
  };

  const screen = await render(
    <Harness route="boat" full initial={initial} api={() => ({})} friendsScreen={friendsScreen} />,
  );

  assert.equal(screen.queryByText('요청 1'), null);
});

test('내 뗏목의 「현재 내 메인 섬」은 로컬 목업 섬(소다 섬) 대신 서버 메인 섬 이름을 쓴다', async () => {
  // 게스트→멤버 전환 직후(로컬 목업 섬은 하나도 가입하지 않은 상태)를 재현한다.
  const initial = initialState(false);
  initial.serverIslands = {
    memberships: [
      {
        id: 'confirm-island',
        name: '확인섬',
        intro: '',
        visibility: 'public',
        approvalRequired: false,
        memberCount: 1,
        maxMembers: 15,
        membershipStatus: 'active',
        joinRequestId: null,
        growthStage: null,
        themeId: null,
      },
    ],
    currentIslandId: 'confirm-island',
    lossReason: null,
    candidates: [],
    nextCursor: null,
    visit: null,
    joinRequests: [],
    requestStatus: [],
  };
  initial.mainIslandId = 'confirm-island';
  initial.onboarded = true;

  const friendsScreen = { status: 'idle', data: null };
  const screen = await render(
    <Harness route="boat" initial={initial} api={() => ({})} friendsScreen={friendsScreen} />,
  );

  screen.getByText('확인섬');
  screen.getByLabelText('현재 내 메인 섬 확인섬');
  assert.equal(screen.queryByText('소다 섬'), null);
  assert.equal(screen.queryByLabelText('현재 내 메인 섬 소다 섬'), null);
});

test('내 뗏목의 메인 섬 id가 멤버십에 없으면 현재 섬 이름을, 그것도 없으면 「내 섬」을 쓴다', async () => {
  const build = (currentIslandId: string | null) => {
    const initial = initialState(false);
    initial.serverIslands = {
      memberships: [
        {
          id: 'cur-island',
          name: '현재섬',
          intro: '',
          visibility: 'public',
          approvalRequired: false,
          memberCount: 1,
          maxMembers: 15,
          membershipStatus: 'active',
          joinRequestId: null,
          growthStage: null,
          themeId: null,
        },
      ],
      currentIslandId,
      lossReason: null,
      candidates: [],
      nextCursor: null,
      visit: null,
      joinRequests: [],
      requestStatus: [],
    };
    initial.mainIslandId = 'gone-island';
    initial.onboarded = true;
    return initial;
  };
  const friendsScreen = { status: 'idle', data: null };

  const withCurrent = await render(
    <Harness
      route="boat"
      initial={build('cur-island')}
      api={() => ({})}
      friendsScreen={friendsScreen}
    />,
  );
  withCurrent.getByLabelText('현재 내 메인 섬 현재섬');
  assert.equal(withCurrent.queryByText('소다 섬'), null);
  await cleanup();

  const withoutCurrent = await render(
    <Harness route="boat" initial={build(null)} api={() => ({})} friendsScreen={friendsScreen} />,
  );
  withoutCurrent.getByLabelText('현재 내 메인 섬 내 섬');
  assert.equal(withoutCurrent.queryByText('소다 섬'), null);
});

test('내 뗏목의 긴 서버 섬 이름은 한 줄로 줄이고 말줄임한다', async () => {
  // 게스트→멤버 전환 직후(로컬 목업 섬은 하나도 가입하지 않은 상태)를 재현한다.
  const initial = initialState(false);
  initial.serverIslands = {
    memberships: [
      {
        id: 'long-island',
        name: '아주아주아주 긴 이름을 가진 서버 섬 이름입니다',
        intro: '',
        visibility: 'public',
        approvalRequired: false,
        memberCount: 1,
        maxMembers: 15,
        membershipStatus: 'active',
        joinRequestId: null,
        growthStage: null,
        themeId: null,
      },
    ],
    currentIslandId: 'long-island',
    lossReason: null,
    candidates: [],
    nextCursor: null,
    visit: null,
    joinRequests: [],
    requestStatus: [],
  };
  initial.mainIslandId = 'long-island';
  initial.onboarded = true;

  const friendsScreen = { status: 'idle', data: null };
  const screen = await render(
    <Harness route="boat" initial={initial} api={() => ({})} friendsScreen={friendsScreen} />,
  );

  const title = screen.getByText('아주아주아주 긴 이름을 가진 서버 섬 이름입니다');
  assert.equal(title.props.numberOfLines, 1);
  assert.equal(title.props.ellipsizeMode, 'tail');
});

test('목업 친구 화면에서는 안전 API 더보기를 숨기되 기존 친구 삭제를 유지한다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="friends" full expose={(value: any) => (exposed = value)} />,
  );

  assert.equal(s.queryByLabelText('새봄 더보기'), null);
  assert.equal(s.queryByText('신고하기'), null);
  assert.equal(s.queryByText('차단하기'), null);
  await fireEvent.press(s.getAllByText('친구 삭제')[0]);
  assert.ok(exposed.actions.includes('FRIEND_DELETE'));
});

test('서버에서 받은 친구 요청에도 신고·차단 안전 메뉴를 제공한다', async () => {
  const friendsScreen = {
    data: {
      friends: [],
      friendRequests: [
        {
          requestId: 'request-1',
          userId: 'requester-1',
          nickname: '반복요청자',
          tierLevel: null,
          createdAt: '2026-09-27T00:00:00Z',
        },
      ],
      sentFriendRequests: [],
    },
    status: 'ready',
    error: null,
    busy: false,
    query: '',
    searchItems: [],
    refresh: jest.fn(),
    retry: jest.fn(),
    setQuery: jest.fn(),
    command: jest.fn((fn: () => Promise<unknown>) => fn()),
  };
  const screen = await render(
    <Harness route="friends" full api={() => ({})} friendsScreen={friendsScreen} />,
  );

  await fireEvent.press(screen.getByLabelText('반복요청자 더보기'));

  assert.ok(screen.getByText('신고하기'));
  assert.ok(screen.getByText('차단하기'));
  assert.equal(screen.queryByText('친구 삭제'), null);
});

test('큰 글자의 받은 친구 요청은 안전 메뉴 액션을 세로로 배치한다', async () => {
  mockFontScale = 1.5;
  const friendsScreen = {
    data: {
      friends: [],
      friendRequests: [
        {
          requestId: 'request-large',
          userId: 'requester-large',
          nickname: '큰글자요청자',
          tierLevel: null,
          createdAt: '2026-09-27T00:00:00Z',
        },
      ],
      sentFriendRequests: [],
    },
    status: 'ready',
    error: null,
    busy: false,
    query: '',
    searchItems: [],
    refresh: jest.fn(),
    retry: jest.fn(),
    setQuery: jest.fn(),
    command: jest.fn((fn: () => Promise<unknown>) => fn()),
  };
  const screen = await render(
    <Harness route="friends" full api={() => ({})} friendsScreen={friendsScreen} />,
  );

  const actions = screen.getByTestId('friend-request-actions-with-safety');
  assert.equal(StyleSheet.flatten(actions.props.style).flexDirection, 'column');
  assert.ok(screen.getByLabelText('큰글자요청자 더보기'));
});

test('앱 설정은 권한 관련 진입을 앱 권한 관리 한 줄로 합친다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="settings" full expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByText('앱 권한 관리'));
  assert.equal(exposed.go.mock.calls[0][0], 'permission');
  assert.equal(exposed.go.mock.calls[0][1], 'settings');
  assert.equal(s.queryByText('측정 권한'), null);
  assert.equal(s.queryByText('측정 앱'), null);
});

test('목업 앱 설정에서는 실제 안전 API 진입로를 숨긴다', async () => {
  const s = await render(<Harness route="settings" full />);

  assert.equal(s.queryByText('차단한 사용자'), null);
});

test('앱 정보의 개인정보 안내는 서버 저장과 분석 전송을 사실대로 설명한다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="settings" full expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByText('개인정보 처리 안내'));
  const explanation = exposed.confirm.mock.calls.at(-1)[1] as string;
  assert.match(explanation, /계정 식별 정보가 서버로 전달/);
  assert.match(explanation, /섬·주민 활동, 친구·편지, 집중 기록/);
  assert.match(explanation, /PostHog/);
  assert.doesNotMatch(explanation, /로컬 목업|서버로 전송하지 않아요/);
});

test('서버 앱 설정의 안전 섹션에서 차단 사용자 목록으로 진입한다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="settings" full api={() => ({})} expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByText('차단한 사용자'));

  assert.equal(exposed.go.mock.calls[0][0], 'blockedUsers');
});

test('앱 설정의 언어 행은 기기 언어 따름이면 그 문구를 보여주고 탭하면 언어 화면으로 이동한다', async () => {
  let exposed: any;
  const s = await render(
    <Harness
      route="settings"
      full
      localePref="system"
      expose={(value: any) => (exposed = value)}
    />,
  );

  assert.ok(s.getByText('기기 언어 따름'));
  await fireEvent.press(s.getByLabelText('언어, 기기 언어 따름'));
  assert.equal(exposed.go.mock.calls[0][0], 'language');
  assert.equal(exposed.go.mock.calls[0][1], 'settings');
});

test('앱 설정의 언어 행은 명시적으로 고른 언어면 그 언어 이름을 보여준다', async () => {
  const s = await render(<Harness route="settings" full localePref="en" />);

  assert.ok(s.getByText('English'));
});

test("route==='language'는 행 3개를 그리고 현재 pref 행만 선택 표시한다", async () => {
  const s = await render(<Harness route="language" full localePref="ko" />);

  assert.equal(
    s.getByLabelText('기기 언어 따름, 지금은 한국어').props.accessibilityState.selected,
    false,
  );
  assert.equal(s.getByLabelText('한국어').props.accessibilityState.selected, true);
  assert.equal(s.getByLabelText('English').props.accessibilityState.selected, false);
});

test('«English» 탭은 저장 → 적용 → 새 언어 알림 순서로 처리한다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="language" full localePref="ko" expose={(value: any) => (exposed = value)} />,
  );
  const setItem = AsyncStorage.setItem as jest.Mock;

  await fireEvent.press(s.getByLabelText('English'));

  await waitFor(() => assert.equal(exposed.setLocalePref.mock.calls.length, 1));
  assert.equal(setItem.mock.calls.at(-1)?.[0], 'gromo.locale');
  assert.equal(setItem.mock.calls.at(-1)?.[1], 'en');
  assert.equal(exposed.setLocalePref.mock.calls[0][0], 'en');
  assert.ok(notifyMock.mock.calls.some((c: unknown[]) => c[0] === 'Language changed'));

  // 저장 → 적용 → 알림 순서를 전역 호출 순번으로 확인한다
  const setItemOrder = setItem.mock.invocationCallOrder.at(-1) as number;
  const applyOrder = exposed.setLocalePref.mock.invocationCallOrder[0] as number;
  const notifyOrder = notifyMock.mock.invocationCallOrder.at(-1) as number;
  assert.ok(setItemOrder < applyOrder);
  assert.ok(applyOrder < notifyOrder);
});

test('AsyncStorage 저장이 실패하면 적용하지 않고 저장 실패 문구만 알린다', async () => {
  let exposed: any;
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockRejectedValueOnce(new Error('AsyncStorage 쓰기 실패'));
  const s = await render(
    <Harness route="language" full localePref="ko" expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.press(s.getByLabelText('English'));

  await waitFor(() =>
    assert.ok(
      notifyMock.mock.calls.some(
        (c: unknown[]) => c[0] === '언어 설정을 저장하지 못했어요. 다시 시도해 주세요.',
      ),
    ),
  );
  assert.equal(exposed.setLocalePref.mock.calls.length, 0);
});

test('현재 pref와 같은 값을 다시 탭하면 저장·적용·알림을 모두 생략한다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="language" full localePref="ko" expose={(value: any) => (exposed = value)} />,
  );
  const setItem = AsyncStorage.setItem as jest.Mock;
  const priorSetItemCalls = setItem.mock.calls.length;

  await fireEvent.press(s.getByLabelText('한국어'));

  assert.equal(setItem.mock.calls.length, priorSetItemCalls);
  assert.equal(exposed.setLocalePref.mock.calls.length, 0);
  assert.equal(notifyMock.mock.calls.length, 0);
});

test('기기 언어가 ko일 때 ko에서 기기 언어 따름으로 바꾸면 저장·적용은 되지만 적용 언어가 같아 알림은 없다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="language" full localePref="ko" expose={(value: any) => (exposed = value)} />,
  );
  const setItem = AsyncStorage.setItem as jest.Mock;

  await fireEvent.press(s.getByLabelText('기기 언어 따름, 지금은 한국어'));

  await waitFor(() => assert.equal(exposed.setLocalePref.mock.calls.length, 1));
  assert.equal(setItem.mock.calls.at(-1)?.[0], 'gromo.locale');
  assert.equal(setItem.mock.calls.at(-1)?.[1], 'system');
  assert.equal(exposed.setLocalePref.mock.calls[0][0], 'system');
  assert.equal(notifyMock.mock.calls.length, 0);
});

test('첫 탭의 저장이 끝나기 전 두 번째 탭이 들어오면 무시하고, 첫 탭 완료 뒤에만 적용·알림한다', async () => {
  let exposed: any;
  const setItem = AsyncStorage.setItem as jest.Mock;
  let resolveSetItem = () => {};
  setItem.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveSetItem = resolve)));
  const s = await render(
    <Harness route="language" full localePref="ko" expose={(value: any) => (exposed = value)} />,
  );
  const priorSetItemCalls = setItem.mock.calls.length;

  await fireEvent.press(s.getByLabelText('English')); // 첫 탭 — setItem 이 pending
  await fireEvent.press(s.getByLabelText('English')); // 겹침 탭 — pickingLocale 가드로 즉시 반환돼야 함

  assert.equal(setItem.mock.calls.length, priorSetItemCalls + 1); // setItem 은 1회만
  assert.equal(exposed.setLocalePref.mock.calls.length, 0); // 첫 탭도 아직 안 끝남

  await act(async () => resolveSetItem());

  await waitFor(() => assert.equal(exposed.setLocalePref.mock.calls.length, 1));
  assert.equal(exposed.setLocalePref.mock.calls[0][0], 'en');
  assert.ok(notifyMock.mock.calls.some((c: unknown[]) => c[0] === 'Language changed'));
});

test('기기 언어가 지원 언어(ko·en)가 아니면 기기 언어 따름 sub 에 미지원 안내를 덧붙인다', async () => {
  mockLocales.mockReturnValue([{ languageCode: 'ja', languageTag: 'ja-JP' }]);

  const s = await render(<Harness route="language" full localePref="system" />);

  assert.ok(s.getByText(/기기 언어 미지원/));
});

test('완공된 상점 첫 진입에서 강아지 이야기를 한 번만 보여준다', async () => {
  let exposed: any;
  const s = await render(<Harness route="shop" full expose={(value: any) => (exposed = value)} />);

  s.getByText(/드디어 마지막 건물까지 완성됐네/);
  await fireEvent.press(s.getByText('다음'));
  s.getByText(/상점이 열릴 날만 기다리면서/);
  await fireEvent.press(s.getByText('다음'));
  s.getByText(/이제 이 섬을 너희답게 꾸밀 차례야/);
  await fireEvent.press(s.getByText('상점 둘러보기'));

  await waitFor(() => {
    assert.ok(exposed.actions.includes('SHOP_GUIDE_DONE'));
    assert.equal(s.queryByText(/드디어 마지막 건물까지 완성됐네/), null);
  });
  s.getByText('강아지 상점');
});

test('상점 안내 중 시스템 뒤로가기는 완료 처리 없이 상점을 닫는다', async () => {
  let exposed: any;
  const s = await render(<Harness route="shop" full expose={(value: any) => (exposed = value)} />);

  await fireEvent(s.getByTestId('shop-guide'), 'requestClose');

  assert.equal(exposed.home.mock.calls.length, 1);
  assert.ok(!exposed.actions.includes('SHOP_GUIDE_DONE'));
});

test('일반 상점 구매의 SOCIAL_LOGIN_REQUIRED는 오류 알림 대신 회원 전환을 연다', async () => {
  const gate = new ApiError('SOCIAL_LOGIN_REQUIRED', '회원 연동이 필요합니다.', 403);
  const offer = jest.fn(() => true);
  mockShopState.detail = {
    id: 'scarf',
    title: '바다 스카프',
    kind: 'clothes',
    price: 20,
    currency: 'village_points',
    ownerType: 'user',
    productVersion: 3,
    previewUrl: null,
    owned: false,
    available: true,
    blockedReason: null,
    requiredBuilding: null,
    requiredProduct: null,
    targetBuilding: null,
  };
  mockShopState.wallets = { villagePoints: 100 };
  mockShopBuy.mockRejectedValue(gate);

  const s = await render(
    <Harness route="product" detail="scarf" api={() => ({})} conversion={{ offer }} />,
  );

  await fireEvent.press(s.getByText('20마리로 구매'));
  await waitFor(() => expect(offer).toHaveBeenCalledWith(gate));
  assert.equal(notifyMock.mock.calls.length, 0);
});

test('가입 닉네임은 마지막 글자를 지운 뒤 새 이름을 입력할 수 있고 빈 편집값은 복원되지 않는다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="character" full expose={(value: any) => (exposed = value)} />,
  );
  const nickname = s.getByLabelText('닉네임');

  assert.equal(nickname.props.value, '수빈');
  await fireEvent.changeText(nickname, '수');
  await fireEvent.changeText(nickname, '');
  assert.equal(s.getByLabelText('닉네임').props.value, '');
  await fireEvent.press(s.getByLabelText('내 고양이와 시작'));
  assert.equal(exposed.go.mock.calls.length, 0);

  await fireEvent.changeText(s.getByLabelText('닉네임'), 'abc');
  assert.equal(s.getByLabelText('닉네임').props.value, 'abc');
  await fireEvent.press(s.getByText('내 고양이와 시작'));
  assert.ok(exposed.go.mock.calls.some((call: unknown[]) => call[0] === 'chooseIsland'));
});

test('프로필 최종 저장은 빈 닉네임을 차단한다', async () => {
  let exposed: any;
  mockUpdateProfile.mockResolvedValue({
    id: 'u1',
    name: 'abc',
    catColor: 'black',
    mainIslandId: 'i1',
  });
  const s = await render(
    <Harness route="profile" full api={() => ({})} expose={(value: any) => (exposed = value)} />,
  );

  await fireEvent.changeText(s.getByLabelText('닉네임'), '');
  await fireEvent.press(s.getByText('저장'));

  assert.equal(mockUpdateProfile.mock.calls.length, 0);
  assert.ok(notifyMock.mock.calls.some((call) => call[0] === '닉네임을 입력해 주세요.'));
  assert.equal(backMock.mock.calls.length, 0);

  await fireEvent.changeText(s.getByLabelText('닉네임'), 'abc');
  await fireEvent.press(s.getByText('저장'));
  await waitFor(() => assert.equal(mockUpdateProfile.mock.calls.length, 1));
  assert.deepEqual(mockUpdateProfile.mock.calls[0][0], { name: 'abc', catColor: 'black' });
  await waitFor(() => assert.ok(exposed.actions.includes('PROFILE')));
  assert.equal(backMock.mock.calls.length, 1);
});

test('서버 이름이 없는 신규 계정은 닉네임이 빈 채 placeholder만 보이고 저장되지 않는다', async () => {
  const s = await render(<Harness route="character" initial={initialState()} api={() => ({})} />);
  const nickname = s.getByLabelText('닉네임');

  assert.equal(nickname.props.value, '');
  assert.equal(nickname.props.placeholder, '닉네임을 입력해 주세요');
  await fireEvent.press(s.getByText('내 고양이와 시작'));
  assert.equal(mockUpdateProfile.mock.calls.length, 0);

  await fireEvent.changeText(s.getByLabelText('닉네임'), 'abc');
  await fireEvent.press(s.getByText('내 고양이와 시작'));
  await waitFor(() => assert.equal(mockUpdateProfile.mock.calls.length, 1));
  assert.deepEqual(mockUpdateProfile.mock.calls[0][0], { name: 'abc', catColor: 'black' });
});

test('프로필은 /me 에서 채택한 연결 제공자들을 표시한다', async () => {
  const initial = {
    ...initialState(true),
    name: '수빈',
    linkedProviders: ['google', 'kakao', 'line'],
  };
  const s = await render(<Harness route="profile" initial={initial} api={() => ({})} />);
  assert.ok(s.getByText('수빈님의 GROMO 계정 · Google · 카카오 · LINE'));
});

test('프로필 저장은 PATCH 성공 뒤에만 PROFILE을 디스패치하고, 진행 중 중복 탭은 한 번만 보낸다', async () => {
  let exposed: any;
  let release: (v: unknown) => void = () => {};
  mockUpdateProfile.mockImplementation(() => new Promise((resolve) => (release = resolve)));
  const s = await render(
    <Harness route="profile" full api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  await fireEvent.changeText(s.getByLabelText('닉네임'), '  구름이  ');
  await fireEvent.press(s.getByText('저장'));
  await fireEvent.press(s.getByText('저장'));
  assert.equal(mockUpdateProfile.mock.calls.length, 1);
  // 본문은 trim 된 닉네임과 현재 고양이 색 — 서버 계약 키만 보낸다
  assert.deepEqual(mockUpdateProfile.mock.calls[0][0], { name: '구름이', catColor: 'black' });
  assert.ok(!exposed.actions.includes('PROFILE'));

  await act(async () =>
    release({ id: 'u1', name: '구름이', catColor: 'calico', mainIslandId: 'i1' }),
  );
  await waitFor(() => assert.ok(exposed.actions.includes('PROFILE')));
  // 저장본이 정본 — 응답의 name/catColor 가 로컬을 덮는다
  assert.equal(
    notifyMock.mock.calls.some((c) => c[0] === '저장했어요.'),
    true,
  );
  assert.equal(backMock.mock.calls.length, 1);
});

test('프로필 저장 실패는 PROFILE·뒤로가기·성공 문구 없이 서버 오류 문구만 알린다', async () => {
  let exposed: any;
  mockUpdateProfile.mockRejectedValue(
    new ApiError('NICKNAME_DUPLICATE', '이미 쓰는 닉네임이에요.', 409),
  );
  const s = await render(
    <Harness route="profile" full api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  await fireEvent.changeText(s.getByLabelText('닉네임'), '구름이');
  await fireEvent.press(s.getByText('저장'));
  await waitFor(() =>
    assert.ok(notifyMock.mock.calls.some((c) => c[0] === '이미 쓰는 닉네임이에요.')),
  );
  assert.ok(!exposed.actions.includes('PROFILE'));
  assert.equal(backMock.mock.calls.length, 0);
  assert.equal(
    notifyMock.mock.calls.some((c) => c[0] === '저장했어요.'),
    false,
  );

  await fireEvent.press(s.getByText('저장'));
  await waitFor(() => assert.equal(mockUpdateProfile.mock.calls.length, 2));
  assert.equal(mockUpdateProfile.mock.calls[0][1], mockUpdateProfile.mock.calls[1][1]);
});

test('프로필 저장 중에는 후속 편집을 받지 않는다', async () => {
  let release: (v: unknown) => void = () => {};
  mockUpdateProfile.mockImplementation(() => new Promise((resolve) => (release = resolve)));
  const s = await render(<Harness route="profile" full api={() => ({})} />);

  await fireEvent.changeText(s.getByLabelText('닉네임'), '구름이');
  await fireEvent.press(s.getByText('저장'));
  await fireEvent.changeText(s.getByLabelText('닉네임'), '바다');

  assert.equal(s.getByLabelText('닉네임').props.value, '구름이');
  await act(async () =>
    release({ id: 'u1', name: '구름이', catColor: 'black', mainIslandId: 'i1' }),
  );
});

test('목업 모드 프로필 저장은 API 없이 로컬 PROFILE을 갱신한다', async () => {
  let exposed: any;
  const s = await render(<Harness route="profile" full expose={(x: any) => (exposed = x)} />);

  await fireEvent.changeText(s.getByLabelText('닉네임'), '  구름이  ');
  await fireEvent.press(s.getByText('저장'));

  assert.equal(mockUpdateProfile.mock.calls.length, 0);
  assert.ok(exposed.actions.includes('PROFILE'));
  assert.equal(
    notifyMock.mock.calls.some((c) => c[0] === '저장했어요.'),
    true,
  );
  assert.equal(backMock.mock.calls.length, 1);
});

test('로그아웃이 기기에 기록되지 않으면 LOGOUT·로그인 이동 없이 설정에 남는다', async () => {
  let exposed: any;
  const s = await render(
    <Harness route="profile" api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );
  exposed.signOut.mockResolvedValueOnce(false);

  await fireEvent.press(s.getByText('로그아웃'));
  await waitFor(() => assert.equal(exposed.signOut.mock.calls.length, 1));
  assert.ok(!exposed.actions.includes('LOGOUT'));
  assert.equal(exposed.reset.mock.calls.length, 0);

  await fireEvent.press(s.getByText('로그아웃'));
  await waitFor(() => assert.equal(exposed.reset.mock.calls[0]?.[0], 'login'));
  assert.ok(exposed.actions.includes('LOGOUT'));
});

test('회원 탈퇴는 DELETE 성공 뒤에만 로그아웃·로컬 삭제·로그인 이동을 수행한다', async () => {
  let exposed: any;
  mockWithdrawAccount.mockResolvedValue({ deleted: true });
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  const s = await render(
    <Harness route="profile" api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  await fireEvent.press(s.getByText('회원 탈퇴'));
  await waitFor(() => assert.equal(mockWithdrawAccount.mock.calls.length, 1));
  await waitFor(() => assert.equal(exposed.signOut.mock.calls.length, 1));
  // 탈퇴 계정의 공부시간이 런처 위젯에 남지 않게 비운다.
  assert.equal(mockClearStudyWidget.mock.calls.length, 1);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  assert.ok(exposed.actions.includes('DELETE_ACCOUNT'));
  assert.equal(exposed.reset.mock.calls[0][0], 'login');
  await clearLocalDataOwner();
  await clearSession();
  assert.equal(getLastSessionUserId(), null);
});

test('탈퇴 뒤 로컬 소유자 정리를 확정하지 못하면 완료로 넘어가지 않고 로컬 정리만 재시도한다', async () => {
  let exposed: any;
  mockWithdrawAccount.mockResolvedValue({ deleted: true });
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  // 주 표식(AsyncStorage)·보조 표식(SecureStore)·소유자 삭제가 모두 실패하는 기기 저장소.
  const setAsync = AsyncStorage.setItem as jest.Mock;
  const setSecure = SecureStore.setItemAsync as jest.Mock;
  const deleteSecure = SecureStore.deleteItemAsync as jest.Mock;
  const real = [
    setAsync.getMockImplementation(),
    setSecure.getMockImplementation(),
    deleteSecure.getMockImplementation(),
  ] as const;
  // 탈퇴 의도 표식은 요청 전에 기록돼야 탈퇴 요청이 나간다 — 그 쓰기만 통과시킨다.
  setAsync.mockImplementation(async (key: string, value: string) =>
    key === 'gromo.withdrawalIntent'
      ? real[0]!(key, value)
      : Promise.reject(new Error('AsyncStorage 쓰기 실패')),
  );
  setSecure.mockImplementation(async () => Promise.reject(new Error('키체인 쓰기 실패')));
  deleteSecure.mockImplementation(async () => Promise.reject(new Error('키체인 삭제 실패')));
  const s = await render(
    <Harness route="profile" api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  try {
    await fireEvent.press(s.getByText('회원 탈퇴'));
    await waitFor(() =>
      assert.ok(
        notifyMock.mock.calls.some(
          (c) => c[0] === '기기에 남은 데이터를 정리하지 못했어요. 다시 시도해 주세요.',
        ),
      ),
    );
    assert.equal(mockWithdrawAccount.mock.calls.length, 1);
    assert.equal(exposed.signOut.mock.calls.length, 0);
    assert.ok(!exposed.actions.includes('DELETE_ACCOUNT'));
    assert.equal(exposed.reset.mock.calls.length, 0);
    await waitFor(() => assert.ok(s.getByText('기기 데이터 정리 다시 시도')));
  } finally {
    setAsync.mockImplementation(real[0]);
    setSecure.mockImplementation(real[1]);
    deleteSecure.mockImplementation(real[2]);
  }

  // 저장소가 회복되면 재시도는 탈퇴 API 없이 로컬 정리부터 이어 완료한다.
  await fireEvent.press(s.getByText('기기 데이터 정리 다시 시도'));
  await waitFor(() => assert.equal(exposed.reset.mock.calls[0]?.[0], 'login'));
  assert.equal(mockWithdrawAccount.mock.calls.length, 1);
  assert.equal(exposed.signOut.mock.calls.length, 1);
  assert.ok(exposed.actions.includes('DELETE_ACCOUNT'));
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  await clearSession();
  assert.equal(getLastSessionUserId(), null);
});

test('탈퇴는 1.x 로컬 버킷을 지우고, 지우지 못하면 완료하지 않고 재시도에서 로컬 정리만 다시 한다', async () => {
  let exposed: any;
  mockWithdrawAccount.mockResolvedValue({ deleted: true });
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  await AsyncStorage.setItem(
    'gromo:ownedItems:v2',
    JSON.stringify({ 'withdrawn-user': ['i1'], 'other-user': ['i2'] }),
  );
  await AsyncStorage.setItem('gromo:character:v1', JSON.stringify({ 'withdrawn-user': {} }));
  // jest.setup 의 AsyncStorage 는 이미 jest.fn 이라 spyOn·mockRestore 는 구현을 지운다. 한 번만 실패시킨다.
  const multiRemove = AsyncStorage.multiRemove as jest.Mock;
  const realMultiRemove = multiRemove.getMockImplementation()!;
  multiRemove.mockRejectedValueOnce(new Error('AsyncStorage 삭제 실패'));
  const s = await render(
    <Harness route="profile" api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  try {
    await fireEvent.press(s.getByText('회원 탈퇴'));
    await waitFor(() => assert.ok(s.getByText('기기 데이터 정리 다시 시도')));
    assert.equal(mockWithdrawAccount.mock.calls.length, 1);
    assert.equal(exposed.signOut.mock.calls.length, 0);
    assert.ok(!exposed.actions.includes('DELETE_ACCOUNT'));
    // 정리를 확정하기 전에는 위젯도 건드리지 않는다(완료 시점에 비운다).
    assert.equal(mockClearStudyWidget.mock.calls.length, 0);
    // 1.x 정리가 실패하면 소유자 표식도 아직 지우지 않는다.
    assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'withdrawn-user');

    await fireEvent.press(s.getByText('기기 데이터 정리 다시 시도'));
    await waitFor(() => assert.equal(exposed.reset.mock.calls[0]?.[0], 'login'));
  } finally {
    // 실패가 소비되지 않았으면 다음 테스트로 새지 않게 큐를 비운다(구현은 유지된다).
    multiRemove.mockReset();
    multiRemove.mockImplementation(realMultiRemove);
  }
  assert.equal(mockWithdrawAccount.mock.calls.length, 1);
  assert.deepEqual(JSON.parse((await AsyncStorage.getItem('gromo:ownedItems:v2')) ?? 'null'), {
    'other-user': ['i2'],
  });
  assert.equal(await AsyncStorage.getItem('gromo:character:v1'), null);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  await AsyncStorage.removeItem('gromo:ownedItems:v2');
  await clearSession();
});

test('탈퇴 응답을 잃고 재시도가 USER_NOT_FOUND 면 같은 멱등 키로 보냈고 탈퇴 완료로 로컬 정리를 이어 간다', async () => {
  let exposed: any;
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'withdrawn-user' });
  await rememberLocalDataOwner('withdrawn-user');
  await AsyncStorage.setItem('gromo:character:v1', JSON.stringify({ 'withdrawn-user': {} }));
  // 1차: 서버는 커밋했지만 응답이 유실됐다.
  mockWithdrawAccount.mockRejectedValueOnce(
    new ApiError('CLIENT_TIMEOUT', '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.', 0),
  );
  // 2차: 계정이 이미 없다 — 갱신 경로가 세션을 먼저 비운 뒤 USER_NOT_FOUND 로 던지는 경우까지.
  mockWithdrawAccount.mockImplementationOnce(async () => {
    await clearSession();
    throw new ApiError('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.', 404);
  });
  const s = await render(
    <Harness route="profile" api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  await fireEvent.press(s.getByText('회원 탈퇴'));
  await waitFor(() => assert.equal(mockWithdrawAccount.mock.calls.length, 1));
  await waitFor(() =>
    assert.ok(
      notifyMock.mock.calls.some((c) => c[0] === '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'),
    ),
  );
  assert.equal(exposed.reset.mock.calls.length, 0);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), 'withdrawn-user');

  await fireEvent.press(s.getByText('회원 탈퇴'));
  await waitFor(() => assert.equal(exposed.reset.mock.calls[0]?.[0], 'login'));
  const [[firstKey], [retryKey]] = mockWithdrawAccount.mock.calls;
  assert.ok(firstKey);
  assert.equal(retryKey, firstKey);
  assert.ok(exposed.actions.includes('DELETE_ACCOUNT'));
  // 세션이 먼저 비워졌어도 호출 전에 잡아 둔 계정으로 1.x 버킷·소유자 표식을 지운다.
  assert.equal(await AsyncStorage.getItem('gromo:character:v1'), null);
  assert.equal(await SecureStore.getItemAsync('gromo.lastUserId'), null);
  assert.equal(getLastSessionUserId(), null);
  await clearSession();
});

test('회원 탈퇴 실패는 로그아웃·로컬 삭제·화면 이동 없이 오류를 알린다', async () => {
  let exposed: any;
  mockWithdrawAccount.mockRejectedValue(new ApiError('STATE_CONFLICT', '탈퇴할 수 없어요.', 409));
  const s = await render(
    <Harness route="profile" api={() => ({})} expose={(x: any) => (exposed = x)} />,
  );

  await fireEvent.press(s.getByText('회원 탈퇴'));
  await waitFor(() =>
    assert.ok(
      notifyMock.mock.calls.some(
        (c) => c[0] === '섬 정보가 바뀌었어요. 최신 상태로 다시 시도해 주세요.',
      ),
    ),
  );
  assert.equal(exposed.signOut.mock.calls.length, 0);
  assert.ok(!exposed.actions.includes('DELETE_ACCOUNT'));
  assert.equal(exposed.reset.mock.calls.length, 0);
  assert.equal(mockClearStudyWidget.mock.calls.length, 0);
});

// ── GROMO-2138 서버 모드 홈 진입 ──
const syncCurrent = (d: any, id = 'srv-1', name = '복구 섬') =>
  d({
    type: 'ISLAND_SYNC',
    memberships: {
      items: [islandSummary({ id, name })],
      nextCursor: null,
      currentIslandId: id,
      lossReason: null,
    },
  });
const homeFacts = (islandId = 'srv-1', completedBuildings: string[] = ['hall']) => ({
  islandId,
  completedBuildings,
  members: [],
  home: {
    island: {
      id: islandId,
      name: '복구 섬',
      intro: '',
      approvalRequired: false,
      maxMembers: 15,
      role: 'host',
    },
    focusSummary: { totalSeconds: 3725 },
    wallets: { villagePoints: 0 },
  },
});

test('서버 첫 생성은 소속 없음 확인 뒤 guide로 진입한다', async () => {
  let exposed: any;
  const api = (dispatch: any) => ({
    create: jest.fn(async () => syncCurrent(dispatch, 'new-1', '새 섬')),
  });
  const s = await render(
    <Harness
      route="createIsland"
      api={api}
      seed={(d: any) =>
        d({
          type: 'ISLAND_SYNC',
          memberships: { items: [], currentIslandId: null, lossReason: null },
        })
      }
      expose={(x: any) => (exposed = x)}
    />,
  );
  await fireEvent.changeText(s.getByLabelText('섬 이름'), '새 섬');
  await fireEvent.press(s.getByLabelText('섬 만들기'));
  await waitFor(() => s.getByText('섬을 만들었어요'));
  await fireEvent.press(s.getByText('섬으로 가기'));
  assert.equal(exposed.reset.mock.calls.at(-1)[0], 'guide');
});

test.each(['joinIsland', 'approval', 'chooseIsland'])(
  '서버 첫 소속 확인 카드 %s는 첫 안내를 연다',
  async (route) => {
    let exposed: any;
    const screen = await render(
      <Harness
        route={route}
        api={() => ({ sync: jest.fn(async () => {}), explore: jest.fn(async () => {}) })}
        seed={(d: any) => {
          d({
            type: 'ISLAND_SYNC',
            memberships: { items: [], currentIslandId: null, lossReason: null },
          });
          syncCurrent(d);
          if (route === 'joinIsland')
            d({
              type: 'ISLAND_CANDIDATES',
              items: [islandSummary({ id: 'srv-1' })],
              nextCursor: null,
              reset: true,
            });
          if (route === 'approval')
            d({
              type: 'ISLAND_REQUEST',
              request: { id: 'approved', islandId: 'srv-1', status: 'approved', version: 2 },
            });
        }}
        expose={(x: any) => (exposed = x)}
      />,
    );
    await fireEvent.press(screen.getByText('섬으로 가기'));
    expect(exposed.reset).toHaveBeenCalledWith('guide');
  },
);

test('기존 사용자의 추가 섬 생성은 첫 안내를 반복하지 않는다', async () => {
  let exposed: any;
  const screen = await render(
    <Harness
      route="createIsland"
      api={(d: any) => ({ create: jest.fn(async () => syncCurrent(d, 'second')) })}
      seed={(d: any) => syncCurrent(d, 'first')}
      expose={(x: any) => (exposed = x)}
    />,
  );
  await fireEvent.changeText(screen.getByLabelText('섬 이름'), '두 번째 섬');
  await fireEvent.press(screen.getByLabelText('섬 만들기'));
  await fireEvent.press(screen.getByText('섬으로 가기'));
  expect(exposed.reset).toHaveBeenCalledWith('home');
});

test('재시작 복구 카드에서도 섬으로 가기로 home 에 들어간다', async () => {
  let exposed: any;
  const api = () => ({ sync: jest.fn(async () => {}) });
  const s = await render(
    <Harness
      route="chooseIsland"
      api={api}
      seed={(d: any) => syncCurrent(d)}
      expose={(x: any) => (exposed = x)}
    />,
  );
  await waitFor(() => s.getByText('가입이 확인됐어요'));
  await fireEvent.press(s.getByText('섬으로 가기'));
  assert.equal(exposed.reset.mock.calls.at(-1)[0], 'home');
});

test('current 가 없으면 섬으로 가기를 띄우지 않는다', async () => {
  const api = () => ({ sync: jest.fn(async () => {}) });
  const s = await render(<Harness route="chooseIsland" api={api} />);
  await waitFor(() => s.getByText('어디에서 시작할까요?'));
  assert.equal(s.queryByText('섬으로 가기'), null);
});

test('서버 모드 home 은 스냅샷 전에는 목업 섬 대신 로딩을, 실패면 재시도를 보여준다', async () => {
  const retryHome = jest.fn();
  const api = () => ({});
  const s = await render(
    <Harness
      route="home"
      api={api}
      seed={(d: any) => syncCurrent(d)}
      homeError
      retryHome={retryHome}
    />,
  );
  await waitFor(() => s.getByText('섬 정보를 불러오지 못했어요'));
  assert.equal(s.queryByTestId('final-island-world'), null);
  await fireEvent.press(s.getByText('다시 시도'));
  assert.equal(retryHome.mock.calls.length, 1);
});

test('서버 모드 home 은 스냅샷의 완공 건물과 오늘 집중을 그리고 로컬 건설 카드를 띄우지 않는다', async () => {
  const api = () => ({});
  const s = await render(
    <Harness
      route="home"
      api={api}
      seed={(d: any) => {
        syncCurrent(d);
        d({ type: 'SERVER_HOME', facts: homeFacts() });
      }}
    />,
  );
  await waitFor(() => s.getByTestId('final-island-world'));
  // 문은 스냅샷에서 완공된 건물만 열린다 — 회관은 있고 게시판은 없다
  s.getByLabelText(buildingNames.hall);
  assert.equal(s.queryByLabelText(buildingNames.board), null);
  s.getByText('01:02:05');
  // 홈 HUD 에 스냅샷의 섬 이름이 보인다
  s.getByText('복구 섬');
  // 스크린리더는 HUD 알약을 한 문장으로 읽는다
  s.getByLabelText('복구 섬 오늘 집중 01:02:05');
  // 로컬 비용으로 그리는 건설 카드는 서버 모드에서 띄우지 않는다
  assert.equal(s.queryByText(/짓기$/), null);
});

test('섬 만들기 이름·소개 입력은 서버 계약 50/200자로 막는다(2-19 H24)', async () => {
  const s = await render(<Harness route="createIsland" api={() => ({})} />);
  assert.equal(s.getByLabelText('섬 이름').props.maxLength, 50);
  assert.equal(s.getByLabelText('섬 소개').props.maxLength, 200);
});

test('섬 만들기 이름 칸은 글자 수를 보여 주고 한도에 닿으면 안내한다(2-15)', async () => {
  const s = await render(<Harness route="createIsland" api={() => ({})} />);
  assert.ok(s.getByText('0/50'));
  await fireEvent.changeText(s.getByLabelText('섬 이름'), '가'.repeat(50));
  assert.ok(s.getByText('50자까지 쓸 수 있어요 · 50/50'));
});

test('대표 섬 선택은 서버 소속만 표시하고 저장 성공 뒤에 닫는다', async () => {
  const initial = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [
        islandSummary({ id: 'a', name: '서버 A' }),
        islandSummary({ id: 'b', name: '서버 B' }),
      ],
      currentIslandId: 'a',
      nextCursor: null,
      lossReason: null,
    },
    mainIslandId: 'a',
  });
  let finish!: () => void;
  const save = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const screen = await render(
    <Harness
      route="mainIsland"
      initial={initial}
      api={() => ({ sync: async () => {}, setMain: save })}
    />,
  );
  await screen.findByText('서버 B');
  assert.equal(screen.queryByText('소다 섬'), null);
  await fireEvent.press(screen.getByLabelText('서버 B'));
  await fireEvent.press(screen.getByText('대표 섬으로 저장하기'));
  assert.equal(save.mock.calls.length, 1);
  assert.equal(backMock.mock.calls.length, 0);
  await act(async () => finish());
  assert.equal(backMock.mock.calls.length, 1);
});

test('대표 섬 저장 실패는 화면에 남아 재시도할 수 있다', async () => {
  const initial = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [
        islandSummary({ id: 'a', name: '서버 A' }),
        islandSummary({ id: 'b', name: '서버 B' }),
      ],
      currentIslandId: 'a',
      nextCursor: null,
      lossReason: null,
    },
    mainIslandId: 'a',
  });
  const save = jest
    .fn()
    .mockRejectedValueOnce(new ApiError('CLIENT_TIMEOUT', 'lost', 0))
    .mockResolvedValue(undefined);
  const screen = await render(
    <Harness
      route="mainIsland"
      initial={initial}
      api={() => ({ sync: async () => {}, setMain: save })}
    />,
  );
  await screen.findByText('서버 B');
  await fireEvent.press(screen.getByLabelText('서버 B'));
  await fireEvent.press(screen.getByText('대표 섬으로 저장하기'));
  await screen.findByText('연결을 확인한 뒤 다시 시도해 주세요.');
  assert.equal(backMock.mock.calls.length, 0);
  await fireEvent.press(screen.getByText('대표 섬으로 저장하기'));
  await waitFor(() => assert.equal(backMock.mock.calls.length, 1));
});

test('승인 완료·현재 섬 없음에서도 명시적으로 입장하고 서버 성공을 기다린다', async () => {
  let initial = reducer(initialState(false), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [islandSummary({ id: 'approved', name: '승인된 섬' })],
      currentIslandId: null,
      nextCursor: null,
      lossReason: null,
    },
  });
  initial = reducer(initial, {
    type: 'ISLAND_REQUEST',
    request: { id: 'req-approved', islandId: 'approved', status: 'approved', version: 2 },
  });
  let finish!: () => void;
  const switchCurrent = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let exposed: any;
  const screen = await render(
    <Harness
      route="approval"
      detail="approved"
      initial={initial}
      expose={(value: any) => {
        exposed = value;
      }}
      api={() => ({ explore: async () => {}, switchCurrent })}
    />,
  );
  await act(async () => {});
  await fireEvent.press(screen.getByTestId('enter-home'));
  await waitFor(() => assert.equal(switchCurrent.mock.calls.length, 1));
  assert.equal(exposed.reset.mock.calls.length, 0);
  await act(async () => finish());
  assert.equal(exposed.reset.mock.calls[0][0], 'guide');
});

test('현재 섬 없이 재실행한 기존 주민도 가입한 섬 선택으로 갈 수 있다', async () => {
  const initial = reducer(initialState(false), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [islandSummary({ id: 'approved' })],
      currentIslandId: null,
      nextCursor: null,
      lossReason: null,
    },
  });
  let exposed: any;
  const screen = await render(
    <Harness
      route="chooseIsland"
      initial={initial}
      expose={(value: any) => {
        exposed = value;
      }}
      api={() => ({})}
    />,
  );
  await fireEvent.press(screen.getByText('가입한 섬으로 들어가기'));
  assert.equal(exposed.go.mock.calls[0][0], 'currentIsland');
});

describe('en', () => {
  test.each(['mainIsland', 'currentIsland'] as const)(
    'en 섬 선택은 제목·버튼·오류를 번역한다: %s',
    async (route) => {
      mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
      applyLocalePref('system');
      const screen = await render(
        <Harness
          route={route}
          api={() => ({
            sync: async () => {
              throw new ApiError('CLIENT_TIMEOUT', '한국어 서버 오류', 0);
            },
          })}
        />,
      );
      await screen.findByText('Reload');
      assert.ok(
        screen.getByText(route === 'mainIsland' ? 'Change Main Island' : 'Change Current Island'),
      );
      assert.ok(
        screen.getByText(route === 'mainIsland' ? 'Save as Main Island' : 'Go to Selected Island'),
      );
      assert.equal(screen.queryByText('한국어 서버 오류'), null);
      assert.equal(screen.queryByText('연결을 확인한 뒤 다시 시도해 주세요.'), null);
    },
  );

  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref('system');
  });

  test('en 로케일 — 캐릭터 단계는 영문 제목·문구를 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="character" api={() => ({})} />);

    assert.ok(s.getByText('My Cat'));
    assert.ok(s.getByText('Which cat should we start with?'));
  });

  test('en 로케일 — 내 배 시트는 영문 제목과 행을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="boat" full />);

    assert.ok(s.getByText('My Raft'));
    assert.ok(s.getByText('Customize Items'));
  });

  test('en 로케일 — 내 정보는 영문 라벨을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="profile" full api={() => ({})} />);

    assert.ok(s.getByText('My Info'));
    assert.ok(s.getByText('Nickname'));
  });

  test('en 로케일 — 앱 설정은 영문 섹션·행을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="settings" full />);

    assert.ok(s.getByText('App Settings'));
    assert.ok(s.getByText('Notifications'));
  });

  test('en 로케일 — 서버 모드 home 오류 분기는 영문 문구와 재시도를 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const retryHome = jest.fn();
    const api = () => ({});
    const s = await render(
      <Harness
        route="home"
        api={api}
        seed={(d: any) => syncCurrent(d)}
        homeError
        retryHome={retryHome}
      />,
    );

    await waitFor(() => s.getByText("Couldn't load your island info."));
    await fireEvent.press(s.getByText('Retry'));
    assert.equal(retryHome.mock.calls.length, 1);
  });

  test('en 로케일 — 첫 섬 선택은 영문 제목과 두 선택지를 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="chooseIsland" api={() => ({})} />);

    assert.ok(s.getByText('Choose Your First Island'));
    assert.ok(s.getByText('Create an island and start alone'));
    assert.ok(s.getByText('Join an existing island'));
  });

  test('en 로케일 — 새 섬 만들기는 영문 제목과 입력 라벨을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="createIsland" api={() => ({})} />);

    assert.ok(s.getByText('Create a New Island'));
    assert.ok(s.getByLabelText('Island Name'));
    assert.ok(s.getByText('Create Island'));
  });

  // 대사 배열이 렌더 안에서 만들어지므로(lines = [t(...), ...]) 언어 전환 회귀를 여기서 잡는다.
  test('en 로케일 — 몽돌 가이드는 첫 대사와 다음 버튼을 영문으로 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="guide" />);

    assert.ok(
      s.getByText(
        "Hey! You're a new face.\nI'm Mongdol. I've lived on this island for a long time.",
      ),
    );
    assert.ok(s.getByText('Next'));
  });

  test('en 로케일 — 섬 찾기(서버)는 영문 제목과 가입 신청 버튼을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const api = (dispatch: any) => ({
      explore: jest.fn(async () => {
        dispatch({
          type: 'ISLAND_CANDIDATES',
          items: [islandSummary({ approvalRequired: true })],
          nextCursor: null,
          reset: true,
        });
      }),
    });
    const s = await render(<Harness route="joinIsland" api={api} />);

    assert.ok(s.getByText('Find an Island'));
    await waitFor(() => assert.ok(s.getByText('Join Request')));
  });

  test('en 로케일 — 초대 코드 모달은 영문 제목과 입력 라벨을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(<Harness route="chooseIsland" api={() => ({})} />);

    await fireEvent.press(s.getByTestId('invite-open'));
    assert.ok(s.getByText('Enter Invite Code'));
    assert.ok(s.getByLabelText('Invite code'));
  });

  // GROMO-2252 r3 1a: 대체 섬 이름(pendingIslandFallback)이 {{island}}에 들어가도
  // en 템플릿에 더 이상 따옴표를 두르지 않는다("the island you applied to" 는 실제 이름이 아니다).
  test('en 로케일 — 대체 섬 이름이 들어간 가입 신청 재개 문구는 따옴표로 감싸지 않는다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const s = await render(
      <Harness
        route="chooseIsland"
        api={() => ({})}
        seed={(d: any) => d({ type: 'ISLAND_REQUEST', request: pendingReq({ islandName: null }) })}
      />,
    );

    await waitFor(() =>
      assert.ok(s.getByText('Your join request for the island you applied to is in progress')),
    );
  });
});
