// GROMO-2785 바다 움직임 — 동작 줄이기·백그라운드에서 멈추고, 표류 자리가 시안 값이며, 뗏목마다 박자가 다르다.
import React from 'react';
import { Animated, AppState } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  RaftFloat,
  RaftRipples,
  raftRhythm,
  SeaGlints,
  SeaSkyMotion,
  SeaWaterMotion,
  seaCover,
} from './SeaMotion';
import { DRIFT_PEER_SLOTS } from './SeaScene';

type AppStateMutable = { currentState: string | null };
const setAppState = (state: string) => {
  (AppState as unknown as AppStateMutable).currentState = state;
};

let previousAppState: string | null;
let timingStart: jest.Mock;
let timingStop: jest.Mock;
let timing: jest.SpyInstance;
let loop: jest.SpyInstance;

beforeEach(() => {
  previousAppState = (AppState as unknown as AppStateMutable).currentState;
  setAppState('active');
  timingStart = jest.fn();
  timingStop = jest.fn();
  timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: timingStart,
    stop: timingStop,
    reset: jest.fn(),
  } as unknown as Animated.CompositeAnimation);
  loop = jest.spyOn(Animated, 'loop').mockReturnValue({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  } as unknown as Animated.CompositeAnimation);
});

afterEach(() => {
  timing.mockRestore();
  loop.mockRestore();
  setAppState(previousAppState ?? 'active');
});

const size = { width: 402, height: 874 };

test('물빛 줄 두 장은 앱이 앞에 있을 때만 돌고, 동작 줄이기면 첫 장만 그대로 보인다', async () => {
  const screen = await render(<SeaWaterMotion {...size} />);
  expect(screen.getByTestId('sea-water-foam-0')).toBeTruthy();
  expect(screen.getByTestId('sea-water-foam-1')).toBeTruthy();
  expect(timingStart).toHaveBeenCalled();

  timingStart.mockClear();
  await screen.rerender(<SeaWaterMotion {...size} reduceMotion />);
  expect(timingStop).toHaveBeenCalled();
  expect(timingStart).not.toHaveBeenCalled();
  expect(screen.getByTestId('sea-water-foam-0')).toHaveStyle({ opacity: 1 });
  expect(screen.getByTestId('sea-water-foam-1')).toHaveStyle({ opacity: 0 });
});

test('백그라운드면 바다·하늘·반짝임이 돌지 않고, 하늘은 지금 앱의 정지 갈매기와 원화 구름 둘만 보인다', async () => {
  setAppState('background');
  const screen = await render(
    <>
      <SeaWaterMotion {...size} />
      <SeaSkyMotion {...size} />
      <SeaGlints {...size} />
    </>,
  );
  expect(timingStart).not.toHaveBeenCalled();
  expect(screen.getByTestId('sea-sky-gulls-still')).toBeTruthy();
  expect(screen.queryByTestId('sea-sky-gull')).toBeNull();
  expect(screen.getByTestId('sea-sky-cloud-0')).toBeTruthy();
  expect(screen.getByTestId('sea-sky-cloud-1')).toBeTruthy();
  expect(screen.queryByTestId('sea-sky-cloud-2')).toBeNull();
  expect(screen.queryByTestId('sea-glints')).toBeNull();
});

test('앱이 앞에 있으면 구름 넷이 흐르고 갈매기 한 마리가 기다렸다 지나가며 반짝임이 켜진다', async () => {
  const screen = await render(
    <>
      <SeaSkyMotion {...size} />
      <SeaGlints {...size} />
    </>,
  );
  expect(screen.getByTestId('sea-sky-cloud-3')).toBeTruthy();
  expect(screen.queryByTestId('sea-sky-gulls-still')).toBeNull();
  expect(screen.getByTestId('sea-sky-gull')).toBeTruthy();
  expect(screen.getByTestId('sea-glints')).toBeTruthy();
  // 구름 넷 + 갈매기 비행 + 반짝임 여덟이 각자 timing 을 만든다(갈매기·반짝임은 delay 뒤에 시작한다)
  expect(timing.mock.calls.length).toBeGreaterThanOrEqual(4 + 1 + 8);
});

test('뗏목은 둥실거림·그림자·물결 고리 셋을 그리고, 동작 줄이기면 고리가 없고 흔들림이 없다', async () => {
  const screen = await render(
    <>
      <RaftRipples size={100} seed={1} />
      <RaftFloat size={100} seed={1}>
        {null}
      </RaftFloat>
    </>,
  );
  expect(screen.getByTestId('raft-ripples-0')).toBeTruthy();
  expect(screen.getByTestId('raft-ripples-2')).toBeTruthy();
  expect(screen.getByTestId('raft-float-shadow')).toBeTruthy();
  expect(loop).toHaveBeenCalled();

  await screen.rerender(
    <>
      <RaftRipples size={100} seed={1} reduceMotion />
      <RaftFloat size={100} seed={1} reduceMotion>
        {null}
      </RaftFloat>
    </>,
  );
  expect(screen.queryByTestId('raft-ripples-0')).toBeNull();
  expect(screen.getByTestId('raft-float')).not.toHaveStyle({ transform: expect.anything() });
});

test('뗏목마다 둥실거림 주기·위상이 다르다 — 시안 raftEl 의 식 그대로', () => {
  expect(raftRhythm(0)).toEqual({ p1: 3, p2: 4.2, phase1: 0, phase2: 0 });
  const a = raftRhythm(1),
    b = raftRhythm(2);
  expect(a.p1).toBeCloseTo(3.37);
  expect(a.p2).toBeCloseTo(4.73);
  expect(a.phase1).toBeCloseTo(1.13 / 3.37);
  expect(b.p1).not.toBeCloseTo(a.p1);
  expect(b.phase1).not.toBeCloseTo(a.phase1);
});

test('표류 자리는 시안 값 — 맨 뒤 칸을 앞으로 당기고 세 번째 칸을 왼쪽으로', () => {
  expect(DRIFT_PEER_SLOTS).toEqual([
    [0.78, 0.29, 58],
    [0.24, 0.33, 66],
    [0.62, 0.42, 76],
    [0.23, 0.58, 94],
    [0.76, 0.62, 82],
  ]);
});

test('바다 원화는 cover 로 맞춘다 — 세로가 긴 화면은 폭을 넘치게, 가로가 긴 화면은 높이를 넘치게', () => {
  // 402×874 는 원화(2:3)보다 길어 높이를 맞추고 폭이 넘친다
  const tall = seaCover(402, 874);
  expect(tall.fh).toBe(874);
  expect(tall.fw).toBeCloseTo(582.67, 1);
  expect(tall.ox).toBeCloseTo(-90.33, 1);
  expect(tall.oy).toBe(0);
  expect(seaCover(1024, 600)).toMatchObject({ fw: 1024, fh: 1536, ox: 0, oy: -468 });
});
