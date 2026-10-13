// 잡지 칸 레이아웃 순수 함수(GROMO-2289) — 비율 좌표 ↔ 픽셀 왕복, 범위 자르기, 10개 제한, 테이프 교체·테두리 붙이기,
// 맨 앞으로, 꾸미기 순서 뒤 저장 JSON, 보내기 전 검사, 틀마다 60자 글이 들어가는 글자 배율.
import { componentTokens } from '@/design-system/tokens';
import { MAGAZINE_FRAMES } from '@/constants/magazineAssets';
import {
  CELL_ASPECT,
  MAX_STICKERS,
  addSticker,
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
  it('11번째 스티커는 붙지 않는다(같은 스티커 여러 장은 된다)', () => {
    let layout = emptyLayout(FRAME);
    for (let i = 0; i < MAX_STICKERS; i++) layout = addSticker(layout, 'mag.heart')!;
    expect(layout.stickers).toHaveLength(10);
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
    const eleven = { ...ok, stickers: Array.from({ length: 11 }, () => ok.stickers[0]) };
    expect(layoutProblem(eleven)).toBe('layout.stickers[10]');
    expect(layoutProblem({ ...ok, stickers: [{ ...ok.stickers[0], scale: 0.7 }] })).toBe(
      'layout.stickers[0]',
    );
    expect(layoutProblem({ ...ok, tape: { assetId: 't', x: 0.5, y: 0.5, rotation: 0 } })).toBe(
      'layout.tape',
    );
    expect(layoutProblem({ ...ok, frameId: '' })).toBe('layout.frameId');
  });

  it('knownIds 를 주면 이 앱이 모르는 재료를 거른다', () => {
    const known = (_: string, id: string) => id !== 's';
    expect(layoutProblem(ok, known)).toBe('layout.stickers[0]');
  });
});

describe('틀마다 글자 배율', () => {
  const m = componentTokens.magazineCell;
  it.each(Object.keys(MAGAZINE_FRAMES))(
    '%s — 60자 글·이름·주민 줄이 글 상자 높이 안에 든다',
    (id) => {
      const inset = MAGAZINE_FRAMES[id].inset;
      const { scale, bodyLines } = cellTextFit(inset);
      expect(scale).toBeGreaterThanOrEqual(0.7);
      expect(scale).toBeLessThanOrEqual(1);
      expect(bodyLines).toBeGreaterThanOrEqual(2);
      const [, t, , b] = inset;
      const boxH = (1 - t - b) * m.referenceWidth * m.aspect;
      const need =
        (m.profileDiameter + m.gap * 2 + m.metaSize * m.lineHeight) * scale +
        bodyLines * m.bodySize * scale * m.lineHeight;
      expect(need).toBeLessThanOrEqual(boxH);
    },
  );
});
