import assert from 'node:assert/strict';
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { landPath, onLand } from '@/utils/world-grid';
import { SECONDS_PER_FISH } from '@/services/model';
import { FishingBoat } from '@/screens/focus/FocusSea';
import {
  LANDING,
  PEER_SPOTS,
  DEFAULT_SPOT,
  DEFAULT_CATCH_PLACEMENT,
  FishingActor,
  FishingIsland,
  FishingPeerActorView,
  GRAM,
  RAFT,
  anchorCard,
  castSpot,
  fishingCamera,
  SEAT_GAP,
  fishingGrid,
  nearGram,
  castAngle,
  castLineStart,
  nearRaft,
  occupied,
  Spot,
  peerLandRoute,
  peerPixelsAtSize,
  peerPointFromPixels,
  peerWalkFace,
  fishingCatchPlacement,
  fishingCatchFootprintOnLand,
  fishingPeerCatchVisible,
} from '@/screens/focus/FishingIsland';

jest.mock('@/components/CatSprite', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CatSprite: ({ testID, motion, left }: { testID?: string; motion: string; left?: boolean }) =>
      React.createElement(View, { testID, motion, left }),
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

test('모든 주민 자리와 알려진 자리에서 화면상 가장 가까운 물 mask 칸을 찾는다', () => {
  assert.equal(onLand(fishingGrid, { x: 19.5, y: 38.7 }), true);
  for (const spot of PEER_SPOTS)
    assert.deepEqual(
      { x: spot.x, y: spot.y, face: spot.face, bx: spot.bx, by: spot.by },
      castSpot(spot),
    );
  assert.equal(onLand(fishingGrid, { x: PEER_SPOTS[0].bx!, y: PEER_SPOTS[0].by! }), false);
  const seats = [...PEER_SPOTS, { x: 70, y: 30 }, { x: 75, y: 45 }, { x: 40, y: 70 }];
  for (const seat of seats) {
    const spot = castSpot(seat);
    assert.ok(spot.bx != null && spot.by != null, `${seat.x},${seat.y}: 물 목표 없음`);
    const col = Math.floor((spot.bx! / fishingGrid.w) * fishingGrid.cols),
      row = Math.floor((spot.by! / fishingGrid.h) * fishingGrid.rows),
      targetCell = fishingGrid.cells[row * fishingGrid.cols + col],
      screenDistance = Math.hypot(spot.bx! - seat.x, ((spot.by! - seat.y) * 2) / 3);
    assert.equal(targetCell, '0', `${seat.x},${seat.y}: 찌 목표가 물 mask 바깥`);
    assert.ok(screenDistance <= 12, `${seat.x},${seat.y}: 화면 거리 ${screenDistance}`);
    for (let c = 0; c < fishingGrid.cells.length; c++) {
      if (fishingGrid.cells[c] === '1') continue;
      const wx = ((c % fishingGrid.cols) + 0.5) * (fishingGrid.w / fishingGrid.cols),
        wy = (Math.floor(c / fishingGrid.cols) + 0.5) * (fishingGrid.h / fishingGrid.rows),
        distance = Math.hypot(wx - seat.x, ((wy - seat.y) * 2) / 3);
      assert.ok(
        screenDistance <= distance + 1e-9,
        `${seat.x},${seat.y}: 더 가까운 물 칸 ${c} 존재`,
      );
    }
  }
});

test('위·아래·대각 cast 방향과 낚싯대 끝의 줄 시작점은 같은 화면 벡터다', () => {
  const cases = [
    { x: 50, y: 50, face: 1, bx: 50, by: 40, angle: -Math.PI / 2 },
    { x: 50, y: 50, face: 1, bx: 50, by: 60, angle: Math.PI / 2 },
    { x: 50, y: 50, face: -1, bx: 40, by: 60, angle: Math.atan2(20 / 3, -10) },
  ];
  for (const spot of cases) {
    assert.ok(Math.abs(castAngle(spot) - spot.angle) < 1e-9);
    const start = castLineStart(spot),
      vx = spot.bx! - spot.x,
      vy = (spot.by! - spot.y) * (2 / 3),
      sx = start.x - spot.x,
      sy = (start.y - spot.y) * (2 / 3);
    assert.ok(Math.abs(vx * sy - vy * sx) < 1e-9, '줄이 찌 방향과 일직선이어야 함');
    assert.ok(vx * sx + vy * sy > 0, '줄은 고양이에서 찌 방향으로 나가야 함');
    assert.ok(Math.hypot(sx, sy) < Math.hypot(vx, vy), '줄 시작점은 찌보다 고양이 쪽이어야 함');
  }
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
  assert.deepEqual(
    {
      x: PEER_SPOTS[0].x,
      y: PEER_SPOTS[0].y,
      face: PEER_SPOTS[0].face,
      bx: PEER_SPOTS[0].bx,
      by: PEER_SPOTS[0].by,
    },
    { x: 18.5, y: 39.5, face: 1, bx: 21, by: 39 },
  );
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
    if (!placement) {
      assert.ok(index >= PEER_SPOTS.length, `${index}: 낚시 자리의 보상 위치를 찾지 못함`);
      continue;
    }
    for (const [reward, width, height] of rewards)
      assert.ok(
        fishingCatchFootprintOnLand(spot, placement!, width, height),
        `${index} ${reward}: 보상 프레임이 물에 걸침`,
      );
  }
});

test('물고기 보상은 인접한 육지 후보만 쓰고 후보가 없으면 렌더링하지 않는다', async () => {
  const spot = { x: 51, y: 47, face: 1 },
    placement = fishingCatchPlacement(spot);
  if (placement) {
    assert.ok(
      Math.min(
        Math.hypot(placement.left + 1, placement.top - 0.06),
        Math.hypot(placement.left - 0.9, placement.top - 0.06),
      ) <= 0.75,
    );
    assert.ok(fishingCatchFootprintOnLand(spot, placement));
  }
  const screen = await render(
    React.createElement(FishingActor, {
      spot,
      size: 640,
      sizeY: 640 / 1.5,
      color: 'ginger',
      name: '주민',
      seconds: SECONDS_PER_FISH,
      reduce: true,
    }),
  );
  assert.equal(screen.queryByTestId('fishing-actor-catch') != null, placement != null);
  await screen.unmount();
});

test('15개 주민 자리의 보상은 다른 고양이 및 보상 더미와 겹치지 않는다', () => {
  const box = (spot: { x: number; y: number }, left: number, top: number) => {
    const x = spot.x + (left - 0.5) * 7.7,
      y = spot.y + (top - 0.90625) * 11.55;
    return { left: x, right: x + 8.47, top: y, bottom: y + 12.705 };
  };
  const cat = (spot: { x: number; y: number }) => ({
    left: spot.x - 3.85,
    right: spot.x + 3.85,
    top: spot.y - 10.4625,
    bottom: spot.y + 1.078125,
  });
  const gram = {
    left: GRAM.x - GRAM.w / 2,
    right: GRAM.x + GRAM.w / 2,
    top: GRAM.y - ((GRAM.w * 886) / 608) * 1.5,
    bottom: GRAM.y,
  };
  const overlap = (a: ReturnType<typeof cat>, b: ReturnType<typeof cat>) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const boxes = PEER_SPOTS.map((spot) => {
    const placement = fishingCatchPlacement(spot);
    assert.ok(placement);
    return box(spot, placement!.left, placement!.top);
  });
  for (let i = 0; i < PEER_SPOTS.length; i++) {
    assert.ok(!overlap(boxes[i], gram), `${i} 보상과 축음기 겹침`);
    for (let j = 0; j < PEER_SPOTS.length; j++) {
      if (i === j) continue;
      assert.ok(
        !overlap(boxes[i], cat(PEER_SPOTS[j])),
        `${i} 보상 ${JSON.stringify(PEER_SPOTS[i])}/${JSON.stringify(fishingCatchPlacement(PEER_SPOTS[i]))}와 ${j} 고양이 ${JSON.stringify(PEER_SPOTS[j])} 겹침`,
      );
      if (j > i)
        assert.ok(
          !overlap(boxes[i], boxes[j]),
          `${i}·${j} 보상 겹침: ${JSON.stringify(PEER_SPOTS[i])}/${JSON.stringify(fishingCatchPlacement(PEER_SPOTS[i]))}, ${JSON.stringify(PEER_SPOTS[j])}/${JSON.stringify(fishingCatchPlacement(PEER_SPOTS[j]))}`,
        );
    }
  }
});

test('주민 11명 이상이어도 스크린리더의 기본 빈 자리를 안전하게 고른다', () => {
  assert.ok(DEFAULT_CATCH_PLACEMENT);
  const defaultSpot = castSpot(DEFAULT_SPOT),
    box = (spot: { x: number; y: number }, left: number, top: number) => {
      const x = spot.x + (left - 0.5) * 7.7,
        y = spot.y + (top - 0.90625) * 11.55;
      return { left: x, right: x + 8.47, top: y, bottom: y + 12.705 };
    },
    cat = (spot: { x: number; y: number }) => ({
      left: spot.x - 3.85,
      right: spot.x + 3.85,
      top: spot.y - 10.4625,
      bottom: spot.y + 1.078125,
    }),
    overlap = (a: ReturnType<typeof cat>, b: ReturnType<typeof cat>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    defaultReward = box(defaultSpot, DEFAULT_CATCH_PLACEMENT!.left, DEFAULT_CATCH_PLACEMENT!.top);
  for (const count of [11, 15]) {
    const peers = PEER_SPOTS.slice(0, count),
      placement = fishingCatchPlacement(defaultSpot, peers, peers);
    assert.deepEqual(
      placement,
      DEFAULT_CATCH_PLACEMENT,
      `${count} 주민에서도 고정된 예약 배치 사용`,
    );
    for (const peer of peers) {
      const peerPlacement = fishingCatchPlacement(peer)!;
      assert.ok(
        !overlap(defaultReward, cat(peer)),
        `${peer.x},${peer.y} 고양이가 기본 보상에 겹침`,
      );
      assert.ok(
        !overlap(defaultReward, box(peer, peerPlacement.left, peerPlacement.top)),
        `${peer.x},${peer.y} 보상이 기본 보상에 겹침`,
      );
      assert.ok(
        !overlap(box(peer, peerPlacement.left, peerPlacement.top), cat(defaultSpot)),
        `${peer.x},${peer.y} 보상이 기본 고양이를 덮음`,
      );
    }
  }
});

test('숨겨진 resident 보상은 mine placement obstacle이 아니다', () => {
  const spot = castSpot({ x: 11, y: 9 }),
    hiddenPlacement = fishingCatchPlacement(spot, PEER_SPOTS, []),
    visiblePlacement = fishingCatchPlacement(spot, PEER_SPOTS, PEER_SPOTS);
  assert.ok(hiddenPlacement, '고양이만 장애물로 남으면 빈 자리에 보상을 둔다');
  assert.equal(visiblePlacement, null, '실제로 보이는 resident 보상은 겹침을 막는다');
});

test('숨겨진 resident 예약 보상은 mine 고양이와의 충돌을 좌석 선택 때 막는다', () => {
  const spot = castSpot({ x: 8, y: 40 }),
    peer = PEER_SPOTS[0],
    hidden = fishingCatchPlacement(spot, PEER_SPOTS, []),
    visible = fishingCatchPlacement(spot, PEER_SPOTS, [peer]);
  assert.equal(
    hidden,
    null,
    '아직 숨겨진 resident 보상도 이후 표시될 때 mine 고양이를 덮을 수 없다',
  );
  assert.equal(visible, null, 'resident 보상이 보이기 시작한 뒤에도 안전한 선택 기준은 같다');
});

test('아직 배정되지 않은 PEER 좌석의 예약 보상도 mine 고양이와 충돌하지 않는다', () => {
  const spot = castSpot({ x: 47.5, y: 17 }),
    withoutFutureReservations = fishingCatchPlacement(spot, [], [], false),
    beforeThirdResident = fishingCatchPlacement(spot, [], [], false, PEER_SPOTS),
    afterThirdResidentArrives = fishingCatchPlacement(
      spot,
      PEER_SPOTS.slice(0, 3),
      [],
      false,
      PEER_SPOTS,
    ),
    defaultSpot: Spot = {
      ...castSpot(DEFAULT_SPOT),
      catchPlacement: DEFAULT_CATCH_PLACEMENT,
    };

  assert.ok(withoutFutureReservations, '회귀 위치는 future seat을 예약하지 않으면 선택 가능하다');
  assert.equal(beforeThirdResident, null, '자리 선택 시점에 전체 resident 슬롯의 보상을 예약한다');
  assert.equal(afterThirdResidentArrives, null, '주민 입장 전후 mine 보상 안전성이 유지된다');
  assert.deepEqual(
    fishingCatchPlacement(defaultSpot, PEER_SPOTS, [], false, PEER_SPOTS),
    DEFAULT_CATCH_PLACEMENT,
    '스크린리더 기본 자리는 계속 유효하다',
  );

  for (const gramVisible of [false, true]) {
    let available = 0;
    for (let row = 1; row < fishingGrid.rows; row += 3)
      for (let col = 1; col < fishingGrid.cols; col += 3) {
        const point = {
          x: ((col + 0.5) * 100) / fishingGrid.cols,
          y: ((row + 0.5) * 100) / fishingGrid.rows,
        };
        if (
          !onLand(fishingGrid, point) ||
          !landPath(fishingGrid, LANDING, point).length ||
          nearRaft(point) ||
          (gramVisible && nearGram(point))
        )
          continue;
        if (fishingCatchPlacement(castSpot(point), [], [], gramVisible, PEER_SPOTS)) available++;
      }
    assert.ok(
      available >= 5,
      `${gramVisible ? '축음기 설치' : '축음기 미설치'} 시 선택 가능한 후보 ${available}개`,
    );
  }
});

test('아직 배정되지 않은 PEER 고양이 영역도 mine 보상 자리에서 예약한다', () => {
  const spot = castSpot({ x: 2, y: 44 }),
    withoutFutureReservations = fishingCatchPlacement(spot, [], [], false),
    beforeFirstResident = fishingCatchPlacement(spot, [], [], false, PEER_SPOTS),
    afterFirstResidentArrives = fishingCatchPlacement(
      spot,
      PEER_SPOTS.slice(0, 1),
      [],
      false,
      PEER_SPOTS,
    );

  assert.ok(withoutFutureReservations, '회귀 위치는 future seat을 예약하지 않으면 보상을 표시한다');
  assert.equal(
    beforeFirstResident,
    null,
    '주민이 입장하기 전부터 전체 슬롯의 고양이 영역을 예약한다',
  );
  assert.equal(afterFirstResidentArrives, null, '주민 입장 때 기존 mine 보상이 사라지지 않는다');
});

test('mine 보상 footprint가 뗏목 실제 그림 영역을 덮지 않는다', () => {
  const raftHalfHeight = 6 * (669 / 928) * (1536 / 1024),
    raft = {
      left: RAFT.x - 6,
      right: RAFT.x + 6,
      top: RAFT.y - raftHalfHeight,
      bottom: RAFT.y + raftHalfHeight,
    },
    rewardBounds = (
      spot: Spot,
      placement: NonNullable<ReturnType<typeof fishingCatchPlacement>>,
    ) => {
      const left = spot.x + (placement.left - 0.5) * 7.7,
        top = spot.y + (placement.top - 0.90625) * 11.55;
      return { left, top, right: left + 8.47, bottom: top + 12.705 };
    },
    overlapsRaft = (reward: ReturnType<typeof rewardBounds>) =>
      reward.left < raft.right &&
      reward.right > raft.left &&
      reward.top < raft.bottom &&
      reward.bottom > raft.top,
    spot = castSpot({ x: 48, y: 85.5 }),
    placement = fishingCatchPlacement(spot, [], undefined, false);
  assert.ok(placement, '회귀 좌표는 고양이가 앉을 수 있고 인접 보상 후보도 있다');
  assert.equal(overlapsRaft(rewardBounds(spot, placement)), false);
  for (const peer of PEER_SPOTS)
    assert.equal(
      overlapsRaft(rewardBounds(peer, peer.catchPlacement!)),
      false,
      `${peer.x},${peer.y} 주민 보상이 뗏목 그림을 덮음`,
    );
});

test('축음기가 있을 때만 보상 배치가 축음기 영역을 장애물로 취급하고 resident 자리는 고정된다', async () => {
  let candidate: {
    spot: Spot;
    placement: NonNullable<ReturnType<typeof fishingCatchPlacement>>;
  } | null = null;
  for (let y = 55; y <= 74 && !candidate; y += 0.5)
    for (let x = 44; x <= 56 && !candidate; x += 0.5) {
      const point = { x, y };
      if (!onLand(fishingGrid, point)) continue;
      const spot = castSpot(point),
        withGram = fishingCatchPlacement(spot, [], undefined, true),
        withoutGram = fishingCatchPlacement(spot, [], undefined, false);
      if (!withGram && withoutGram) candidate = { spot, placement: withoutGram };
    }

  assert.ok(candidate, '축음기 설치 때문에 막혔던 육지 후보는 미설치 시 사용할 수 있다');
  assert.ok(fishingCatchFootprintOnLand(candidate.spot, candidate.placement));
  assert.equal(fishingCatchPlacement(candidate.spot, [], undefined, true), null);
  for (const peer of PEER_SPOTS)
    assert.deepEqual(
      fishingCatchPlacement(peer, [], undefined, false),
      fishingCatchPlacement(peer, [], undefined, true),
      'resident 좌석과 보상은 건물 상태와 무관하게 미리 정한 안전 배치를 유지한다',
    );

  const props = {
    spot: candidate.spot,
    size: 640,
    sizeY: 640 / 1.5,
    color: 'ginger' as const,
    name: '나',
    seconds: SECONDS_PER_FISH,
    reduce: true,
  };
  const screen = await render(
    React.createElement(FishingActor, { ...props, catchGramVisible: true }),
  );
  assert.equal(screen.queryByTestId('fishing-actor-catch'), null);
  await screen.rerender(React.createElement(FishingActor, { ...props, catchGramVisible: false }));
  assert.ok(screen.queryByTestId('fishing-actor-catch'));
  await screen.unmount();
});

test('resident 보상은 count가 있고 좌석에 정착해 있을 때만 visible obstacle이다', () => {
  const spot = PEER_SPOTS[0],
    actor = {
      visible: true,
      seconds: SECONDS_PER_FISH,
      position: { x: spot.x, y: spot.y },
      spot,
      phase: 'fishing',
    };
  assert.equal(fishingPeerCatchVisible(actor), true);
  assert.equal(fishingPeerCatchVisible({ ...actor, seconds: 0 }), false);
  assert.equal(fishingPeerCatchVisible({ ...actor, phase: 'entering' }), false);
  assert.equal(fishingPeerCatchVisible({ ...actor, position: LANDING }), false);
  assert.equal(fishingPeerCatchVisible({ ...actor, visible: false }), false);
});

test('내가 고른 자리의 보상도 주민 좌석의 고양이·더미와 겹치지 않는다', async () => {
  const spot = castSpot({ x: 50, y: 52 }),
    overlappingPeer: Spot = {
      x: 60,
      y: 52,
      face: 1,
      catchPlacement: { left: -1, top: 0.06 },
    },
    placement = fishingCatchPlacement(spot, [overlappingPeer]);
  const box = (p: { x: number; y: number }, left: number, top: number) => {
      const x = p.x + (left - 0.5) * 7.7,
        y = p.y + (top - 0.90625) * 11.55;
      return { left: x, right: x + 8.47, top: y, bottom: y + 12.705 };
    },
    cat = (p: { x: number; y: number }) => ({
      left: p.x - 3.85,
      right: p.x + 3.85,
      top: p.y - 10.4625,
      bottom: p.y + 1.078125,
    }),
    overlap = (a: ReturnType<typeof cat>, b: ReturnType<typeof cat>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    mineCat = cat(spot),
    peerReward = box(
      overlappingPeer,
      overlappingPeer.catchPlacement!.left,
      overlappingPeer.catchPlacement!.top,
    );
  assert.ok(overlap(peerReward, mineCat), '거주자 보상이 내 고양이를 덮는 재현 배치');
  assert.equal(placement, null, '겹침을 피할 인접 위치가 없으면 이 자리는 선택하지 않는다');

  const screen = await render(
    React.createElement(FishingActor, {
      spot,
      size: 640,
      sizeY: 640 / 1.5,
      color: 'ginger',
      name: '나',
      seconds: SECONDS_PER_FISH,
      reduce: true,
      catchAvoidSpots: [overlappingPeer],
    }),
  );
  const catchImage = screen.queryByTestId('fishing-actor-catch');
  assert.equal(catchImage, null);
  await screen.unmount();
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
  const catImage = screen.getByTestId('fishing-actor-cat');
  assert.equal(catchImage.parent, catImage.parent);
  assert.ok(
    catchImage.parent!.children.indexOf(catchImage) < catchImage.parent!.children.indexOf(catImage),
    '자기 고양이와 겹치는 픽셀은 CatSprite가 앞에서 가려야 한다',
  );
  assert.equal(catchImage.props.style.left, placement.left * size * 0.077);
  assert.equal(catchImage.props.style.top, placement.top * size * 0.077);
  assert.equal(catchImage.props.style.width, size * 0.077 * 1.1);
  await screen.unmount();
});

test('보상이 없거나 숨겨진 주민의 depth sort는 보상 footprint를 반영하지 않는다', async () => {
  const props = {
    spot: PEER_SPOTS[1],
    size: 640,
    sizeY: 640 / 1.5,
    color: 'ginger' as const,
    name: '주민',
    seconds: 0,
    reduce: true,
  };
  const screen = await render(React.createElement(FishingActor, props));
  const baseZIndex = 20 + Math.round(props.spot.y),
    actorZIndex = () => {
      const actorView = screen.getByTestId('fishing-actor-cat').parent;
      assert.ok(actorView);
      return actorView.props.style.zIndex;
    };
  assert.equal(actorZIndex(), baseZIndex);

  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      seconds: SECONDS_PER_FISH,
      catchVisible: false,
    }),
  );
  assert.equal(screen.queryByTestId('fishing-actor-catch'), null);
  assert.equal(actorZIndex(), baseZIndex);
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
  const screen = await render(
    React.createElement(FishingActor, { ...props, catchVisible: false, motion: 'walk' }),
  );
  assert.equal(screen.queryByTestId('fishing-actor-catch'), null);

  await screen.rerender(React.createElement(FishingActor, props));
  assert.notEqual(screen.queryByTestId('fishing-actor-catch'), null);
  await screen.unmount();
});

test('입장 도중 완료되어 기지개로 전환돼도 좌석에 도착하기 전 보상을 숨긴다', async () => {
  const callback = jest.fn();
  const baseActor = {
    ...({
      userId: 'u1',
      sessionId: 's1',
      name: '주민',
      color: 'ginger',
      subject: '수학',
      seconds: SECONDS_PER_FISH,
      status: 'active',
    } as const),
    key: 'u1:s1',
    slot: 0,
    spot: PEER_SPOTS[0],
    position: LANDING,
    visible: true,
    generation: 1,
  };
  const viewProps = {
    size: 640,
    sizeY: 640 / 1.5,
    reduce: false,
    onEntered: callback,
    onCast: callback,
    onPausedExit: callback,
    onStretch: callback,
    onCompletedExit: callback,
  };
  const screen = await render(
    React.createElement(FishingPeerActorView, {
      ...viewProps,
      actor: { ...baseActor, phase: 'entering', generation: 1 },
    }),
  );
  assert.equal(screen.queryByTestId('fishing-actor-catch'), null);

  // 완료 이벤트가 입장 이동을 중단하면 actor.position은 LANDING에 남고
  // animatedPosition은 실제 중간 픽셀에서 멈춘다. stretch도 보상을 보이면 안 된다.
  await screen.rerender(
    React.createElement(FishingPeerActorView, {
      ...viewProps,
      actor: { ...baseActor, phase: 'finishing', generation: 2 },
    }),
  );
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'stretch');
  assert.equal(screen.queryByTestId('fishing-actor-catch'), null);

  await screen.rerender(
    React.createElement(FishingPeerActorView, {
      ...viewProps,
      actor: { ...baseActor, position: PEER_SPOTS[0], phase: 'fishing', generation: 3 },
    }),
  );
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

test('컷신 종료 전에는 섬 황금 물고기를 숨기고 종료 뒤에만 표시한다', async () => {
  const props = {
    focus: DEFAULT_SPOT,
    spots: [],
    onRaft: jest.fn(),
    children: () => null,
  };
  const wrap = (goldenFish = false) =>
    React.createElement(
      SafeAreaProvider,
      {
        initialMetrics: {
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
      React.createElement(FishingIsland, { ...props, goldenFish }),
    );
  const screen = await render(wrap());
  assert.equal(screen.queryByTestId('fishing-island-golden-fish'), null);
  await screen.rerender(wrap(true));
  const fish = screen.getByTestId('fishing-island-golden-fish');
  assert.equal(fish.props.accessibilityLabel, '방금 함께 낚은 황금 물고기');
  await screen.unmount();
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

test('황금 물고기 참여자: 더미에 황금 물고기를 남기고 새 사건을 reel로 한 번 알린다', async () => {
  jest.useFakeTimers();
  const props = {
    spot: { x: 34.1, y: 55.9, face: 1 },
    size: 640,
    sizeY: 640 / 1.5,
    color: 'ginger' as const,
    name: '나',
    seconds: 0,
    reduce: false,
    goldenFishCount: 0,
    goldenCatchToken: null,
  };
  const screen = await render(React.createElement(FishingActor, props));
  assert.equal(screen.queryByTestId('fishing-actor-golden-fish-0'), null);

  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      goldenFishCount: 1,
      goldenCatchToken: 'golden-i1-1',
    }),
  );
  assert.notEqual(screen.queryByTestId('fishing-actor-golden-fish-0'), null);
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'reel');

  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      goldenFishCount: 1,
      goldenCatchToken: 'golden-i1-1',
      reduce: true,
    }),
  );
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'focus');

  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      goldenFishCount: 1,
      goldenCatchToken: 'golden-i1-1',
    }),
  );
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'focus');

  await act(async () => jest.advanceTimersByTime(2000));
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'focus');

  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      motion: 'stretch',
      goldenFishCount: 2,
      goldenCatchToken: 'golden-i1-2',
    }),
  );
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'reel');
  assert.notEqual(screen.queryByTestId('fishing-actor-rod'), null);
  await act(async () => jest.advanceTimersByTime(2000));
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'stretch');

  await screen.rerender(
    React.createElement(FishingActor, {
      ...props,
      goldenFishCount: 2,
      goldenCatchToken: 'golden-i1-2',
      reduce: true,
    }),
  );
  assert.notEqual(screen.queryByTestId('fishing-actor-golden-fish-1'), null);
  assert.equal(screen.getByTestId('fishing-actor-cat').props.motion, 'focus');
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
      spot: { x: 50, y: 50, face: 1, bx: 52, by: 51 },
      size: 100,
      sizeY: 100 / 1.5,
      color: 'ginger',
      name: '나',
      seconds: 0,
      reduce: false,
    }),
  );
  assert.notEqual(focusActor.queryByTestId('fishing-actor-rod'), null);
  assert.equal(focusActor.getByTestId('fishing-actor-cat').props.left, false);
  const diagonalSpot = { x: 50, y: 50, face: 1, bx: 52, by: 51 },
    rod = focusActor.getByTestId('fishing-actor-rod'),
    rodStyle = rod.props.style,
    lineStart = castLineStart(diagonalSpot),
    rodSize = 100 * 0.077 * 0.6,
    screenAngle = castAngle(diagonalSpot);
  assert.deepEqual(rodStyle.transform, [
    { scale: rodStyle.transform[0].scale },
    { rotate: `${screenAngle + Math.PI / 4}rad` },
  ]);
  assert.ok(!('scaleX' in rodStyle.transform[0]), '낚싯대 축은 비균일하게 변형하지 않는다');
  assert.ok(
    Math.abs(rodStyle.left + rodSize * 0.96 - (100 * 0.077) / 2 - (lineStart.x - 50)) < 1e-9,
    '낚싯대 끝의 x좌표는 줄 시작점과 일치해야 함',
  );
  assert.ok(
    Math.abs(rodStyle.top + rodSize * 0.04 - 100 * 0.077 * 0.90625 - (lineStart.y - 50) / 1.5) <
      1e-9,
    '낚싯대 끝의 y좌표는 줄 시작점과 일치해야 함',
  );
  await focusActor.unmount();

  for (const motion of ['walk', 'cast'] as const) {
    const westActor = await render(
      React.createElement(FishingActor, {
        spot: { x: 50, y: 50, face: -1, bx: 40, by: 60 },
        size: 100,
        sizeY: 100 / 1.5,
        color: 'ginger',
        name: '주민',
        seconds: 0,
        reduce: false,
        motion,
      }),
    );
    assert.equal(
      westActor.getByTestId('fishing-actor-cat').props.left,
      true,
      `${motion} 서쪽 방향`,
    );
    assert.equal(westActor.queryByTestId('fishing-actor-rod'), null);
    await westActor.unmount();
  }
});
