import {
  harborCamera,
  harborFrame,
  harborOceanBounds,
  harborPose,
  harborScenePose,
  pelicanPose,
  type HarborDirection,
} from './harborMotion';
import { componentTokens } from '@/design-system/tokens';
import footprints from './__fixtures__/harbor-footprints.json';

test('펠리컨은 착지해 잡지를 내려놓고 떠나며, 놓은 잡지는 뗏목에 남는다', () => {
  const frame = harborFrame(402, 874, 'pelican-mail');
  expect(pelicanPose(frame, 0.5).birdRest).toBe(1);
  expect(pelicanPose(frame, 1).birdRest).toBe(0);
  expect(pelicanPose(frame, 1).birdY).toBeLessThan(pelicanPose(frame, 0.5).birdY);
  for (const t of [0.75, 0.85, 1]) {
    const book = pelicanPose(frame, t);
    const boat = harborScenePose(frame, t, 'pelican-mail');
    expect(book.bookY).toBeCloseTo(boat.raftY + frame.raftSize * 0.04);
    expect(book.bookPlaced).toBe(1);
    expect(book.bookHeld).toBe(0);
    expect(book.bookDeckTilt).toBe(0);
  }
});

test.each([
  [402, 874],
  [874, 402],
  [1024, 1366],
  [1366, 1024],
  [249, 541],
])('%s×%s 바다 컷신은 확대 중에도 배경을 채우고 뗏목을 화면에 둔다', (width, height) => {
  for (const kind of ['abandon', 'pelican-mail'] as const) {
    const frame = harborFrame(width, height, kind);
    const bounds = harborOceanBounds(frame, kind);
    for (let step = 0; step <= 80; step++) {
      const t = step / 80;
      const camera = harborCamera(frame, t, kind);
      const pose = harborScenePose(frame, t, kind);
      const raftLeft =
        width / 2 + camera.x + (pose.raftX - frame.raftSize * 0.49 - width / 2) * camera.zoom;
      const raftRight =
        width / 2 + camera.x + (pose.raftX + frame.raftSize * 0.53 - width / 2) * camera.zoom;
      expect(raftLeft).toBeGreaterThanOrEqual(0);
      expect(raftRight).toBeLessThanOrEqual(width);
      const left = width / 2 + camera.x + (bounds.left - width / 2) * camera.zoom;
      const top = height / 2 + camera.y + (bounds.top - height / 2) * camera.zoom;
      const right = width / 2 + camera.x + (bounds.right - width / 2) * camera.zoom;
      const bottom = height / 2 + camera.y + (bounds.bottom - height / 2) * camera.zoom;
      expect(left).toBeLessThanOrEqual(0.001);
      expect(top).toBeLessThanOrEqual(0.001);
      expect(right).toBeGreaterThanOrEqual(width - 0.001);
      expect(bottom).toBeGreaterThanOrEqual(height - 0.001);
      const seatY = height / 2 + camera.y + (pose.raftY - height / 2) * camera.zoom;
      expect(seatY).toBeGreaterThan(frame.catSize * camera.zoom);
      expect(seatY + frame.raftSize * 0.3 * camera.zoom).toBeLessThan(height);
    }
  }
});

type Point = readonly number[];
// PNG의 불투명 픽셀에서 추출한 외곽을 쓴다. 이미지 캔버스의 투명 여백은 충돌로 세지 않는다.
function disjoint(a: Point[], b: Point[]) {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];
      const nx = start[1] - end[1];
      const ny = end[0] - start[0];
      const pa = a.map(([x, y]) => x * nx + y * ny);
      const pb = b.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return true;
    }
  }
  return false;
}

test('출항은 탑승 때 가까이 갔다가 멀어지고 도착은 넓게 시작해 부두 가까이 끝난다', () => {
  const frame = harborFrame(402, 874);
  const start = harborCamera(frame, 0, 'departure');
  const boarding = harborCamera(frame, 0.42, 'departure');
  const sea = harborCamera(frame, 1, 'departure');
  expect(boarding.zoom).toBeGreaterThan(start.zoom * 1.2);
  expect(boarding.zoom).toBeGreaterThan(sea.zoom * 3);
  expect(harborCamera(frame, 1, 'arrival').zoom).toBeGreaterThan(
    harborCamera(frame, 0, 'arrival').zoom * 2.5,
  );
  expect(frame.size * boarding.zoom).toBeLessThanOrEqual(620);
});

test.each([
  [402, 874],
  [874, 402],
  [1024, 1366],
  [1366, 1024],
  [249, 541],
])('%s×%s에서 확대·축소와 고양이 추적 중 바다의 빈 가장자리가 드러나지 않는다', (width, height) => {
  const frame = harborFrame(width, height);
  for (const direction of ['departure', 'arrival'] as HarborDirection[]) {
    const ocean = harborOceanBounds(frame, direction);
    // 실제 그리기는 이 영역 바깥에 타일 한 장을 더 둔다. 여기서는 여유 없이도 모든 숏이 덮이는지 본다.
    for (let step = 0; step <= 160; step++) {
      const camera = harborCamera(frame, step / 160, direction);
      const left = width / 2 + camera.x + (ocean.left - width / 2) * camera.zoom;
      const right = width / 2 + camera.x + (ocean.right - width / 2) * camera.zoom;
      const top = height / 2 + camera.y + (ocean.top - height / 2) * camera.zoom;
      const bottom = height / 2 + camera.y + (ocean.bottom - height / 2) * camera.zoom;
      expect(left).toBeLessThanOrEqual(0.001);
      expect(top).toBeLessThanOrEqual(0.001);
      expect(right).toBeGreaterThanOrEqual(width - 0.001);
      expect(bottom).toBeGreaterThanOrEqual(height - 0.001);
      const pose = harborPose(frame, direction === 'arrival' ? 1 - step / 160 : step / 160);
      const shore = footprints.harbor.map(([x, y]) => [
        pose.harborX + x * pose.harborSize,
        pose.harborY + y * pose.harborSize,
      ]);
      const angle = (pose.raftRoll * Math.PI) / 180;
      const raft = footprints.raft.map(([x, y]) => {
        const rx = (x - 0.5) * Math.cos(angle) - (y - 0.5) * Math.sin(angle) + 0.5;
        const ry = (x - 0.5) * Math.sin(angle) + (y - 0.5) * Math.cos(angle) + 0.5;
        return [
          pose.raftX + (rx - componentTokens.harborCutscene.raftAnchorX) * frame.raftSize,
          pose.raftY + (ry - componentTokens.harborCutscene.raftAnchorY) * frame.raftSize,
        ];
      });
      expect(disjoint(shore, raft)).toBe(true);
      const raftScreenX = raft.map(([x]) => width / 2 + camera.x + (x - width / 2) * camera.zoom);
      expect(Math.min(...raftScreenX)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...raftScreenX)).toBeLessThanOrEqual(width);
      expect(pose.harborSize * camera.zoom).toBeLessThanOrEqual(620.001);
      const inlandTop =
        height / 2 +
        camera.y +
        (pose.harborY +
          pose.harborSize * componentTokens.harborCutscene.camera.islandTopY -
          height / 2) *
          camera.zoom;
      expect(inlandTop).toBeLessThanOrEqual(-height * 0.06 + 0.001);
      // 해안을 잘라도 주인공은 화면 안에 남아야 한다.
      const catY = height / 2 + camera.y + (pose.catY - height / 2) * camera.zoom;
      expect(catY).toBeGreaterThan(frame.catSize * camera.zoom * 0.9);
      expect(catY).toBeLessThan(height);
    }
  }
});
