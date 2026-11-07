// GROMO-2785 바다 움직임 — 동작 줄이기·백그라운드에서 멈추고, 표류 자리가 시안 값이며, 뗏목마다 박자가 다르다.
import React from 'react';
import { Animated, AppState } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import {
  placeGlint,
  RaftFloat,
  RaftRipples,
  raftRhythm,
  SeaGlints,
  SeaSkyMotion,
  SeaWaterMotion,
  SeaWaterTile,
  seaCover,
  ShoreRipples,
  startPhasedLoop,
  TELESCOPE_SEA_ART,
  TELESCOPE_SKY,
  useSeaRunning,
  useSeaWater,
} from './SeaMotion';
import { DRIFT_PEER_SLOTS } from './SeaScene';

type AppStateMutable = { currentState: string | null };
const setAppState = (state: string) => {
  (AppState as unknown as AppStateMutable).currentState = state;
};
const valueOf = (value: Animated.Value) =>
  (value as unknown as { __getValue: () => number }).__getValue();

let previousAppState: string | null;
let timingStart: jest.Mock;
let timingStop: jest.Mock;
let timing: jest.SpyInstance;
let loopStart: jest.Mock;
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
  loopStart = jest.fn();
  loop = jest.spyOn(Animated, 'loop').mockReturnValue({
    start: loopStart,
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

test('useSeaRunning — 동작 줄이기가 아니고 앱이 앞에 있을 때만 참', async () => {
  expect((await renderHook(() => useSeaRunning(false))).result.current).toBe(true);
  expect((await renderHook(() => useSeaRunning(true))).result.current).toBe(false);
  setAppState('background');
  expect((await renderHook(() => useSeaRunning(false))).result.current).toBe(false);
});

test('위상 시계 — 첫 바퀴는 phase 에서 짧게 돌고, 끝나면 0 으로 되돌린 뒤 전체 바퀴를 반복한다', () => {
  const clock = new Animated.Value(0);
  const stop = startPhasedLoop(clock, 1000, 0.25);
  expect(valueOf(clock)).toBe(0.25);
  expect(timing).toHaveBeenLastCalledWith(clock, expect.objectContaining({ duration: 750 }));
  expect(loopStart).not.toHaveBeenCalled();

  const onLeadDone = timingStart.mock.calls[0][0] as (r: { finished: boolean }) => void;
  onLeadDone({ finished: true });
  expect(valueOf(clock)).toBe(0);
  expect(loopStart).toHaveBeenCalledTimes(1);

  // 멈춘 뒤 늦게 온 완료는 되살리지 않는다
  stop();
  onLeadDone({ finished: true });
  expect(loopStart).toHaveBeenCalledTimes(1);
});

test('물빛 줄 두 장은 running 일 때만 돌고, 멈추면 첫 장만 그대로 보인다(지금 바다 그림)', async () => {
  const screen = await render(<SeaWaterMotion {...size} running />);
  expect(screen.getByTestId('sea-water-tile-foam-0')).toBeTruthy();
  expect(screen.getByTestId('sea-water-tile-foam-1')).toBeTruthy();
  expect(timingStart).toHaveBeenCalled();

  timingStart.mockClear();
  await screen.rerender(<SeaWaterMotion {...size} running={false} />);
  expect(timingStop).toHaveBeenCalled();
  expect(timingStart).not.toHaveBeenCalled();
  expect(screen.getByTestId('sea-water-tile-foam-0')).toHaveStyle({ opacity: 1 });
  expect(screen.getByTestId('sea-water-tile-foam-1')).toHaveStyle({ opacity: 0 });
});

test('멈추면 하늘·반짝임이 돌지 않고, 하늘은 지금 앱의 정지 갈매기와 원화 구름 둘만 보인다', async () => {
  const screen = await render(
    <>
      <SeaSkyMotion {...size} running={false} />
      <SeaGlints {...size} running={false} />
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

test('running 이면 구름 넷이 흐르고 갈매기 한 마리가 기다렸다 지나가며 반짝임 여덟이 켜진다', async () => {
  const screen = await render(
    <>
      <SeaSkyMotion {...size} running />
      <SeaGlints {...size} running />
    </>,
  );
  expect(screen.getByTestId('sea-sky-cloud-3')).toBeTruthy();
  expect(screen.queryByTestId('sea-sky-gulls-still')).toBeNull();
  expect(screen.getByTestId('sea-sky-gull')).toBeTruthy();
  expect(screen.getByTestId('sea-glints')).toBeTruthy();
  // 구름 넷 + 갈매기 비행 + 반짝임 여덟이 각자 timing 을 만든다(갈매기·반짝임은 delay 뒤에 시작한다)
  expect(timing.mock.calls.length).toBeGreaterThanOrEqual(4 + 1 + 8);
});

test('뗏목은 둥실거림·그림자·물결 고리 셋을 그리고, 멈추면 고리가 없고 흔들림이 없다', async () => {
  const screen = await render(
    <>
      <RaftRipples size={100} seed={1} running />
      <RaftFloat size={100} seed={1} running>
        {null}
      </RaftFloat>
    </>,
  );
  expect(screen.getByTestId('raft-ripples-0')).toBeTruthy();
  expect(screen.getByTestId('raft-ripples-2')).toBeTruthy();
  expect(screen.getByTestId('raft-float-shadow')).toBeTruthy();
  // 고리 셋은 시계 하나, 둥실거림·기울기는 시계 둘 — 뗏목당 루프 3개
  expect(loop).toHaveBeenCalledTimes(3);

  await screen.rerender(
    <>
      <RaftRipples size={100} seed={1} running={false} />
      <RaftFloat size={100} seed={1} running={false}>
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

// ---------------------------------------------------------------- 망원경(GROMO-2789)

test('망원경 바다 — 수평선이 545/1536 이라 cover 자리가 표류와 같고 수평선만 다르다', () => {
  const drift = seaCover(402, 874),
    tele = seaCover(402, 874, TELESCOPE_SEA_ART);
  expect(tele).toEqual(drift);
  expect(TELESCOPE_SEA_ART.horizon).toBeCloseTo(545 / 1536);
});

test('파노라마 타일 — 홀수 장은 좌우 반전이고 모든 장이 같은 물빛 줄 시계를 쓴다', async () => {
  function Tiles({ running }: { running: boolean }) {
    const layers = useSeaWater(running, 874, 1);
    return (
      <>
        <SeaWaterTile
          art={TELESCOPE_SEA_ART}
          layers={layers}
          running={running}
          left={0}
          top={0}
          width={582}
          height={874}
          testID="t0"
        />
        <SeaWaterTile
          art={TELESCOPE_SEA_ART}
          layers={layers}
          running={running}
          left={582}
          top={0}
          width={582}
          height={874}
          mirror
          testID="t1"
        />
      </>
    );
  }
  const screen = await render(<Tiles running />);
  expect(screen.getByTestId('t1')).toHaveStyle({ transform: [{ scaleX: -1 }] });
  expect(screen.getByTestId('t0')).not.toHaveStyle({ transform: expect.anything() });
  // 시계 둘(물빛 줄·좌우 흔들림)뿐 — 타일마다 새로 돌리지 않는다
  expect(loop).toHaveBeenCalledTimes(2);
  await screen.rerender(<Tiles running={false} />);
  expect(screen.getByTestId('t1-foam-0')).toHaveStyle({ opacity: 1 });
  expect(screen.getByTestId('t1-foam-1')).toHaveStyle({ opacity: 0 });
});

test('망원경 하늘 — 멈추면 원화 구름 셋만 제자리이고 갈매기는 없다(지금 화면 그대로)', async () => {
  const screen = await render(<SeaSkyMotion {...size} running={false} sky={TELESCOPE_SKY} />);
  expect(screen.getByTestId('sea-sky-cloud-2')).toBeTruthy();
  expect(screen.queryByTestId('sea-sky-cloud-3')).toBeNull();
  expect(screen.queryByTestId('sea-sky-gulls-still')).toBeNull();
  expect(screen.queryByTestId('sea-sky-gull')).toBeNull();
  await screen.rerender(<SeaSkyMotion {...size} running sky={TELESCOPE_SKY} />);
  expect(screen.getByTestId('sea-sky-cloud-3')).toBeTruthy();
  expect(screen.getByTestId('sea-sky-gull')).toBeTruthy();
});

test('섬 발치 물결 — 돌 때만 띠 둘이 시계 하나로 퍼지고, 멈추면 없다', async () => {
  const screen = await render(<ShoreRipples width={126} height={70} running />);
  expect(screen.getByTestId('shore-ripples-0')).toBeTruthy();
  expect(screen.getByTestId('shore-ripples-1')).toBeTruthy();
  expect(loop).toHaveBeenCalledTimes(1);
  await screen.rerender(<ShoreRipples width={126} height={70} running={false} />);
  expect(screen.queryByTestId('shore-ripples-0')).toBeNull();
});

test('반짝임 자리 — 정해 준 구간 안에만 뜨고 수평선에서 멀수록 크다', () => {
  const zone = { horizon: 0.35, from: 0.47, to: 0.98 };
  for (let i = 0; i < 50; i += 1) {
    const spot = placeGlint(402, 874, zone);
    expect(spot.top).toBeGreaterThanOrEqual(0.47 * 874);
    expect(spot.top).toBeLessThanOrEqual(0.98 * 874);
  }
  jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0);
  const far = placeGlint(402, 874, zone);
  jest.spyOn(Math, 'random').mockReturnValueOnce(1).mockReturnValueOnce(0);
  const near = placeGlint(402, 874, zone);
  expect(near.w).toBeGreaterThan(far.w);
  jest.restoreAllMocks();
});
