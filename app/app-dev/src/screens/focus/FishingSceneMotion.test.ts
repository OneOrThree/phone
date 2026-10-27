import { Animated, AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import {
  fishingFishFlight,
  labBreath,
  labGlint,
  labMicro,
  labReelPose,
  labRing,
  labSplashDrop,
  useFishingPose,
} from './FishingSceneMotion';
import { castLineStart, castSpot, DEFAULT_SPOT } from './FishingIsland';

test('물고기는 고양이 몸이 아니라 낚싯대 끝에서 출발해 보상 자리로 날아간다', () => {
  const spot = castSpot(DEFAULT_SPOT),
    tip = castLineStart(spot),
    size = 640,
    sizeY = size / 1.5,
    a = size * 0.077,
    launch = {
      x: (size * (tip.x - spot.x)) / 100 + a / 2,
      y: (sizeY * (tip.y - spot.y)) / 100 + a * 0.90625,
    },
    home = { x: -a, y: a },
    start = fishingFishFlight(0, launch, home, a / 390),
    peak = fishingFishFlight(0.5, launch, home, a / 390);
  expect(start).toEqual(launch);
  expect(start.x).toBeLessThan(a / 2);
  expect(peak.y).toBeLessThan((launch.y + home.y) / 2);
  const end = fishingFishFlight(1, launch, home, a / 390);
  expect(end.x).toBeCloseTo(home.x);
  expect(end.y).toBeCloseTo(home.y);
});

test('움직임 검토실 식: 집중 호흡·미세 회전, 낚아올리기 몸 변환, 물보라·물결', () => {
  expect(labBreath(1)).toBeCloseTo(0.01); // 4초 주기 최고점
  expect(labMicro(3)).toBeCloseTo(0.012); // 12초 주기 최고점
  // 줄 긴장 시작 시점은 정지 자세, 당기는 동안 뒤로(음수) 기울고, 안착 뒤 반동은 잦아든다.
  expect(labReelPose(5.5).rotation).toBeCloseTo(0, 6);
  expect(labReelPose(6.5).rotation).toBeCloseTo(-0.055, 3);
  expect(Math.abs(labReelPose(8.35).rotation)).toBeLessThan(0.01);
  // 키 포즈가 바뀌기 직전엔 살짝 눌리고(음수) 직후엔 튄다(양수).
  expect(labReelPose(6.15 - 0.065).squash).toBeLessThan(0);
  expect(labReelPose(6.15 + 0.05).squash).toBeGreaterThan(0);
  const drop = labSplashDrop(0, 1);
  expect(drop.alpha).toBe(0);
  expect(drop.y).toBeGreaterThan(labSplashDrop(0, 0.5).y); // 중력으로 떨어진다
  expect([0, 1, 2].map((i) => labRing(0, i))).toEqual([0, 1 / 3, 2 / 3]);
  expect(labGlint(4.5, 0)).toBeCloseTo(0.1);
});

test('낚시 시계: inactive 로 멈출 때 값을 0 으로 되돌리지 않고, 덮이면(active=false) 0 으로 되돌린다', async () => {
  const loop = jest
    .spyOn(Animated, 'loop')
    .mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }) as any);
  const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
  let fire: (state: string) => void = () => {};
  const add = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    cb: (state: string) => void,
  ) => {
    fire = cb;
    return { remove: jest.fn() };
  }) as any);
  const prev = AppState.currentState;
  (AppState as any).currentState = 'active';
  try {
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useFishingPose({ active, catching: false }),
      { initialProps: { active: true } },
    );
    setValue.mockClear();
    await act(() => fire('inactive'));
    expect(setValue).not.toHaveBeenCalledWith(0); // 시계 되감기 없음(릴 시작 자세 값은 별개)

    await act(() => fire('active'));
    await rerender({ active: false });
    expect(setValue).toHaveBeenCalledWith(0);
  } finally {
    (AppState as any).currentState = prev;
    add.mockRestore();
    setValue.mockRestore();
    loop.mockRestore();
  }
});
