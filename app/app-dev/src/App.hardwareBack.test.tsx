/**
 * GROMO-2263 — 안드로이드 하드웨어 뒤로 가기 우선순위.
 * App 의 하드웨어 뒤로 가기 핸들러는 방문 분기(END_VISIT)보다 먼저 ① 열린 확인창 ② 진행 중인 건물 전환 ③ 화면이 건
 * 뒤로 가기 처리(e.backOverride)를 본다 — back() 의 앞 세 검사와 같은 순서다. 핸들러는 App 하나뿐이라 팝업·모달이
 * 따로 리스너를 달지 않아도 되고, 등록 순서에 기대지 않는다.
 *
 * 방문 화면(visitIsland)만 실제 CurrentScreens(실제 VisitIsland·IslandPopup)로 그리고, 나머지 라우트는 비운다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { BackHandler } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { clearSession } from '@/services/api/session';
import {
  createBuildingTransitionController,
  isBuildingTransitionActive,
} from '@/services/buildingTransition';

// 첫 마운트는 App 과 방문 화면 모듈을 처음 읽어 느리다 — 바쁜 머신에서도 기본 5초에 걸리지 않게 넉넉히 둔다
jest.setTimeout(30_000);

let captured: any;

jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: (props: any) => {
    const actual = jest.requireActual('@/screens/island/CurrentScreens');
    captured = props.e;
    // 앱은 오프라인이라 e.islands 가 없다 — 서버 방문 화면을 그리도록 빈 명령 묶음만 끼운다
    return props.e.route === 'visitIsland' ? (
      <actual.CurrentScreens e={{ ...props.e, islands: { join: jest.fn(), cancel: jest.fn() } }} />
    ) : null;
  },
}));

jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: () => ({
    status: 'ready',
    error: null,
    focus: [],
    rest: [],
    emotes: [],
    clockOffset: 0,
    snapshotVersion: 0,
    snapshotTransitions: [],
    sendEmote: jest.fn(() => true),
    retry: jest.fn(),
  }),
}));
jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({
  useBoardHomeIndicator: () => ({ hasNew: false }),
}));

jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));

jest.mock('@/services/islandBoot', () => ({
  decideBootRoute: async () => 'login',
}));

jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => null };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 하드웨어 뒤로 가기 흉내 — RN 처럼 나중에 등록한 리스너가 먼저 불리고, true 를 돌려주면 거기서 멈춘다.
// (App 의 리스너는 하나뿐이고 의존값이 바뀔 때 다시 등록된다)
const listeners: (() => boolean | null | undefined)[] = [];
const pressBack = () => {
  for (const listener of [...listeners].reverse()) if (listener()) return true;
  return false;
};
let addSpy: jest.SpyInstance;

beforeEach(async () => {
  captured = undefined;
  listeners.length = 0;
  addSpy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    listeners.push(handler as () => boolean);
    return {
      remove: () => {
        const index = listeners.indexOf(handler as () => boolean);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  });
  await clearSession();
});
afterEach(() => addSpy.mockRestore());

const GREETING = '어서 와요, 같이 집중해요 🐟';

const mount = async () => {
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  return screen;
};

// 서버 방문 중인 상태 — 이때 앱의 뒤로 가기는 방문 종료(END_VISIT)다
const startVisit = async (greeting?: string) => {
  await act(async () => {
    captured.dispatch({
      type: 'ISLAND_SYNC',
      memberships: { items: [], currentIslandId: null, nextCursor: null, lossReason: null },
    });
    captured.dispatch({
      type: 'ISLAND_VISIT',
      visit: {
        island: {
          id: 'v1',
          name: '구경',
          intro: '',
          memberCount: 3,
          maxMembers: 15,
          approvalRequired: false,
          membershipStatus: 'none',
          ...(greeting ? { greeting, greetingIsDefault: false } : {}),
        },
        buildings: ['hall', 'board'],
        members: { items: [], nextCursor: null, version: 1 },
        joinRequestAvailability: 'available',
        joinRequest: null,
      },
    });
    captured.dispatch({ type: 'SERVER_VISITING', islandId: 'v1' });
  });
  await act(async () => captured.replace('visitIsland', 'v1'));
  assert.equal(captured.route, 'visitIsland');
  assert.equal(captured.state.visitingIslandId, 'v1');
};

const back = async () => {
  let handled: boolean | undefined;
  await act(async () => {
    handled = pressBack();
  });
  return handled;
};

test('방문 중 화면이 건 backOverride 가 true 를 돌려주면 방문을 끝내지 않는다', async () => {
  await mount();
  await startVisit();
  const override = jest.fn(() => true);
  captured.backOverride.current = override;

  assert.equal(await back(), true);
  assert.equal(override.mock.calls.length, 1);
  assert.equal(captured.state.visitingIslandId, 'v1'); // END_VISIT 아님
  assert.equal(captured.route, 'visitIsland');

  // override 를 걷으면 평소처럼 방문을 끝내고 소속 섬이 없으니 섬 고르기로 간다
  captured.backOverride.current = null;
  assert.equal(await back(), true);
  assert.equal(override.mock.calls.length, 1);
  assert.equal(captured.state.visitingIslandId, null);
  assert.equal(captured.route, 'chooseIsland');
});

test('override 가 false 를 돌려주면(처리 안 함) 방문 분기로 넘어간다', async () => {
  await mount();
  await startVisit();
  const override = jest.fn(() => false);
  captured.backOverride.current = override;

  assert.equal(await back(), true);
  assert.equal(override.mock.calls.length, 1);
  assert.equal(captured.state.visitingIslandId, null);
});

test('방문 화면에서 열린 확인창이 있으면 뒤로 가기는 확인창만 닫고 방문을 끝내지 않는다', async () => {
  await mount();
  await startVisit();
  const override = jest.fn(() => true);
  captured.backOverride.current = override;
  await act(async () => captured.confirm('확인', '본문', () => {}));

  // 확인창이 override 보다 먼저다
  assert.equal(await back(), true);
  assert.equal(override.mock.calls.length, 0);
  assert.equal(captured.state.visitingIslandId, 'v1');
  assert.equal(captured.route, 'visitIsland');

  // 닫힌 뒤에는 override
  assert.equal(await back(), true);
  assert.equal(override.mock.calls.length, 1);
  assert.equal(captured.state.visitingIslandId, 'v1');
});

test('진행 중인 건물 전환은 override 보다 먼저 취소된다(집중→휴식 전환 취소 순서 유지)', async () => {
  await mount();
  await startVisit();
  const override = jest.fn(() => true);
  captured.backOverride.current = override;
  const controller = createBuildingTransitionController();
  try {
    await act(async () => {
      controller.start('board', 'enter', false, jest.fn(), 10_000);
    });
    assert.equal(isBuildingTransitionActive(), true);

    assert.equal(await back(), true);
    assert.equal(isBuildingTransitionActive(), false); // 전환이 취소됐다
    assert.equal(override.mock.calls.length, 0); // 그 뒤의 처리는 아직 안 불렸다
    assert.equal(captured.state.visitingIslandId, 'v1');

    assert.equal(await back(), true);
    assert.equal(override.mock.calls.length, 1);
  } finally {
    await act(async () => {
      controller.cancel();
      controller.dispose();
    });
  }
});

test('인사말 팝업이 떠 있으면 뒤로 가기는 방문을 끝내지 않고 팝업만 닫는다 — App 이 다시 그려져도 그대로다', async () => {
  const screen = await mount();
  await startVisit(GREETING);
  assert.ok(await screen.findByTestId('visit-greeting'));
  assert.equal(typeof captured.backOverride.current, 'function'); // 방문 화면이 닫기 처리를 걸었다

  // App 의 의존값(modal)이 바뀐다 — 확인창을 열었다 닫으면 핸들러가 두 번 다시 등록된다. 그래도 팝업 처리가 우선순위를 지킨다
  const registered = addSpy.mock.calls.length;
  await act(async () => captured.confirm('확인', '본문', () => {}));
  await act(async () => captured.back()); // 확인창을 닫는다
  assert.ok(addSpy.mock.calls.length > registered); // 핸들러가 다시 등록됐다
  assert.ok(screen.getByTestId('visit-greeting'));

  assert.equal(await back(), true);
  expect(screen.queryByTestId('visit-greeting')).toBeNull(); // 팝업이 닫혔다
  assert.equal(captured.state.visitingIslandId, 'v1'); // END_VISIT 아님
  assert.equal(captured.route, 'visitIsland');
  assert.equal(captured.backOverride.current, null); // 닫힌 팝업의 처리는 걷혔다

  // 팝업이 없으면 평소처럼 방문을 끝낸다
  assert.equal(await back(), true);
  assert.equal(captured.state.visitingIslandId, null);
  assert.equal(captured.route, 'chooseIsland');
});

test('인사말 팝업 위로 앱 확인창이 열려 있으면 확인창이 먼저 닫히고 그다음에 팝업이 닫힌다', async () => {
  const screen = await mount();
  await startVisit(GREETING);
  assert.ok(await screen.findByTestId('visit-greeting'));
  await act(async () => captured.confirm('확인', '본문', () => {}));

  assert.equal(await back(), true);
  assert.ok(screen.getByTestId('visit-greeting')); // 아직 팝업은 그대로
  assert.equal(captured.state.visitingIslandId, 'v1');

  assert.equal(await back(), true);
  expect(screen.queryByTestId('visit-greeting')).toBeNull();
  assert.equal(captured.state.visitingIslandId, 'v1');
});

test('뒤로 가기는 최신 화면 상태로 동작한다 — 화면을 옮긴 뒤 뒤로 가면 이전 화면으로 간다', async () => {
  await mount();
  assert.equal(captured.route, 'login');
  assert.equal(pressBack(), false); // 로그인 화면의 뒤로 가기는 앱이 받지 않는다(OS 몫)

  await act(async () => captured.go('chooseIsland'));
  await act(async () => captured.go('character'));
  assert.equal(captured.route, 'character');

  assert.equal(await back(), true);
  assert.equal(captured.route, 'chooseIsland');
  assert.equal(await back(), true);
  assert.equal(captured.route, 'login');
  assert.equal(pressBack(), false);
});

test('방문이 아닌 화면에서도 override·확인창이 먼저이고 override 가 없으면 이전 화면으로 간다', async () => {
  await mount();
  await act(async () => captured.go('chooseIsland'));
  const override = jest.fn(() => true);
  captured.backOverride.current = override;
  await act(async () => captured.confirm('확인', '본문', () => {}));

  assert.equal(await back(), true); // 확인창만 닫는다
  assert.equal(captured.route, 'chooseIsland');
  assert.equal(override.mock.calls.length, 0);

  assert.equal(await back(), true); // override 가 처리한다
  assert.equal(captured.route, 'chooseIsland');
  assert.equal(override.mock.calls.length, 1);

  captured.backOverride.current = null;
  assert.equal(await back(), true); // 기존대로 이전 화면
  assert.equal(captured.route, 'login');
});
