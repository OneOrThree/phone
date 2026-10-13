import { componentTokens } from '@/design-system/tokens';

/**
 * 고양이 잡지 홍보 칸 레이아웃(GROMO-2289) — 화면 없는 순수 함수만 둔다.
 *
 * 좌표계: 칸 왼쪽 위 (0, 0) · 오른쪽 아래 (1, 1). x·y 는 스티커 **가운데 점**, scale = 스티커 너비 ÷ 칸 너비,
 * rotation = 도(-180~180). 픽셀 대신 칸에 대한 비율이라 쓰기 화면(크게)·잡지(중간)·망원경 말풍선(작게)에서
 * 같은 숫자로 같은 모양이 나온다. 칸 높이 = 너비 × CELL_ASPECT(고정).
 * 겹침 순서는 배열 순서다 — 뒤쪽이 위에 그려진다. 「맨 앞으로」 = 배열 끝으로 옮기기.
 * 범위는 서버 검증(구현계획 2-3절)과 같다. 서버가 최종 판정이고 앱은 보내기 전에 같은 규칙으로 미리 막는다.
 */
export type StickerPlacement = {
  assetId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};
export type TapePlacement = { assetId: string; x: number; y: number; rotation: number };
export type PromotionLayout = {
  v: 1;
  frameId: string;
  stickers: StickerPlacement[];
  tape: TapePlacement | null;
};

export const CELL_ASPECT = componentTokens.magazineCell.aspect;
export const MAX_STICKERS = 10;
export const BODY_MAX = 60;
/** 칸 둘레 8% 까지 걸치기를 허용한다. */
export const POS_MIN = -0.08;
export const POS_MAX = 1.08;
export const SCALE_MIN = 0.06;
export const SCALE_MAX = 0.6;
/** 테이프는 가운데 점이 칸 가장자리에서 이 비율 안쪽 띠 위에 있어야 한다. */
export const EDGE_BAND = 0.08;
/** 서랍에서 고른 스티커가 처음 붙는 자리·크기. */
export const NEW_STICKER = { x: 0.5, y: 0.5, scale: 0.2, rotation: 0 } as const;
/** 새 테이프는 위 테두리 가운데에 살짝 기울여 붙는다(시안 노란 모눈 메모). */
export const NEW_TAPE = { x: 0.5, y: EDGE_BAND / 2, rotation: -4 } as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
// 제스처 계산이 0 으로 나눠 NaN·Infinity 가 들어와도 JSON 에 null 이 실리지 않게 기본값으로 바꾼다
const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);
// 저장 JSON 을 짧고 안정적으로 — 360pt 칸에서 0.001 = 0.36pt 라 눈에 띄지 않는다
const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0; // + 0: -0 을 0 으로
export function normalizeRotation(deg: number) {
  if (!Number.isFinite(deg)) return 0;
  const r = ((((deg + 180) % 360) + 360) % 360) - 180;
  return round3(r === -180 ? 180 : r);
}
const clampPos = (n: number) => round3(clamp(finite(n, 0.5), POS_MIN, POS_MAX));

export function emptyLayout(frameId: string): PromotionLayout {
  return { v: 1, frameId, stickers: [], tape: null };
}

export function clampSticker(s: StickerPlacement): StickerPlacement {
  return {
    assetId: s.assetId,
    x: clampPos(s.x),
    y: clampPos(s.y),
    scale: round3(clamp(finite(s.scale, NEW_STICKER.scale), SCALE_MIN, SCALE_MAX)),
    rotation: normalizeRotation(s.rotation),
  };
}

/** 10개가 차 있으면 null — 화면이 「스티커는 10개까지」 안내를 띄운다. 같은 스티커 여러 장은 허용(P11). */
export function addSticker(layout: PromotionLayout, assetId: string): PromotionLayout | null {
  if (layout.stickers.length >= MAX_STICKERS) return null;
  return { ...layout, stickers: [...layout.stickers, { assetId, ...NEW_STICKER }] };
}

/** 옮기기·키우기·돌리기 공용. 범위 밖 값은 잘라서 넣는다. */
export function updateSticker(
  layout: PromotionLayout,
  index: number,
  patch: Partial<Omit<StickerPlacement, 'assetId'>>,
): PromotionLayout {
  const cur = layout.stickers[index];
  if (!cur) return layout;
  const stickers = layout.stickers.slice();
  stickers[index] = clampSticker({ ...cur, ...patch });
  return { ...layout, stickers };
}

export function removeSticker(layout: PromotionLayout, index: number): PromotionLayout {
  if (!layout.stickers[index]) return layout;
  return { ...layout, stickers: layout.stickers.filter((_, i) => i !== index) };
}

export function bringToFront(layout: PromotionLayout, index: number): PromotionLayout {
  const cur = layout.stickers[index];
  if (!cur) return layout;
  return { ...layout, stickers: [...layout.stickers.filter((_, i) => i !== index), cur] };
}

/**
 * 가운데 점을 가장 가까운 테두리 띠로 붙인다. 이미 띠 위면 그대로 둔다.
 * 띠 밖이면 가장 가까운 변 쪽 좌표만 그 변의 띠 가운데(4%)로 옮긴다.
 */
export function snapTapeToEdge(x: number, y: number): { x: number; y: number } {
  const cx = clampPos(x);
  const cy = clampPos(y);
  const half = EDGE_BAND / 2;
  const dists = [
    { d: cx, x: half, y: cy },
    { d: 1 - cx, x: 1 - half, y: cy },
    { d: cy, x: cx, y: half },
    { d: 1 - cy, x: cx, y: 1 - half },
  ];
  if (dists.some((e) => e.d <= EDGE_BAND)) return { x: cx, y: cy };
  const near = dists.reduce((a, b) => (b.d < a.d ? b : a));
  return { x: round3(near.x), y: round3(near.y) };
}

/** 테이프는 1개 — 다른 테이프를 고르면 같은 자리에서 바꿔 끼운다. null = 떼기. */
export function setTape(layout: PromotionLayout, assetId: string | null): PromotionLayout {
  if (!assetId) return { ...layout, tape: null };
  const at = layout.tape ?? NEW_TAPE;
  return { ...layout, tape: { assetId, x: at.x, y: at.y, rotation: at.rotation } };
}

export function moveTape(
  layout: PromotionLayout,
  x: number,
  y: number,
  rotation?: number,
): PromotionLayout {
  if (!layout.tape) return layout;
  const at = snapTapeToEdge(x, y);
  return {
    ...layout,
    tape: {
      ...layout.tape,
      ...at,
      rotation: normalizeRotation(rotation ?? layout.tape.rotation),
    },
  };
}

/** 칸 너비 width(px) 에서 스티커 하나가 놓일 상자. aspect = 그림 너비 ÷ 높이. 회전은 가운데 기준. */
export function stickerRect(
  s: { x: number; y: number; scale: number },
  aspect: number,
  width: number,
) {
  const w = s.scale * width;
  const h = w / aspect;
  const height = width * CELL_ASPECT;
  return { left: s.x * width - w / 2, top: s.y * height - h / 2, width: w, height: h };
}

/** 화면 위 가운데 점(px) → 칸 비율 좌표. 손을 뗄 때 한 번 부른다. */
export function toNormalized(cx: number, cy: number, width: number) {
  return { x: cx / width, y: cy / (width * CELL_ASPECT) };
}

/**
 * 보내기 전 검사 — 문제가 있으면 서버 오류의 field 와 같은 모양의 위치(`layout.stickers[10]`)를, 없으면 null.
 * knownIds 를 주면 이 앱이 모르는 재료도 걸러낸다(서버는 보유 여부까지 본다).
 */
export function layoutProblem(
  layout: PromotionLayout,
  knownIds?: (kind: 'frame' | 'sticker' | 'tape', id: string) => boolean,
): string | null {
  if (layout.v !== 1) return 'layout.v';
  if (!layout.frameId || (knownIds && !knownIds('frame', layout.frameId))) return 'layout.frameId';
  if (layout.stickers.length > MAX_STICKERS) return `layout.stickers[${MAX_STICKERS}]`;
  // NaN 은 어떤 비교도 거짓이라 「범위 안」을 참으로 묻는다
  const inPos = (n: number) => n >= POS_MIN && n <= POS_MAX;
  const inRotation = (n: number) => n >= -180 && n <= 180;
  const bad = layout.stickers.findIndex(
    (s) =>
      !s.assetId ||
      !inPos(s.x) ||
      !inPos(s.y) ||
      !(s.scale >= SCALE_MIN && s.scale <= SCALE_MAX) ||
      !inRotation(s.rotation) ||
      (knownIds != null && !knownIds('sticker', s.assetId)),
  );
  if (bad >= 0) return `layout.stickers[${bad}]`;
  const t = layout.tape;
  if (t) {
    const onBand =
      t.x <= EDGE_BAND || t.x >= 1 - EDGE_BAND || t.y <= EDGE_BAND || t.y >= 1 - EDGE_BAND;
    if (
      !t.assetId ||
      !onBand ||
      !inPos(t.x) ||
      !inPos(t.y) ||
      !inRotation(t.rotation) ||
      (knownIds && !knownIds('tape', t.assetId))
    )
      return 'layout.tape';
  }
  return null;
}

// 고운돋움 한글 한 글자 폭 ≈ 0.92em(글꼴 파일 실측: 가·같 = 91/100). 띄어쓰기 단위 줄바꿈으로 줄 끝이 비는 몫을
// WRAP_SLACK 으로 더 잡는다(시뮬레이터 실측: 띄어쓰기 없는 한글 60자는 추정과 같은 줄 수, 띄어 쓴 글은 그보다 적다).
// 이모지(≈1.2em)처럼 더 넓은 글자는 AdCell 의 adjustsFontSizeToFit 가 마지막으로 줄인다.
const HANGUL_EM = 0.92;
const WRAP_SLACK = 1.05;
const MIN_SCALE = 0.6;

/**
 * 틀의 글 상자(inset)에 60자 글이 넘치지 않게 들어가는 글자 배율.
 * - scale: 섬 프로필·이름·주민 줄 배율. bodyScale: 한 줄 글 배율(줄 수 상한이 있는 틀만 scale 보다 작다).
 * - maxBodyLines: 틀 그림에 인쇄된 장식(고양이 귀 틀 아래쪽 하트)을 피하려고 글 줄 수를 묶는 틀만 준다.
 * 배율은 칸 너비에 비례하는 기준 크기(componentTokens.magazineCell)에 곱한다 — 모든 치수가 너비에 비례하므로
 * 틀마다 한 번 정해지는 값이고 칸 너비와 무관하다. 프로필·이름 줄 + 한 줄 글 + 주민/평균 줄이 상자 높이 안에 든다.
 */
export function cellTextFit(frame: {
  inset: readonly [number, number, number, number];
  maxBodyLines?: number;
}): { scale: number; bodyScale: number; bodyLines: number } {
  const m = componentTokens.magazineCell;
  const [l, t, r, b] = frame.inset;
  const boxW = (1 - l - r) * m.referenceWidth;
  const boxH = (1 - t - b) * m.referenceWidth * m.aspect;
  // 글자 크기 size 로 60자가 차지하는 줄 수
  const linesAt = (size: number) =>
    Math.max(1, Math.ceil((BODY_MAX * HANGUL_EM * size * WRAP_SLACK) / boxW));
  let result = { scale: MIN_SCALE, bodyScale: MIN_SCALE, bodyLines: 1 };
  for (let s = 1; s >= MIN_SCALE - 1e-9; s -= 0.02) {
    let body = m.bodySize * s;
    let lines = linesAt(body);
    if (frame.maxBodyLines && lines > frame.maxBodyLines) {
      lines = frame.maxBodyLines;
      body = Math.min(body, (boxW * lines) / (BODY_MAX * HANGUL_EM * WRAP_SLACK));
    }
    const need =
      m.profileDiameter * s +
      m.gap * s * 2 +
      lines * body * m.lineHeight +
      m.metaSize * s * m.lineHeight;
    // 글 배율은 내림 — 반올림으로 0.01 커지면 줄이 하나 넘칠 수 있다
    result = {
      scale: Math.round(s * 100) / 100,
      bodyScale: Math.floor((body / m.bodySize) * 100) / 100,
      bodyLines: lines,
    };
    if (need <= boxH) return result;
  }
  return result;
}
