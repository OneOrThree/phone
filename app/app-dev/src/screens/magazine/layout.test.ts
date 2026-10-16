// 잡지 칸 레이아웃 순수 함수(GROMO-2289) — 비율 좌표 ↔ 픽셀 왕복, 범위 자르기, 5개 제한, 테이프 교체·테두리 붙이기,
// 맨 앞으로, 꾸미기 순서 뒤 저장 JSON, 보내기 전 검사, 틀마다 60자 글이 들어가는 글자 배율.
import { componentTokens } from '@/design-system/tokens';
import { MAGAZINE_FRAMES } from '@/constants/magazineAssets';
import {
  CELL_ASPECT,
  MAX_STICKERS,
  PromotionLayout,
  SCALE_MIN as SCALE_MIN_FOR_TEST,
  addSticker,
  applyEdit,
  bringToFront,
  cellTextFit,
  clampSticker,
  emptyLayout,
  layoutProblem,
  moveTape,
  normalizeRotation,
  removeSticker,
  setTape,
  snapTapeToEdge,
  stickerRect,
  toNormalized,
  updateSticker,
} from './layout';

const FRAME = 'mag.frame-catear';

describe('비율 좌표 ↔ 픽셀', () => {
  it.each([360, 300, 120])('너비 %ipx 에서 가운데 점이 같은 비율로 돌아온다', (width) => {
    const s = { x: 0.82, y: 0.3, scale: 0.22 };
    const rect = stickerRect(s, 1.1, width);
    expect(rect.width).toBeCloseTo(0.22 * width);
    expect(rect.height).toBeCloseTo((0.22 * width) / 1.1);
    const back = toNormalized(rect.left + rect.width / 2, rect.top + rect.height / 2, width);
    expect(back.x).toBeCloseTo(0.82);
    expect(back.y).toBeCloseTo(0.3);
  });

  it('칸 높이는 너비 × CELL_ASPECT 로 고정이다', () => {
    expect(CELL_ASPECT).toBeCloseTo(199 / 338);
    // 오른쪽 아래 끝(1, 1)에 점만 한 스티커를 두면 칸 오른쪽 아래 모서리에 놓인다
    const r = stickerRect({ x: 1, y: 1, scale: 0 }, 1, 300);
    expect(r.left).toBe(300);
    expect(r.top).toBeCloseTo(300 * CELL_ASPECT);
  });
});

describe('범위 자르기', () => {
  it('위치는 -0.08~1.08, 크기는 0.06~0.6, 회전은 -180~180 으로 자른다', () => {
    expect(clampSticker({ assetId: 'a', x: -1, y: 2, scale: 0.01, rotation: 190 })).toEqual({
      assetId: 'a',
      x: -0.08,
      y: 1.08,
      scale: 0.06,
      rotation: -170,
    });
    expect(clampSticker({ assetId: 'a', x: 0.5, y: 0.5, scale: 9, rotation: -540 }).scale).toBe(
      0.6,
    );
  });

  it('회전은 한 바퀴를 넘으면 감아서 -180 은 180 으로 둔다', () => {
    expect(normalizeRotation(-190)).toBe(170);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(720)).toBe(0);
  });
});

describe('스티커', () => {
  it('6번째 스티커는 붙지 않는다(같은 스티커 여러 장은 된다)', () => {
    let layout = emptyLayout(FRAME);
    for (let i = 0; i < MAX_STICKERS; i++) layout = addSticker(layout, 'mag.heart')!;
    expect(layout.stickers).toHaveLength(5);
    expect(addSticker(layout, 'mag.star')).toBeNull();
  });

  it('[맨 앞으로]는 배열 끝으로 옮긴다', () => {
    let layout = emptyLayout(FRAME);
    for (const id of ['a', 'b', 'c']) layout = addSticker(layout, id)!;
    expect(bringToFront(layout, 0).stickers.map((s) => s.assetId)).toEqual(['b', 'c', 'a']);
    expect(bringToFront(layout, 9)).toBe(layout);
  });

  it('붙이기 → 옮기기 → 키우기 → 돌리기 → 지우기 뒤 저장 JSON 이 서버 요청 모양과 같다', () => {
    let layout = emptyLayout('mag.frame-scallop');
    layout = addSticker(layout, 'mag.cat-black-book')!;
    layout = addSticker(layout, 'mag.fish')!;
    layout = addSticker(layout, 'mag.star')!;
    layout = updateSticker(layout, 0, { x: 0.82, y: 0.3 });
    layout = updateSticker(layout, 0, { scale: 0.22 });
    layout = updateSticker(layout, 0, { rotation: -12 });
    layout = updateSticker(layout, 1, { x: 0.151, y: 0.7804, scale: 0.15, rotation: 368 });
    layout = removeSticker(layout, 2);
    layout = setTape(layout, 'mag.tape-yellowcheck');
    expect(JSON.parse(JSON.stringify(layout))).toEqual({
      v: 1,
      frameId: 'mag.frame-scallop',
      stickers: [
        { assetId: 'mag.cat-black-book', x: 0.82, y: 0.3, scale: 0.22, rotation: -12 },
        { assetId: 'mag.fish', x: 0.151, y: 0.78, scale: 0.15, rotation: 8 },
      ],
      tape: { assetId: 'mag.tape-yellowcheck', x: 0.5, y: 0.04, rotation: -4 },
    });
  });
});

describe('테이프', () => {
  it('하나만 — 다른 테이프를 고르면 같은 자리에서 바꿔 끼우고 null 이면 뗀다', () => {
    let layout = setTape(emptyLayout(FRAME), 'mag.tape-pink');
    layout = moveTape(layout, 0.97, 0.4, 85);
    layout = setTape(layout, 'mag.tape-mint');
    expect(layout.tape).toEqual({ assetId: 'mag.tape-mint', x: 0.97, y: 0.4, rotation: 85 });
    expect(setTape(layout, null).tape).toBeNull();
  });

  it('띠 위면 그대로, 띠 밖이면 가장 가까운 변의 띠 가운데로 붙인다', () => {
    expect(snapTapeToEdge(0.5, 0.05)).toEqual({ x: 0.5, y: 0.05 });
    expect(snapTapeToEdge(0.3, 0.2)).toEqual({ x: 0.3, y: 0.04 });
    expect(snapTapeToEdge(0.7, 0.5)).toEqual({ x: 0.96, y: 0.5 });
    expect(snapTapeToEdge(0.5, 0.8)).toEqual({ x: 0.5, y: 0.96 });
    expect(snapTapeToEdge(0.1, 0.5)).toEqual({ x: 0.04, y: 0.5 });
  });
});

describe('보내기 전 검사', () => {
  const ok = {
    ...emptyLayout(FRAME),
    stickers: [clampSticker({ assetId: 's', x: 1, y: 0, scale: 0.2, rotation: 0 })],
  };

  it('정상이면 null, 문제가 있으면 서버 field 와 같은 위치를 준다', () => {
    expect(layoutProblem(ok)).toBeNull();
    const six = { ...ok, stickers: Array.from({ length: 6 }, () => ok.stickers[0]) };
    expect(layoutProblem(six)).toBe('layout.stickers[5]');
    expect(layoutProblem({ ...ok, stickers: [{ ...ok.stickers[0], scale: 0.7 }] })).toBe(
      'layout.stickers[0]',
    );
    expect(layoutProblem({ ...ok, tape: { assetId: 't', x: 0.5, y: 0.5, rotation: 0 } })).toBe(
      'layout.tape',
    );
    expect(layoutProblem({ ...ok, frameId: '' })).toBe('layout.frameId');
  });

  it('NaN·Infinity·빈 id 는 통과시키지 않고, 자르기는 기본값으로 바꾼다', () => {
    const nan = { ...ok.stickers[0], scale: NaN };
    expect(layoutProblem({ ...ok, stickers: [nan] })).toBe('layout.stickers[0]');
    expect(layoutProblem({ ...ok, stickers: [{ ...ok.stickers[0], rotation: NaN }] })).toBe(
      'layout.stickers[0]',
    );
    expect(layoutProblem({ ...ok, stickers: [{ ...ok.stickers[0], assetId: '' }] })).toBe(
      'layout.stickers[0]',
    );
    expect(
      layoutProblem({ ...ok, tape: { assetId: 't', x: 0.5, y: 0.04, rotation: Infinity } }),
    ).toBe('layout.tape');
    expect(
      clampSticker({ assetId: 'a', x: NaN, y: Infinity, scale: NaN, rotation: Infinity }),
    ).toEqual({ assetId: 'a', x: 0.5, y: 0.5, scale: 0.2, rotation: 0 });
  });

  it('knownIds 를 주면 이 앱이 모르는 재료를 거른다', () => {
    const known = (_: string, id: string) => id !== 's';
    expect(layoutProblem(ok, known)).toBe('layout.stickers[0]');
  });
});

describe('틀마다 글자 배율', () => {
  const m = componentTokens.magazineCell;
  it.each(Object.keys(MAGAZINE_FRAMES))(
    '%s — 60자 글·이름·주민 줄이 글 상자 높이·너비 안에 든다(하한 0.6 폴백에 걸리지 않음)',
    (id) => {
      const frame = MAGAZINE_FRAMES[id];
      const { scale, bodyScale, bodyLines } = cellTextFit(frame);
      expect(scale).toBeGreaterThanOrEqual(0.7);
      expect(scale).toBeLessThanOrEqual(1);
      expect(bodyScale).toBeGreaterThanOrEqual(0.7);
      expect(bodyScale).toBeLessThanOrEqual(scale);
      expect(bodyLines).toBeGreaterThanOrEqual(2);
      if (frame.maxBodyLines) expect(bodyLines).toBeLessThanOrEqual(frame.maxBodyLines);
      const [l, t, r, b] = frame.inset;
      const boxW = (1 - l - r) * m.referenceWidth;
      const boxH = (1 - t - b) * m.referenceWidth * m.aspect;
      const need =
        (m.profileDiameter + m.gap * 2 + m.metaSize * m.lineHeight) * scale +
        bodyLines * m.bodySize * bodyScale * m.lineHeight;
      expect(need).toBeLessThanOrEqual(boxH);
      // 띄어쓰기 없는 한글 60자(0.92em)가 정한 줄 수 안에 든다
      expect(60 * 0.92 * m.bodySize * bodyScale).toBeLessThanOrEqual(boxW * bodyLines);
    },
  );

  it('고양이 귀 틀은 아래쪽 인쇄 하트를 피해 글을 2줄까지만 쓴다', () => {
    const fit = cellTextFit(MAGAZINE_FRAMES['mag.frame-catear']);
    expect(fit.bodyLines).toBe(2);
    expect(fit.bodyScale).toBeLessThan(fit.scale);
  });
});

describe('버튼·스크린리더 고치기(applyEdit)', () => {
  const base = (): PromotionLayout => ({
    v: 1,
    frameId: FRAME,
    stickers: [
      { assetId: 'a', x: 0.5, y: 0.5, scale: 0.2, rotation: 0 },
      { assetId: 'b', x: 0.3, y: 0.3, scale: 0.2, rotation: 0 },
    ],
    tape: { assetId: 't', x: 0.5, y: 0.04, rotation: 0 },
  });
  const first = { kind: 'sticker', index: 0 } as const;

  it('옮기기·크게·작게·돌리기는 같은 범위 자르기를 거친다', () => {
    expect(applyEdit(base(), first, 'up').layout.stickers[0].y).toBeCloseTo(0.47);
    expect(applyEdit(base(), first, 'right').layout.stickers[0].x).toBeCloseTo(0.53);
    expect(applyEdit(base(), first, 'bigger').layout.stickers[0].scale).toBeCloseTo(0.23);
    expect(applyEdit(base(), first, 'rotateLeft').layout.stickers[0].rotation).toBe(-15);
    let l = base();
    for (let i = 0; i < 30; i++) l = applyEdit(l, first, 'smaller').layout;
    expect(l.stickers[0].scale).toBe(SCALE_MIN_FOR_TEST);
  });

  it('맨 앞으로는 고른 대상을 배열 끝으로 따라가고, 지우면 고르기가 풀린다', () => {
    const front = applyEdit(base(), first, 'front');
    expect(front.layout.stickers.map((s) => s.assetId)).toEqual(['b', 'a']);
    expect(front.target).toEqual({ kind: 'sticker', index: 1 });
    const del = applyEdit(base(), first, 'delete');
    expect(del.layout.stickers).toHaveLength(1);
    expect(del.target).toBeNull();
  });

  it('테이프는 옮기면 띠에 붙고 돌릴 수 있고, 크기·겹침은 그대로, 지우면 없다', () => {
    const tape = { kind: 'tape' } as const;
    expect(applyEdit(base(), tape, 'down').layout.tape).toMatchObject({ x: 0.5, y: 0.07 });
    expect(applyEdit(base(), tape, 'rotateRight').layout.tape?.rotation).toBe(15);
    expect(applyEdit(base(), tape, 'bigger').layout).toEqual(base());
    expect(applyEdit(base(), tape, 'delete')).toEqual({
      layout: { ...base(), tape: null },
      target: null,
    });
  });
});

describe('칸 밖 걸침 · 손잡이', () => {
  const { CANVAS_PAD, handlePoint, layoutBleed } = jest.requireActual('./useStickerGestures');
  const base = { v: 1 as const, frameId: FRAME, stickers: [], tape: null };

  it('위 테두리에 붙은 테이프는 중심 범위(8%)보다 더 걸친다 — 돌린 그림의 경계 상자로 잰다', () => {
    const bleed = layoutBleed({
      ...base,
      tape: { assetId: 'mag.tape-pink', x: 0.5, y: 0, rotation: 4 },
    });
    expect(bleed.y).toBeGreaterThan(CANVAS_PAD);
    expect(bleed.y).toBeLessThan(0.2);
    expect(layoutBleed(base)).toEqual({ x: 0, y: 0 });
  });

  it('가장자리 스티커의 손잡이도 판 안에 둔다(판 밖은 터치가 오지 않는다)', () => {
    const width = 300;
    const h = handlePoint(
      { ...base, stickers: [{ assetId: 'mag.heart', x: 1.08, y: 0.5, scale: 0.6, rotation: 0 }] },
      { kind: 'sticker', index: 0 },
      width,
    )!;
    expect(h.x).toBeLessThanOrEqual((1 + CANVAS_PAD) * width);
    expect(h.y).toBeLessThanOrEqual((1 + CANVAS_PAD) * width * CELL_ASPECT);
  });
});
