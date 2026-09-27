import assert from 'node:assert/strict';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { landPath, onLand } from '@/utils/world-grid';
import { SECONDS_PER_FISH } from '@/services/model';
import { FishingBoat } from '@/screens/focus/FocusSea';
import {
  LANDING,
  PEER_SPOTS,
  DEFAULT_SPOT,
  FishingActor,
  FishingPeerActorView,
  GRAM,
  anchorCard,
  castSpot,
  fishingCamera,
  SEAT_GAP,
  fishingGrid,
  nearGram,
  nearRaft,
  occupied,
  peerLandRoute,
  peerPixelsAtSize,
  peerPointFromPixels,
  peerWalkFace,
  fishingCatchPlacement,
  fishingCatchFootprintOnLand,
} from '@/screens/focus/FishingIsland';

jest.mock('@/components/CatSprite', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CatSprite: ({ testID, motion }: { testID?: string; motion: string }) =>
      React.createElement(View, { testID, motion }),
  };
});

test('낚시섬: 물은 누를 수 없고, 뗏목 옆 땅에서 누른 땅까지 걸어갈 수 있다', () => {
  assert.equal(onLand(fishingGrid, { x: 2, y: 2 }), false); // 바다
  assert.equal(onLand(fishingGrid, { x: 40, y: 40 }), false); // 연못
  assert.ok(onLand(fishingGrid, LANDING));
  for (const p of [{ x: 34.1, y: 55.9 }, ...PEER_SPOTS])
    assert.ok(landPath(fishingGrid, LANDING, p).length > 1, `${p.x},${p.y}`);
});

test('앉은 자리에서 가까운 물 쪽으로 낚싯줄을 던진다', () => {
  // 시안 예시 내 자리 [34.1, 55.9, -1, 33.1, 55.1]
  const spot = castSpot({ x: 34.1, y: 55.9 });
  assert.equal(spot.face, -1);
  assert.ok(Math.hypot(spot.bx! - 33.1, spot.by! - 55.1) < 1.5);
  assert.equal(onLand(fishingGrid, { x: spot.bx!, y: spot.by! }), false);
});

test('물가 칸 경계 바로 안쪽 땅을 눌러도 앉는 자리는 땅이다(반올림으로 물 칸이 되지 않음)', () => {
  const { cols, cells } = fishingGrid;
  let checked = 0;
  for (let c = 0; c < cells.length - 1; c++) {
    // 오른쪽 이웃이 물인 땅 칸의 오른쪽 경계 0.04% 안쪽
    if (c % cols === cols - 1 || cells[c] !== '1' || cells[c + 1] !== '0') continue;
    const p = { x: ((c % cols) + 1) * 2 - 0.04, y: (Math.floor(c / cols) + 0.5) * 2 };
    assert.ok(onLand(fishingGrid, p));
    const spot = castSpot(p);
    assert.ok(onLand(fishingGrid, spot), `${p.x},${p.y}`);
    checked++;
  }
  assert.ok(checked > 10);
});

test('도착 지점과 이어지지 않은 땅(연못 가운데 섬)은 걸어갈 경로가 없다', () => {
  const pondIsland = { x: 29, y: 45 };
  assert.ok(onLand(fishingGrid, pondIsland));
  assert.deepEqual(landPath(fishingGrid, LANDING, pondIsland), []);
});

test('실시간 주민 입장·퇴장 경로의 모든 구간은 물을 가로지르지 않는다', () => {
  for (const spot of PEER_SPOTS) {
    const entering = peerLandRoute(LANDING, spot);
    const leaving = peerLandRoute(spot, LANDING);
    assert.ok(entering.length > 1);
    assert.ok(leaving.length > 1);
    for (const route of [
      [LANDING, ...entering],
      [spot, ...leaving],
    ]) {
      for (const point of route) assert.ok(onLand(fishingGrid, point));
      for (let index = 1; index < route.length; index++) {
        const from = route[index - 1],
          to = route[index];
        for (let step = 0; step <= 10; step++)
          assert.ok(
            onLand(fishingGrid, {
              x: from.x + ((to.x - from.x) * step) / 10,
              y: from.y + ((to.y - from.y) * step) / 10,
            }),
          );
      }
    }
  }
});

test('중단된 주민 이동의 픽셀 좌표를 현재 지도 좌표로 복원한다', () => {
  const size = 640,
    sizeY = size / 1.5,
    current = { x: 41.25, y: 63.5 },
    left = (size * current.x) / 100 - (size * 0.077) / 2,
    top = (sizeY * current.y) / 100 - size * 0.077 * 0.90625;
  const restored = peerPointFromPixels(left, top, size, sizeY);
  assert.ok(Math.abs(restored.x - current.x) < 1e-9);
  assert.ok(Math.abs(restored.y - current.y) < 1e-9);
});

test('지도 크기가 바뀌어도 이동 중 주민의 지도 좌표를 보존한다', () => {
  const oldSize = 640,
    oldSizeY = oldSize / 1.5,
    newSize = 1152,
    newSizeY = newSize / 1.5,
    current = { x: 41.25, y: 63.5 },
    oldLeft = (oldSize * current.x) / 100 - (oldSize * 0.077) / 2,
    oldTop = (oldSizeY * current.y) / 100 - oldSize * 0.077 * 0.90625,
    resized = peerPixelsAtSize(oldLeft, oldTop, oldSize, oldSizeY, newSize, newSizeY),
    restored = peerPointFromPixels(resized.left, resized.top, newSize, newSizeY);

  assert.ok(Math.abs(restored.x - current.x) < 1e-9);
  assert.ok(Math.abs(restored.y - current.y) < 1e-9);
  // 이전 픽셀 값을 새 지도 크기로 바로 해석하면 핀치 확대만으로 좌표가 달라진다.
  const misinterpreted = peerPointFromPixels(oldLeft, oldTop, newSize, newSizeY);
  assert.ok(Math.abs(misinterpreted.x - current.x) > 1);
  assert.ok(Math.abs(misinterpreted.y - current.y) > 1);
});

test('주민 걷기 방향은 현재 구간의 다음 waypoint를 향한다', () => {
  assert.equal(peerWalkFace({ x: 50, y: 50 }, { x: 48, y: 50 }, 1), -1);
  assert.equal(peerWalkFace({ x: 48, y: 50 }, { x: 52, y: 50 }, -1), 1);
  assert.equal(peerWalkFace({ x: 52, y: 50 }, { x: 52, y: 48 }, -1), -1);
});

test('주민 14명(정원 15명)까지 낚시 자리가 모두 땅 위에 겹치지 않게 있다', () => {
  assert.equal(PEER_SPOTS.length, 15);
  assert.deepEqual(PEER_SPOTS[0], { x: 18.5, y: 39.5, face: 1, bx: 19.5, by: 38.7 });
  for (const [n, p] of PEER_SPOTS.entries()) {
    assert.ok(onLand(fishingGrid, p), `${n}`);
    for (const q of PEER_SPOTS.slice(n + 1))
      // 낚시 고양이 폭(지도 폭 7.7%)에 여유를 더한 거리보다 멀리
      assert.ok(!occupied(p, [q]), `${n}`);
    assert.ok(!nearRaft(p), `${n} 뗏목`);
  }
});

test('물고기 보상 전체 프레임이 15개 낚시 자리와 기본 자리에 육지 안쪽으로 놓인다', () => {
  const rewards = [
    ['single', 1.1, 1.1],
    ['pile-small', 1.1, 1.1],
    ['pile-medium', 1.1, 1.1],
    ['pile-large', 1.1, 1.1],
    ['golden', 1.1, 1.1],
  ] as const;
  const seats = [
    ...PEER_SPOTS,
    { ...DEFAULT_SPOT, face: -1 },
    // 기존 화면 검토에서 물이 침범한 좌표도 같은 footprint 계약을 적용한다.
    { x: 41, y: 9, face: 1 },
  ];
  for (const [index, spot] of seats.entries()) {
    const placement = fishingCatchPlacement(spot);
    assert.ok(placement, `${index}: 보상 배치 위치를 찾지 못함`);
    for (const [reward, width, height] of rewards)
      assert.ok(
        fishingCatchFootprintOnLand(spot, placement!, width, height),
        `${index} ${reward}: 보상 프레임이 물에 걸침`,
      );
  }
});

test('물고기 보상 배치는 화면 크기와 방향이 달라도 같은 지도 좌표를 사용한다', () => {
  const spot = PEER_SPOTS[1],
    placement = fishingCatchPlacement(spot);
  assert.ok(placement);
  for (const [size, sizeY] of [
    [402, 402 / 1.5],
    [874, 874 / 1.5],
    [1120, 1120 / 1.5],
  ]) {
    const imageLeft = (size * spot.x) / 100 - (size * 0.077) / 2 + placement!.left * size * 0.077,
      imageTop = (sizeY * spot.y) / 100 - size * 0.077 * 0.90625 + placement!.top * size * 0.077,
      restoredX = ((imageLeft - placement!.left * size * 0.077 + (size * 0.077) / 2) * 100) / size,
      restoredY =
        ((imageTop - placement!.top * size * 0.077 + size * 0.077 * 0.90625) * 100) / sizeY;
    assert.ok(Math.abs(restoredX - spot.x) < 1e-9);
    assert.ok(Math.abs(restoredY - spot.y) < 1e-9);
    assert.ok(fishingCatchFootprintOnLand(spot, placement!));
  }
});

test('FishingActor는 계산된 육지 보상 위치를 실제 이미지에 적용한다', async () => {
  const spot = PEER_SPOTS[1],
    size = 640,
    placement = fishingCatchPlacement(spot)!;
  const screen = await render(
    React.createElement(FishingActor, {
      spot,
      size,
      sizeY: size / 1.5,
      color: 'ginger',
      name: '주민',
      seconds: SECONDS_PER_FISH,
      reduce: true,
    }),
  );
  const catchImage = screen.getByTestId('fishing-actor-catch');
  assert.equal(catchImage.props.style.left, placement.left * size * 0.077);
  assert.equal(catchImage.props.style.top, placement.top * size * 0.077);
  assert.equal(catchImage.props.style.width, size * 0.077 * 1.1);
  await screen.unmount();
});

test('낚시 주민은 이동 중 보상을 숨기고 정지하면 다시 표시한다', async () => {
  const { Animated } = require('react-native');
  const props = {
    spot: PEER_SPOTS[0],
    size: 640,
    sizeY: 640 / 1.5,
    color: 'ginger' as const,
    name: '주민',
    seconds: SECONDS_PER_FISH,
    reduce: true,
    animatedPosition: { left: new Animated.Value(0), top: new Animated.Value(0) },
  };
  const screen = await render(React.createElement(FishingActor, { ...props, motion: 'walk' }));
  assert.equal(screen.queryByTestId('fishing-actor-catch'), null);

  await screen.rerender(React.createElement(FishingActor, props));
  assert.notEqual(screen.queryByTestId('fishing-actor-catch'), null);
  await screen.unmount();
});

test('축음기 그림 위·바로 앞은 앉을 수 없다', () => {
  assert.ok(nearGram(GRAM));
  assert.ok(nearGram({ x: GRAM.x, y: GRAM.y - 6 }));
  assert.ok(!nearGram(DEFAULT_SPOT));
  assert.ok(!PEER_SPOTS.some(nearGram));
});

test('다른 주민 자리 가까이·고양이가 겹치는 거리는 앉을 수 없다', () => {
  assert.ok(occupied({ x: PEER_SPOTS[0].x + 2, y: PEER_SPOTS[0].y }, PEER_SPOTS));
  // 고양이 폭(7.7%)만큼 떨어져도 겹친다
  assert.ok(occupied({ x: 12.5, y: 39.5 }, PEER_SPOTS));
  assert.ok(SEAT_GAP >= 7.7);
  assert.ok(!occupied(DEFAULT_SPOT, PEER_SPOTS));
});

test('뗏목·내리는 자리 위에는 앉을 수 없다', () => {
  assert.ok(nearRaft({ x: 30, y: 86 }));
  assert.ok(nearRaft({ x: 37.8, y: 91.8 }));
  assert.ok(nearRaft(LANDING));
  assert.ok(!nearRaft(DEFAULT_SPOT));
});

test('집중 준비 카드: 가로 402 높이에 키보드(약 240)가 떠도 버튼이 보이게 위로 올린다', () => {
  // 가로 화면, 남은 높이 162, 카드 높이 180: 아래가 화면 안(버튼 보임)
  const tight = anchorCard(300, 150, 67, 330, 180, 874, 162);
  assert.ok(tight.top + 180 <= 162 - 8);
  // 여유가 있으면 고양이 위에 붙는다
  const roomy = anchorCard(201, 600, 49, 330, 170, 402, 874);
  assert.equal(roomy.top, 600 - 49 - 10 - 170);
});

test('집중 준비 카드는 노치(안전 영역) 안으로 들어가지 않는다', () => {
  const safe = { top: 0, bottom: 21, left: 59, right: 59 };
  // 가로 화면 왼쪽 끝 자리
  const card = anchorCard(40, 300, 67, 330, 170, 874, 402, safe);
  assert.ok(card.left >= safe.left + 8);
  assert.ok(card.left + 330 <= 874 - safe.right - 8);
  assert.ok(card.top + 170 <= 402 - safe.bottom - 8);
  // 안전 영역이 없으면(웹 검토 모드) 시안 그대로
  assert.deepEqual(anchorCard(40, 300, 67, 330, 170, 874, 402), {
    top: 300 - 67 - 10 - 170,
    left: 8,
  });
});

test('지도 창: 세로는 폭 640 지도를 가운데 높이에, 가로는 화면 폭 지도를 세로로 스크롤', () => {
  const port = fishingCamera(402, 874, 1, { x: 34.1, y: 55.9 });
  assert.equal(port.size, 640);
  assert.equal(port.sx, 17);
  assert.equal(port.sy, 0);
  assert.ok(Math.abs(port.top - (874 - 640 / 1.5) / 2) < 0.01);
  const land = fishingCamera(874, 402, 1, { x: 34.1, y: 55.9 });
  assert.equal(land.sx, 0);
  assert.equal(land.sy, Math.round(583 * 0.559 - 201));
  // 확대해도 보는 곳은 화면 가운데에 남는다
  const zoom = fishingCamera(402, 874, 1.4, { x: 34.1, y: 55.9 });
  assert.ok(Math.abs(zoom.left + zoom.size * 0.341 - 201) <= 1);
  // 가로에서 0.8배로 줄여 지도가 화면보다 좁으면 가로 가운데
  const far = fishingCamera(874, 402, 0.8, { x: 10, y: 55.9 });
  assert.ok(Math.abs(far.left - (874 - far.size) / 2) <= 0.5);
});

test('낚시 고양이: 잡은 뒤 reel을 마치면 집중 focus로 돌아가고 동작 줄이기는 즉시 reel을 멈춘다', async () => {
  jest.useFakeTimers();
  const props = {
    spot: { x: 34.1, y: 55.9, face: 1 },
    size: 640,
    sizeY: 640 / 1.5,
    color: 'ginger' as const,
    name: '나',
    seconds: 0,
    reduce: false,
  };
  const screen = await render(React.createElement(FishingActor, props));
  const motion = () => screen.getByTestId('fishing-actor-cat').props.motion;

  assert.equal(motion(), 'focus');
  await screen.rerender(React.createElement(FishingActor, { ...props, seconds: SECONDS_PER_FISH }));
  assert.equal(motion(), 'reel');

  await act(async () => jest.advanceTimersByTime(2000));
  assert.equal(motion(), 'focus');

  await screen.rerender(
    React.createElement(FishingActor, { ...props, seconds: SECONDS_PER_FISH * 2 }),
  );
  assert.equal(motion(), 'reel');
  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      seconds: SECONDS_PER_FISH * 2,
      reduce: true,
    }),
  );
  assert.equal(motion(), 'focus');
  await screen.unmount();
  jest.useRealTimers();
});

test('낚시 주민: cast 스프라이트 동작 중에는 정적 낚싯대를 겹치지 않는다', async () => {
  const screen = await render(
    React.createElement(FishingActor, {
      spot: { x: 34.1, y: 55.9, face: 1 },
      size: 640,
      sizeY: 640 / 1.5,
      color: 'ginger',
      name: '주민',
      seconds: 0,
      reduce: false,
      motion: 'cast',
    }),
  );
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'cast');
  assert.equal(screen.queryByTestId('fishing-actor-rod'), null);
  await screen.unmount();
});

test('낚시 주민 이동 cleanup은 시작한 Animated composite를 중단한다', async () => {
  const callback = jest.fn();
  const screen = await render(
    React.createElement(FishingPeerActorView, {
      actor: {
        ...({
          userId: 'u1',
          sessionId: 's1',
          name: '주민',
          color: 'ginger',
          subject: '수학',
          seconds: 0,
          status: 'active',
        } as const),
        key: 'u1:s1',
        slot: 0,
        spot: PEER_SPOTS[0],
        position: LANDING,
        phase: 'entering',
        visible: true,
        generation: 1,
      },
      size: 640,
      sizeY: 640 / 1.5,
      reduce: false,
      onEntered: callback,
      onCast: callback,
      onPausedExit: callback,
      onStretch: callback,
      onCompletedExit: callback,
    }),
  );

  await screen.unmount();
  assert.equal(callback.mock.calls.length, 0);
});

test('바다 뗏목: 보상 reel은 끝나고 설정 변경 또는 카운트 초기화 때 남지 않는다', async () => {
  jest.useFakeTimers();
  const props = {
    color: 'ginger' as const,
    hull: 'raft',
    seconds: 0,
    emote: null,
    name: '나',
    subject: '집중',
    mine: true,
    reduce: false,
  };
  const screen = await render(React.createElement(FishingBoat, props));
  const motion = () => screen.getByTestId('fishing-boat-cat').props.motion;

  await screen.rerender(React.createElement(FishingBoat, { ...props, seconds: SECONDS_PER_FISH }));
  assert.equal(motion(), 'reel');
  await act(async () => jest.advanceTimersByTime(1900));
  assert.equal(motion(), 'focus');

  await screen.rerender(
    React.createElement(FishingBoat, { ...props, seconds: SECONDS_PER_FISH * 2 }),
  );
  assert.equal(motion(), 'reel');
  await screen.rerender(
    React.createElement(FishingBoat, { ...props, seconds: SECONDS_PER_FISH * 2, reduce: true }),
  );
  assert.equal(motion(), 'focus');
  await screen.rerender(React.createElement(FishingBoat, { ...props, seconds: 0 }));
  assert.equal(motion(), 'focus');
  await screen.unmount();
  jest.useRealTimers();
});

test('FishingActor: motion="tilt" 또는 "stretch" 지정 시 낚싯대를 숨기고 focus/reel 시 표시한다', async () => {
  const tiltActor = await render(
    React.createElement(FishingActor, {
      spot: { x: 50, y: 50, face: 1 },
      size: 100,
      sizeY: 100,
      color: 'ginger',
      name: '나',
      seconds: 0,
      reduce: false,
      motion: 'tilt',
    }),
  );
  assert.equal(tiltActor.getByTestId('fishing-actor-cat').props.motion, 'tilt');
  assert.equal(tiltActor.queryByTestId('fishing-actor-rod'), null);
  await tiltActor.unmount();

  const stretchActor = await render(
    React.createElement(FishingActor, {
      spot: { x: 50, y: 50, face: 1 },
      size: 100,
      sizeY: 100,
      color: 'ginger',
      name: '나',
      seconds: 0,
      reduce: false,
      motion: 'stretch',
    }),
  );
  assert.equal(stretchActor.getByTestId('fishing-actor-cat').props.motion, 'stretch');
  assert.equal(stretchActor.queryByTestId('fishing-actor-rod'), null);
  await stretchActor.unmount();

  const focusActor = await render(
    React.createElement(FishingActor, {
      spot: { x: 50, y: 50, face: 1 },
      size: 100,
      sizeY: 100,
      color: 'ginger',
      name: '나',
      seconds: 0,
      reduce: false,
    }),
  );
  assert.notEqual(focusActor.queryByTestId('fishing-actor-rod'), null);
  await focusActor.unmount();
});
