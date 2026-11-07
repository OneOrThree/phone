// 낚시섬 물가 30석의 수치 검증. 실제 Cat.tsx와 같은 자세 함수(catPose.ts)로 30마리를 앉혀
// 찌·낚싯대·줄·몸통의 월드 좌표를 계산한다. GPU 없이 node에서 돈다.
//   npx tsx src/assets3d/preview/verify-fishing.ts [출력.json]
import { writeFileSync } from "node:fs";
import { Box3, Group, Vector3 } from "three";
import { FOCUS_POND, FOCUS_SEATS } from "../../layout";
import { BONE, createCatRig, ROD_TIP_LOCAL } from "../catModel";
import { placeFloat, poseBones } from "../catPose";
import { CHAIR } from "../chair";
import { focusHeight } from "../focusTerrain";
import { GROUND_Y, POND_LEVEL, SEAT_HEIGHT } from "../palette";
import { POND, POND_DECOR } from "../pond";

type Sample = {
  seat: number;
  floor: number;
  facingCos: number;
  float: [number, number, number];
  floatRadius: number;
  floatDepth: number;
  rodTip: [number, number, number];
  bodyBottom: number;
  lowestVertex: number;
  lineClearance: number;
  tailInChair: number;
};
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const v3 = (v: Vector3) =>
  [round(v.x), round(v.y), round(v.z)] as [number, number, number];

const pose = {
  phase: 0,
  walk: 0,
  sit: 0,
  wave: 0,
  fish: 0,
  focus: 1,
};
const rig = createCatRig("cream", false);
const group = new Group();
group.add(rig.mesh);
const vertex = new Vector3(),
  tip = new Vector3(),
  floatAt = new Vector3(),
  paw = new Vector3();
const skin = rig.mesh.geometry.getAttribute("skinIndex");
const weight = rig.mesh.geometry.getAttribute("skinWeight");
const count = rig.mesh.geometry.getAttribute("position").count;
// 낚시 소품(낚싯대·찌·물결 고리·물고기)에만 묶인 정점은 몸통 검사에서 뺀다.
const PROPS: number[] = [
  BONE.rod,
  BONE.float,
  BONE.ripple,
  BONE.fish,
  BONE.fishTail,
];
const isProp = (i: number) =>
  [0, 1, 2, 3].every((k) => {
    const w = weight.getComponent(i, k);
    const b = skin.getComponent(i, k);
    return w === 0 || PROPS.includes(b);
  });
const isTail = (i: number) =>
  [0, 1, 2, 3].some(
    (k) =>
      weight.getComponent(i, k) > 0.3 &&
      [BONE.tail1, BONE.tail2, BONE.tail3].includes(
        skin.getComponent(i, k) as 12,
      ),
  );
// 의자 기준 좌표의 좌판·쿠션, 뒤로 기운 등받이, 네 다리 부피(chair.ts 치수)
const insideChair = (v: Vector3) => {
  const seat =
    Math.abs(v.x) < 0.41 && Math.abs(v.z) < 0.36 && v.y > 0.3 && v.y < 0.47;
  const lean = (v.y - 0.4) * -0.12;
  const back =
    Math.abs(v.x) < 0.37 &&
    v.z < -0.275 + lean &&
    v.z > -0.37 + lean &&
    v.y > 0.35 &&
    v.y < 1.05;
  const legs =
    Math.abs(Math.abs(v.x) - 0.31) < 0.07 &&
    Math.abs(Math.abs(v.z) - 0.25) < 0.07 &&
    v.y < 0.45;
  return seat || back || legs;
};
const torso = (i: number) =>
  [0, 1, 2, 3].some(
    (k) =>
      weight.getComponent(i, k) > 0.5 &&
      (skin.getComponent(i, k) === BONE.hips ||
        skin.getComponent(i, k) === BONE.chest),
  );

const samples: Sample[] = [];
const bodies: Box3[] = [];
const rods: [Vector3, Vector3][] = [];
const lines: [Vector3, Vector3][] = [];
for (const seat of FOCUS_SEATS) {
  group.position.set(seat.x, GROUND_Y, seat.z);
  group.rotation.set(0, seat.yaw, 0);
  group.updateMatrixWorld(true);
  poseBones(rig.bones, pose, 0, 0, 0);
  placeFloat(rig.bones, pose, 0, 0);
  group.updateMatrixWorld(true);
  rig.mesh.skeleton.update();
  const rod = rig.bones[BONE.rod],
    float = rig.bones[BONE.float];
  tip.copy(ROD_TIP_LOCAL).applyMatrix4(rod.matrixWorld);
  paw.setFromMatrixPosition(rod.matrixWorld);
  floatAt.setFromMatrixPosition(float.matrixWorld);
  const box = new Box3();
  let bodyBottom = Infinity,
    lowest = Infinity,
    tailInChair = 0;
  const local = new Vector3();
  for (let i = 0; i < count; i++) {
    if (isProp(i)) continue;
    rig.mesh.getVertexPosition(i, vertex);
    if (isTail(i)) {
      // 고양이 루트와 의자는 같은 위치·방향이라 메시 로컬이 곧 의자 로컬이다(높이만 GROUND_Y 차이 없음).
      local.copy(vertex);
      if (insideChair(local)) tailInChair++;
    }
    vertex.applyMatrix4(rig.mesh.matrixWorld);
    box.expandByPoint(vertex);
    lowest = Math.min(lowest, vertex.y);
    if (torso(i)) bodyBottom = Math.min(bodyBottom, vertex.y);
  }
  // 줄이 물가 비탈·땅에 닿지 않는지: 줄을 100등분해 지형 높이와 비교
  let lineClearance = Infinity;
  for (let k = 0; k <= 100; k++) {
    const p = tip.clone().lerp(floatAt, k / 100);
    if (k === 100) break;
    lineClearance = Math.min(lineClearance, p.y - focusHeight(p.x, p.z));
  }
  const forward = new Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
  const toPond = new Vector3(
    FOCUS_POND.x - seat.x,
    0,
    FOCUS_POND.z - seat.z,
  ).normalize();
  samples.push({
    seat: seat.id,
    floor: round(focusHeight(seat.x, seat.z)),
    facingCos: round(forward.dot(toPond), 6),
    float: v3(floatAt),
    floatRadius: round(
      Math.hypot(floatAt.x - FOCUS_POND.x, floatAt.z - FOCUS_POND.z),
    ),
    floatDepth: round(POND_LEVEL - floatAt.y),
    rodTip: v3(tip),
    bodyBottom: round(bodyBottom),
    lowestVertex: round(lowest),
    lineClearance: round(lineClearance),
    tailInChair,
  });
  bodies.push(box);
  rods.push([paw.clone(), tip.clone()]);
  lines.push([tip.clone(), floatAt.clone()]);
}

// 두 선분 사이 최소 거리(표본)
function segmentGap(a: [Vector3, Vector3], b: [Vector3, Vector3]) {
  let best = Infinity;
  const p = new Vector3(),
    q = new Vector3();
  for (let i = 0; i <= 40; i++) {
    p.lerpVectors(a[0], a[1], i / 40);
    for (let j = 0; j <= 40; j++) {
      q.lerpVectors(b[0], b[1], j / 40);
      best = Math.min(best, p.distanceTo(q));
    }
  }
  return best;
}
const n = FOCUS_SEATS.length;
const neighbours = Array.from({ length: n }, (_, i) => {
  const j = (i + 1) % n;
  return {
    pair: [i, j],
    bodyOverlap: bodies[i].intersectsBox(bodies[j]),
    bodyGap: round(
      Math.max(
        0,
        Math.hypot(
          Math.max(
            bodies[i].min.x - bodies[j].max.x,
            bodies[j].min.x - bodies[i].max.x,
            0,
          ),
          Math.max(
            bodies[i].min.z - bodies[j].max.z,
            bodies[j].min.z - bodies[i].max.z,
            0,
          ),
        ),
      ),
    ),
    rodGap: round(segmentGap(rods[i], rods[j])),
    lineGap: round(segmentGap(lines[i], lines[j])),
    floatGap: round(lines[i][1].distanceTo(lines[j][1])),
  };
});
// 수련잎·갈대와 찌·줄의 거리
const lilyGap = Math.min(
  ...lines.flatMap(([, f]) =>
    POND_DECOR.lilies.map((l) => Math.hypot(l.x - f.x, l.z - f.z) - l.s * 1.0),
  ),
);
const reedGap = Math.min(
  ...lines.flatMap(([a, b]) =>
    POND_DECOR.reeds
      .filter((r) => Math.hypot(r.x, r.z) > 3)
      .map((r) => {
        // 갈대 높이(약 1.3×s) 아래를 지나는 줄 부분만 본다
        let best = Infinity;
        for (let k = 0; k <= 50; k++) {
          const p = a.clone().lerp(b, k / 50);
          if (p.y > GROUND_Y + 1.35 * r.s) continue;
          best = Math.min(best, Math.hypot(p.x - r.x, p.z - r.z));
        }
        return best;
      }),
  ),
);
const summary = {
  seats: n,
  pond: { radius: POND.radius, bank: POND.bank, level: POND_LEVEL },
  seatFloor: {
    min: Math.min(...samples.map((s) => s.floor)),
    max: Math.max(...samples.map((s) => s.floor)),
  },
  facingCosMin: Math.min(...samples.map((s) => s.facingCos)),
  floatRadius: {
    min: Math.min(...samples.map((s) => s.floatRadius)),
    max: Math.max(...samples.map((s) => s.floatRadius)),
    insideMarginMin: round(
      POND.radius - Math.max(...samples.map((s) => s.floatRadius)),
    ),
  },
  floatDepthMax: Math.max(...samples.map((s) => Math.abs(s.floatDepth))),
  cushionTop: round(GROUND_Y + SEAT_HEIGHT),
  chairBoardTop: round(GROUND_Y + CHAIR.boardTop),
  bodyBottom: {
    min: Math.min(...samples.map((s) => s.bodyBottom)),
    max: Math.max(...samples.map((s) => s.bodyBottom)),
  },
  lowestVertexMin: Math.min(...samples.map((s) => s.lowestVertex)),
  lineClearanceMin: Math.min(...samples.map((s) => s.lineClearance)),
  tailVerticesInChair: Math.max(...samples.map((s) => s.tailInChair)),
  neighbour: {
    bodyOverlap: neighbours.filter((x) => x.bodyOverlap).length,
    bodyGapMin: Math.min(...neighbours.map((x) => x.bodyGap)),
    rodGapMin: Math.min(...neighbours.map((x) => x.rodGap)),
    lineGapMin: Math.min(...neighbours.map((x) => x.lineGap)),
    floatGapMin: Math.min(...neighbours.map((x) => x.floatGap)),
  },
  lilyToFloatMin: round(lilyGap),
  reedToLowLineMin: round(reedGap),
};
const out = process.argv[2];
const report = { summary, samples, neighbours };
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(
  samples
    .slice(0, 4)
    .map((s) => JSON.stringify(s))
    .join("\n"),
);
