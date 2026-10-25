import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';
import { Animated, AppState } from 'react-native';
import { RestGroup, restSeats, seatBox } from '@/screens/focus/RestGroup';
import { restPose, useRestClock } from '@/screens/focus/RestCampfireMotion';
import { initialState } from '@/services/model';
import { applyLocalePref } from '@/i18n';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));

const screens = [
  // 세로·가로 폰(검수 캡처와 같은 안전 여백)
  { W: 402, H: 874, inset: { top: 52, bottom: 32, left: 0, right: 0 } },
  { W: 874, H: 402, inset: { top: 0, bottom: 21, left: 52, right: 52 } },
];

test('모닥불: 6명까지는 시안 6자리 그대로', () => {
  for (const { W, H, inset } of screens) {
    const six = restSeats(6, W, H, inset),
      fifteen = restSeats(15, W, H, inset);
    assert.equal(six.seats.length, 6);
    assert.deepEqual(fifteen.seats.slice(0, 6), six.seats);
    assert.equal(fifteen.x0, six.x0);
    assert.equal(fifteen.y0, six.y0);
  }
});

test('모닥불: 아주 작은 화면(320×568)에서도 15명 모두 자리를 받는다', () => {
  const { seats } = restSeats(15, 320, 568, { top: 24, bottom: 16, left: 0, right: 0 });
  assert.equal(seats.length, 15);
  assert.ok(seats.every((a) => Number.isFinite(a.x) && Number.isFinite(a.top) && a.n > 0));
});

test('모닥불: 정원 15명이 모두 화면 안에 서로 겹치지 않게 앉는다', () => {
  for (const { W, H, inset } of screens) {
    const { seats } = restSeats(15, W, H, inset);
    assert.equal(seats.length, 15, `${W}x${H}`);
    const boxes = seats.map((a) => seatBox(a.x, a.top, a.n));
    boxes.slice(6).forEach((b, n) => {
      assert.ok(b.l >= 0 && b.r <= W && b.t >= 0 && b.b <= H, `${W}x${H} ${n}`);
      boxes.forEach((c, m) => {
        if (m !== n + 6)
          assert.ok(!(b.l < c.r && c.l < b.r && b.t < c.b && c.t < b.b), `${W}x${H} ${n + 6}-${m}`);
      });
    });
  }
});

test('집중 세션이 있으면 멈춘 집중 정보가 보인다', async () => {
  const state = initialState(true);
  state.session = {
    id: 'focus-session',
    islandId: state.islandId,
    subject: '영어 단어 외우기',
    startedAt: 0,
    restStartedAt: 123_000,
    seconds: 1_230,
    status: 'paused',
    intervals: [],
  };

  const resume = jest.fn();
  const screen = await render(
    React.createElement(RestGroup, {
      state,
      resume,
      home: jest.fn(),
    }),
  );

  assert.ok(screen.getByTestId('paused-focus-info'));
  assert.ok(screen.getByText('휴식 중...'));
  assert.ok(screen.getByTestId('loaf-1'));
  expect(screen.queryByTestId('end-rest')).toBeNull();
  expect(screen.queryByTestId('confirm-end-rest')).toBeNull();
  assert.equal(screen.getByTestId('paused-focus-subject').props.children, '영어 단어 외우기');
  assert.equal(screen.getByTestId('paused-focus-time').props.children, '00:20:30');
  await fireEvent.press(screen.getByTestId('resume-focus'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('confirm-end-rest')).toBeNull();
  await screen.unmount();
});

test('집중 세션 없는 모닥불은 본인 휴식과 타이머를 만들지 않는 구경 상태다', async () => {
  const state = initialState(true);
  const home = jest.fn();
  const resume = jest.fn();

  const screen = await render(
    React.createElement(RestGroup, {
      state,
      resume,
      home,
    }),
  );

  assert.equal(screen.queryByTestId('paused-focus-info'), null);
  assert.ok(screen.getByText('모닥불 둘러보기'));
  assert.equal(screen.queryByText('휴식 중...'), null);
  assert.equal(screen.queryByText('나'), null);
  assert.equal(screen.queryByTestId('loaf-1'), null);
  assert.ok(screen.getByText('섬으로 돌아가기'));
  assert.equal(screen.queryByTestId('end-rest'), null);
  await fireEvent.press(screen.getByText('섬으로 돌아가기'));
  expect(home).toHaveBeenCalledTimes(1);
  expect(resume).not.toHaveBeenCalled();
  expect(state.session).toBeFalsy();
  await screen.unmount();
});

test('다른 주민 식빵을 누르면 정보창이 뜨고(GROMO-2474), 내 고양이는 누를 자리가 없다', async () => {
  const state = initialState(true);
  state.session = {
    id: 'focus-session',
    islandId: state.islandId,
    subject: '영어',
    startedAt: 0,
    restStartedAt: 123_000,
    seconds: 60,
    status: 'paused',
    intervals: [],
  };
  const live = {
    status: 'ready',
    clockOffset: 0,
    rest: [
      {
        userId: 'peer',
        name: '두부',
        catColor: 'cream',
        restStartedAt: new Date().toISOString(),
        restSeat: 1,
      },
    ],
  } as any;
  const screen = await render(
    React.createElement(RestGroup, { state, live, home: jest.fn(), resume: jest.fn() }),
  );
  // 내 자리(1번 loaf-1)에는 누르는 자리가 없다
  assert.ok(screen.getByTestId('loaf-1'));
  assert.equal(screen.queryByTestId('rest-cat-me'), null);
  await fireEvent.press(screen.getByLabelText('두부 정보 보기'));
  expect(screen.getByTestId('cat-info-name')).toHaveTextContent('두부');
  await fireEvent.press(screen.getByLabelText('닫기'));
  assert.equal(screen.queryByTestId('cat-info-name'), null);
  await screen.unmount();
});

test('영어 모닥불 구경은 서버 휴식 주민만 표시하고 준비 중에는 목업 주민을 쓰지 않는다', async () => {
  applyLocalePref('en');
  try {
    const state = initialState(true);
    const props = { state, home: jest.fn(), resume: jest.fn() };
    const live = {
      status: 'ready',
      clockOffset: 0,
      rest: [
        {
          userId: 'peer',
          name: '실제 휴식 주민',
          catColor: 'black',
          restStartedAt: new Date().toISOString(),
          restSeat: 1,
        },
      ],
    } as any;
    const screen = await render(React.createElement(RestGroup, { ...props, live }));
    screen.getByText('Campfire View');
    screen.getByText('실제 휴식 주민');
    expect(screen.queryByText('Me')).toBeNull();
    expect(screen.queryByTestId('end-rest')).toBeNull();
    await screen.rerender(
      React.createElement(RestGroup, { ...props, live: { ...live, status: 'loading' } }),
    );
    expect(screen.queryAllByTestId(/^loaf-/)).toHaveLength(0);
    await screen.unmount();
  } finally {
    applyLocalePref('system');
  }
});

test.each([[1, 2, 3, 4, 5, 6], Array.from({ length: 15 }, (_, i) => i + 1), [15]])(
  '모닥불 구경은 1-based·빈 좌석이 있는 서버 좌석 %j의 주민을 모두 표시한다',
  async (...seatNumbers) => {
    const live = {
      status: 'ready',
      clockOffset: 0,
      rest: seatNumbers.map((restSeat) => ({
        userId: `peer-${restSeat}`,
        name: `주민 ${restSeat}`,
        catColor: 'black',
        restStartedAt: new Date().toISOString(),
        restSeat,
      })),
    } as any;
    const screen = await render(
      React.createElement(RestGroup, {
        state: initialState(true),
        live,
        home: jest.fn(),
        resume: jest.fn(),
      }),
    );
    expect(screen.queryAllByTestId(/^loaf-/)).toHaveLength(seatNumbers.length);
    for (const seat of seatNumbers) screen.getByTestId(`loaf-${seat - 1}`);
    await screen.unmount();
  },
);

test('모닥불 자세: 멤버 식별자 해시 짝수는 식빵, 홀수는 책 읽기로 늘 같다', () => {
  // FNV-1a + 끝 섞기 값으로 고정: 'a' 는 짝수(식빵), 'b' 는 홀수(책)
  assert.equal(restPose('a'), 'loaf');
  assert.equal(restPose('b'), 'read');
  const ids = Array.from({ length: 40 }, (_, i) => `user-${i}`);
  assert.deepEqual(ids.map(restPose), ids.map(restPose));
  assert.ok(new Set(ids.map(restPose)).size === 2);
});

test.each([
  [false, 1],
  [true, 0],
])('모닥불 움직임: 동작 줄이기 %s 이면 반복 재생 %i 번', async (reduceMotion, loops) => {
  const loop = jest.spyOn(Animated, 'loop');
  try {
    const state = initialState(true);
    state.settings.reduceMotion = reduceMotion;
    const screen = await render(
      React.createElement(RestGroup, { state, resume: jest.fn(), home: jest.fn() }),
    );
    expect(loop).toHaveBeenCalledTimes(loops);
    screen.getByTestId('rest-campfire-back');
    screen.getByTestId('rest-campfire-front');
    await screen.unmount();
  } finally {
    loop.mockRestore();
  }
});

test('모닥불 시계: 백그라운드면 멈추고 활성이면 재시작, inactive 는 값을 0 으로 되돌리지 않고, 언마운트하면 정리한다', async () => {
  const stop = jest.fn();
  const loop = jest
    .spyOn(Animated, 'loop')
    .mockImplementation(() => ({ start: jest.fn(), stop, reset: jest.fn() }) as any);
  const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
  const remove = jest.fn();
  let fire: (state: string) => void = () => {};
  const add = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    cb: (state: string) => void,
  ) => {
    fire = cb;
    return { remove };
  }) as any);
  const prev = AppState.currentState;
  (AppState as any).currentState = 'active';
  try {
    const { unmount } = await renderHook(() => useRestClock(false));
    expect(loop).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    await act(() => fire('background'));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(loop).toHaveBeenCalledTimes(1);

    await act(() => fire('active'));
    expect(loop).toHaveBeenCalledTimes(2);

    // inactive 로 멈출 때는 값을 0 으로 되돌리지 않는다(재시작 때의 setValue(0) 호출 수 그대로)
    const resets = setValue.mock.calls.length;
    await act(() => fire('inactive'));
    expect(stop).toHaveBeenCalledTimes(2);
    expect(setValue).toHaveBeenCalledTimes(resets);

    expect(remove).not.toHaveBeenCalled();
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    (AppState as any).currentState = prev;
    add.mockRestore();
    setValue.mockRestore();
    loop.mockRestore();
  }
});
