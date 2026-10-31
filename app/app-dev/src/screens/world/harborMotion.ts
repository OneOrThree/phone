import { componentTokens } from '@/design-system/tokens';

export type HarborDirection = 'departure' | 'arrival' | 'abandon' | 'pelican-mail';
const D = componentTokens.harborCutscene;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** 화면의 짧은 변으로 장면 크기를 정한다. 바다는 별도로 화면 전체에 깐다. */
export function harborFrame(
  width: number,
  height: number,
  direction: HarborDirection = 'departure',
) {
  // 최대 줌에서도 섬 원화가 기존 표시 상한을 넘지 않도록 기본 장면을 작게 잡는다.
  const pelican = direction === 'pelican-mail';
  const seaShot = pelican ? D.pelican : direction === 'abandon' ? D.abandon : null;
  const maxZoom = seaShot?.maxZoom ?? D.camera.maxZoom;
  const size = Math.min(
    width * D.sceneWidth,
    height * D.sceneHeight,
    D.maxSceneSize / maxZoom,
    seaShot ? (width * seaShot.maxRaftWidth) / (seaShot.raftSize * maxZoom) : Infinity,
  );
  const left = (width - size) / 2 + size * D.sceneOffsetX;
  const top = Math.max(0, (height - size * 1.2) * 0.45);
  return {
    width,
    height,
    size,
    left,
    top,
    catSize: size * (direction === 'abandon' ? D.abandon.catSize : D.catSize),
    raftSize: size * (seaShot?.raftSize ?? D.raftSize),
  };
}

/** 도착은 같은 시간축을 거꾸로 따라 접안 → 뛰어내리기 → 부두 착지가 된다. */
export function harborPose(frame: ReturnType<typeof harborFrame>, progress: number) {
  const { size, left, top, width, height } = frame;
  const hop = clamp((progress - D.hopStart) / (D.hopEnd - D.hopStart));
  const sail = smooth((progress - D.sailStart) / (D.sailEnd - D.sailStart));
  // 먼 바다에서도 해안은 가까운 지형처럼 남긴다. 부두 발 위치를 기준으로 크기를 바꾼다.
  const harborScale = mix(1, D.wideCoastScale, sail);
  const harborSize = size * harborScale;
  const harborX = left + size * D.harborPanX * sail - (harborSize - size) * D.dockX;
  const harborY = top + size * D.harborPanY * sail - (harborSize - size) * D.dockY;
  const dockX = harborX + harborSize * D.dockX;
  const dockY = harborY + harborSize * D.dockY;
  const raftX = mix(left + size * D.boardX, width * D.seaX, sail);
  // 해안을 화면 위에 둔 채 뗏목은 아래 바다까지 나간다. 섬과 배를 한 화면 안에 모으지 않는다.
  const framedSeaEndY =
    top +
    size * D.harborPanY -
    size * (D.wideCoastScale - 1) * D.dockY +
    size * D.wideCoastScale * D.camera.islandTopY +
    (height * (D.seaY + D.camera.coastCropTop)) / D.camera.wideZoom;
  // 높이가 낮은 화면도 접안 위치보다 반드시 바깥으로 나가며, 커지는 부두 쪽으로 되돌아가지 않는다.
  const seaEndY = Math.max(framedSeaEndY, top + size * (D.boardY + D.minSailingDistanceY));
  const raftY = mix(top + size * D.boardY, seaEndY, sail);
  const bob = Math.sin(progress * Math.PI * 6) * size * D.bob;
  const footX = mix(dockX, raftX, hop);
  const footY = mix(dockY, raftY + bob, hop);
  const jump = Math.sin(hop * Math.PI) * size * D.jumpHeight;
  const landing = Math.sin(clamp((progress - D.hopEnd) / 0.08) * Math.PI);
  return {
    harborX,
    harborY,
    harborSize,
    harborScale,
    harborDrawX: harborX + (harborSize - size) / 2,
    harborDrawY: harborY + (harborSize - size) / 2,
    raftX,
    raftY: raftY + bob,
    raftRoll: Math.sin(progress * Math.PI * 6) * D.raftRoll,
    catX: footX,
    catY: footY - jump,
    catScaleX: 1 - Math.sin(hop * Math.PI) * 0.08 + landing * 0.08,
    catScaleY: 1 + Math.sin(hop * Math.PI) * 0.1 - landing * 0.1,
    shadowY: footY,
    shadowOpacity: 0.18 - Math.sin(hop * Math.PI) * 0.12,
    shadowScale: 1 - Math.sin(hop * Math.PI) * 0.4,
    wakeOpacity: 0.25 + sail * 0.5,
  };
}

export const HARBOR_STEPS = Array.from({ length: 161 }, (_, i) => i / 160);

export const harborDuration = (kind: HarborDirection) =>
  kind === 'abandon'
    ? D.abandon.duration
    : kind === 'pelican-mail'
      ? D.pelican.duration
      : D.duration;

/** 배달 장면도 배·고양이·카메라를 하나의 시간축으로 움직인다. */
export function harborScenePose(
  frame: ReturnType<typeof harborFrame>,
  time: number,
  kind: HarborDirection,
) {
  if (kind === 'arrival') return harborPose(frame, 1 - time);
  if (kind === 'departure') return harborPose(frame, time);
  if (kind === 'abandon') {
    const base = harborPose(frame, 0);
    const stopped = smooth(time / D.abandon.slowEnd);
    const drift = 1 - Math.pow(1 - clamp(time / D.abandon.slowEnd), 3);
    const bob = Math.sin(time * Math.PI * 4) * frame.size * D.bob * mix(1, 0.5, stopped);
    const raftX = frame.width / 2 + frame.size * D.abandon.driftX * drift;
    const raftY = frame.height * 0.64 + frame.size * D.abandon.driftY * drift + bob;
    return {
      ...base,
      raftX,
      raftY,
      raftRoll: Math.sin(time * Math.PI * 4) * D.raftRoll * mix(1.5, 0.45, stopped),
      catX: raftX,
      catY: raftY,
      shadowY: raftY,
      shadowOpacity: 0.18,
      shadowScale: 1,
      wakeOpacity: mix(0.6, 0.06, stopped),
      catScaleX: 1 + 0.015 * Math.sin(time * Math.PI * 4),
      catScaleY: 1 - 0.015 * Math.sin(time * Math.PI * 4),
    };
  }
  const base = harborPose(frame, 0);
  const raftX = frame.width / 2;
  const raftY = frame.height * 0.64 + Math.sin(time * Math.PI * 6) * frame.size * D.bob;
  return {
    ...base,
    raftX,
    raftY,
    raftRoll: Math.sin(time * Math.PI * 6) * D.raftRoll,
    catX: raftX - frame.raftSize * 0.15,
    catY: raftY,
    shadowY: raftY,
    catScaleX: 1 + Math.sin(time * Math.PI * 8) * 0.015,
    catScaleY: 1 - Math.sin(time * Math.PI * 8) * 0.015,
  };
}

export function pelicanPose(frame: ReturnType<typeof harborFrame>, time: number) {
  const boat = harborScenePose(frame, time, 'pelican-mail');
  const seatX = boat.raftX + frame.raftSize * 0.18;
  const seatY = boat.raftY - frame.raftSize * 0.09;
  const incoming = smooth(time / 0.3);
  const leaving = smooth((time - 0.74) / 0.26);
  const birdX =
    time < 0.3 ? mix(frame.width * 1.2, seatX, incoming) : mix(seatX, frame.width * 1.25, leaving);
  const birdY =
    time < 0.3
      ? mix(seatY - frame.size * 0.9, seatY, incoming) -
        Math.sin(incoming * Math.PI) * frame.size * 0.12
      : seatY - leaving * frame.size * 1.3;
  const rest = smooth((time - 0.28) / 0.06) * (1 - smooth((time - 0.71) / 0.06));
  const drop = smooth((time - 0.43) / 0.16);
  const heldX = birdX - frame.size * 0.11;
  const heldY = birdY - frame.size * 0.18;
  const placed = smooth((time - 0.575) / 0.015);
  const settle =
    time > 0.59 && time < 0.73
      ? Math.sin(((time - 0.59) / 0.14) * Math.PI * 2) * Math.exp(-(time - 0.59) * 30)
      : 0;
  return {
    birdX,
    birdY,
    birdRest: rest,
    birdFlying: 1 - rest,
    wingUp: Math.sin(time * Math.PI * 28) >= 0 ? 1 : 0,
    wingDown: Math.sin(time * Math.PI * 28) >= 0 ? 0 : 1,
    facing: time < 0.74 ? -1 : 1,
    birdTilt: time < 0.3 ? mix(-12, 0, incoming) : mix(0, -18, leaving),
    bookX:
      time < 0.59
        ? mix(heldX, boat.raftX + frame.raftSize * 0.18, drop)
        : boat.raftX + frame.raftSize * 0.18,
    bookY:
      time < 0.59
        ? mix(heldY, boat.raftY + frame.raftSize * 0.04, drop) -
          Math.sin(drop * Math.PI) * frame.size * 0.06
        : boat.raftY + frame.raftSize * 0.04 - frame.size * 0.01 * settle,
    bookTilt: mix(-12, D.pelican.bookLandingTilt, drop),
    bookSkew: mix(0, D.pelican.bookLandingSkew, drop),
    bookScaleX: mix(1, D.pelican.bookLandingScaleX, drop),
    bookScaleY: mix(1, D.pelican.bookLandingScaleY, drop),
    bookHeld: 1 - placed,
    bookPlaced: placed,
    bookDeckTilt: settle * 1.5,
  };
}

/** 출항은 부두 → 탑승 클로즈업 → 먼바다, 도착은 넓은 바다 → 접안 클로즈업으로 잇는다. */
export function harborCamera(
  frame: ReturnType<typeof harborFrame>,
  time: number,
  direction: HarborDirection,
) {
  const progress = clamp(time);
  const shot = D.camera[direction];
  let segment = 0;
  while (segment < shot.times.length - 2 && progress > shot.times[segment + 1]) segment++;
  const fraction = smooth(
    (progress - shot.times[segment]) / (shot.times[segment + 1] - shot.times[segment]),
  );
  const zoom = mix(shot.zooms[segment], shot.zooms[segment + 1], fraction);
  const pose = harborScenePose(frame, progress, direction);
  const close = smooth((zoom - D.camera.wideZoom) / (D.camera.maxZoom - D.camera.wideZoom));
  // 넓은 숏은 섬과 배 사이를, 가까운 숏은 고양이 머리와 발 사이를 바라본다.
  const wideX = mix(pose.harborX + pose.harborSize * 0.58, pose.raftX, 0.45);
  const wideY = mix(pose.harborY + pose.harborSize * 0.43, pose.raftY, 0.45);
  const focusX = mix(wideX, pose.catX, close);
  const focusY = mix(wideY, pose.catY - frame.catSize * 0.5, close);
  const targetY = frame.height * mix(D.camera.wideTargetY, D.camera.closeTargetY, close);
  const seaScene = direction === 'abandon' || direction === 'pelican-mail';
  const followY = seaScene
    ? frame.height * (direction === 'abandon' ? D.abandon.targetY : D.pelican.targetY) -
      frame.height / 2 -
      (pose.raftY - frame.catSize * 0.3 - frame.height / 2) * zoom
    : targetY - frame.height / 2 - (focusY - frame.height / 2) * zoom;
  // 내륙 쪽 윗변은 항상 화면 밖이다. 원경에서도 둥근 섬 전체가 드러나지 않게 한다.
  const inlandTop = pose.harborY + pose.harborSize * D.camera.islandTopY;
  const coastLimitY =
    -frame.height * D.camera.coastCropTop -
    frame.height / 2 -
    (inlandTop - frame.height / 2) * zoom;
  const actorLimitY =
    frame.height * D.camera.actorMaxY - frame.height / 2 - (pose.catY - frame.height / 2) * zoom;
  // 접안 위치를 옮겨도 뗏목이 화면 옆으로 잘리지 않게 한다(회전 여유 포함).
  const raftLeft = pose.raftX - frame.raftSize * (D.raftAnchorX + 0.01);
  const raftRight = pose.raftX + frame.raftSize * (1 - D.raftAnchorX + 0.01);
  const minX =
    frame.width * D.camera.subjectInsetX - frame.width / 2 - (raftLeft - frame.width / 2) * zoom;
  const maxX =
    frame.width * (1 - D.camera.subjectInsetX) -
    frame.width / 2 -
    (raftRight - frame.width / 2) * zoom;
  const followX = -((seaScene ? pose.raftX : focusX) - frame.width / 2) * zoom;
  return {
    zoom,
    x: Math.max(minX, Math.min(maxX, followX)),
    y: seaScene ? Math.min(followY, actorLimitY) : Math.min(followY, coastLimitY, actorLimitY),
  };
}

/** 카메라가 보는 모든 바다 영역을 역산한다. 축소·패닝 중에도 화면 가장자리가 비지 않는다. */
export function harborOceanBounds(
  frame: ReturnType<typeof harborFrame>,
  direction: HarborDirection,
) {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const time of HARBOR_STEPS) {
    const camera = harborCamera(frame, time, direction);
    bounds.left = Math.min(
      bounds.left,
      frame.width / 2 + (-frame.width / 2 - camera.x) / camera.zoom,
    );
    bounds.top = Math.min(
      bounds.top,
      frame.height / 2 + (-frame.height / 2 - camera.y) / camera.zoom,
    );
    bounds.right = Math.max(
      bounds.right,
      frame.width / 2 + (frame.width / 2 - camera.x) / camera.zoom,
    );
    bounds.bottom = Math.max(
      bounds.bottom,
      frame.height / 2 + (frame.height / 2 - camera.y) / camera.zoom,
    );
  }
  return bounds;
}
