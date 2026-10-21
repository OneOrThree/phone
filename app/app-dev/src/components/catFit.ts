import type { Box, CatFit, CatFitView } from '@/services/customizationCatalog';

/**
 * cat-fit-v1 합성 계산(GROMO-2382) — server/static/customization/reference/fitting.*.js 의 neck·drawCat 을 옮긴 것.
 * 신발은 보상에서 빠져 옮기지 않았다.
 * 그리기는 하지 않고 512² 좌표의 그리기 명령만 만든다(Skia 기록은 CatOutfitLayers).
 */

/** [x, y, w, h]. */
export type Rect = readonly [number, number, number, number];
/** 원본 src 영역을 dst 에 그린다. at 이 있으면 (x, y) 로 옮기고 deg 만큼 돌린 좌표계의 dst 다. */
export type FitOp = {
  img: 'item' | 'band';
  src: Rect;
  dst: Rect;
  at?: { x: number; y: number; deg: number };
};
type Point = readonly [number, number];
/** 목 rig 한 프레임 — paths 의 점은 [x, 윗변 y, 아랫변 y]. 프로필 그림만 view 가 있다. */
export type NeckFrame = {
  paths: (readonly [number, number, number])[][];
  anchor: Point;
  angle: number;
  occluders: Point[][];
  view?: CatFitView;
};
/** 고양이 그림 한 장 — 애니메이션 프레임(motion·frame) 또는 정지 그림(still: idle·loaf·avatar). */
export type FitPose = { color: string; motion?: string; frame?: number; still?: string };

/**
 * 검증된 털색·자세·프레임이면 'walk-3'·'still/loaf' 같은 프레임 id, 아니면 null(그리지 않는다).
 * 자료에 없는 자세(던지기·기지개·하품·그루밍·갸웃 등)에 다른 자세 좌표를 빌려 쓰지 않는다(README 규칙).
 */
export function catFitFrameId(fit: CatFit, pose: FitPose): string | null {
  if (!fit.colors.includes(pose.color)) return null;
  // 독서(read)는 책이 목을 가린다 — 목은 그리지 않는다(README 「6색 자세 자료」, rig 에도 read 프레임이 없다)
  if (fit.neck && pose.motion === 'read') return null;
  if (pose.still) return fit.stills.includes(pose.still) ? `still/${pose.still}` : null;
  const count = pose.motion ? fit.motions[pose.motion] : undefined;
  const frame = pose.frame ?? 0;
  return count && Number.isInteger(frame) && frame >= 0 && frame < count
    ? `${pose.motion}-${frame}`
    : null;
}

/** 썸네일·결과창에 보여 줄 원본 영역 — 목은 앞 장식, 머리는 알파 크롭(합본 preview 와 같다). */
export const catFitArtBox = (fit: CatFit): Box => (fit.neck ? fit.neck.front : fit.crop);

/**
 * 머리: 접촉점 + itemDepthY 에 크롭 아래 가운데를 맞추고 각도만큼 돌린다. 그림자는 같은 점의 납작한 타원.
 * view 가 있으면(프로필) 그 변환을 먼저 건 좌표계에서 그린다.
 */
export function headLayer(fit: CatFit, color: string, frameId: string) {
  const head = fit.head;
  const contact = head?.contacts[color]?.[frameId];
  if (!head || !contact) return null;
  const [l, t, r, b] = fit.crop;
  const w = head.drawWidth;
  const h = (w * (b - t)) / (r - l);
  const at = { x: contact.x, y: contact.y + head.depthY, deg: contact.angleDegrees };
  return {
    shadow: { ...at, rx: w * head.shadow.widthFactor, ry: head.shadow.height },
    op: { img: 'item', src: [l, t, r - l, b - t], dst: [-w / 2, -h, w, h], at } as FitOp,
    view: contact.view,
  };
}

/** 목 곡선에서 x 의 [윗변, 아랫변] — 구간 밖이면 가장 가까운 점. */
function sample(paths: NeckFrame['paths'], x: number): [number, number] {
  const points = paths.flat();
  let best = points[0];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (x >= a[0] && x <= b[0]) {
      // 같은 x 두 점이면 앞 점 값(fitrender.py 와 같다)
      const d = b[0] - a[0];
      const u = d ? (x - a[0]) / d : 0;
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    if (Math.abs(points[i][0] - x) < Math.abs(best[0] - x)) best = points[i];
  }
  return [best[1], best[2]];
}

/** 감는 띠 — 원본 띠를 0.5px 열로 잘라 목 곡선의 윗변~아랫변에 늘여 붙인다. */
function bandOps(img: FitOp['img'], [l, t, r, b]: Box, paths: NeckFrame['paths']): FitOp[] {
  const ops: FitOp[] = [];
  for (const path of paths) {
    const start = path[0][0],
      end = path[path.length - 1][0];
    for (let x = start; x < end; x += 0.5) {
      const [top, bottom] = sample([path], x);
      const sx = l + ((x - start) / (end - start)) * (r - l - 1);
      ops.push({
        img,
        src: [sx, t, Math.max(1, ((r - l) / (end - start)) * 0.65), b - t],
        dst: [x, top, 0.65, bottom - top],
      });
    }
  }
  return ops;
}

/** 목: 그리기 순서(스카프는 앞 장식 → 띠, 리본·펜던트는 띠 → 장식)와 지울 영역(턱선 위·앞발 가림). */
export function neckLayer(fit: CatFit, p: NeckFrame): { ops: FitOp[]; erase: Point[][] } | null {
  const neck = fit.neck;
  if (!neck || !p.paths.length) return null;
  const [l, t, r, b] = neck.front;
  const all = p.paths.flat();
  const front: FitOp[] = [];
  if (neck.style === 'scarf') {
    const left = Math.min(...all.map((a) => a[0])),
      right = Math.max(...all.map((a) => a[0])),
      w = Math.min(86, (right - left) * 0.83),
      cx = Math.max(left + w / 2, Math.min(right - w / 2, p.anchor[0] - 10)),
      h = Math.min(48, (w * (b - t)) / (r - l));
    for (let x = 0; x < w; x += 0.5) {
      const px = cx - w / 2 + x,
        [top, bottom] = sample(p.paths, px),
        sx = l + (x / w) * (r - l),
        sy = neck.columns?.[Math.min(r - l - 1, Math.floor(sx - l))];
      if (sy == null) continue;
      front.push({
        img: 'item',
        src: [sx, sy, Math.max(1, ((r - l) / w) * 0.65), b - sy],
        dst: [px, (top + bottom) / 2 - 1, 0.65, (h * (b - sy)) / (b - t)],
      });
    }
  } else {
    const w = neck.style === 'bow' ? 54 : 29,
      h = (w * (b - t)) / (r - l);
    front.push({
      img: 'item',
      src: [l, t, r - l, b - t],
      dst: [-w / 2, -h * (neck.style === 'bow' ? 0.42 : 0.14), w, h],
      at: { x: p.anchor[0], y: p.anchor[1], deg: p.angle },
    });
  }
  const band = neck.band
    ? bandOps('item', neck.band, p.paths)
    : bandOps('band', neck.commonBand.box, p.paths);
  // 턱선 위는 털이 덮는다 — 곡선의 윗변-1 부터 캔버스 위끝까지 지운다
  const jaw: Point[] = [
    [all[0][0], 0],
    ...all.map(([x, top]) => [x, top - 1] as Point),
    [all[all.length - 1][0], 0],
  ];
  return {
    ops: neck.style === 'scarf' ? [...front, ...band] : [...band, ...front],
    erase: [jaw, ...p.occluders],
  };
}

/** rig JSON 에서 그 프레임 — 모양이 틀리면 null(그리지 않는다). */
export function neckRigFrame(rig: unknown, frameId: string): NeckFrame | null {
  const frame = (rig as { frames?: Record<string, NeckFrame> } | null)?.frames?.[frameId];
  return frame &&
    Array.isArray(frame.paths) &&
    frame.paths.length > 0 &&
    Array.isArray(frame.occluders) &&
    frame.anchor
    ? frame
    : null;
}
