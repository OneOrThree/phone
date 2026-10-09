/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
// Skia 공식 jest 설정: CanvasKit(wasm)을 올리는 jestEnv 를 이 파일에만 건다(mock 은 jest.setup.js).
import {
  buildArrowPath,
  buildBlockedPath,
  buildTerrainAtlas,
  correctionFlash,
  navDebugText,
  type NavServerDebug,
} from './TileTerrainCanvas';

const noServer: NavServerDebug = {
  path: null,
  snapshot: null,
  predicted: null,
  correctedAt: null,
  snapshotAgeMs: null,
  waitingSince: null,
};

describe('buildTerrainAtlas', () => {
  const { sprites, transforms } = buildTerrainAtlas({ kind: 'bundle' });

  it('지형 24×16 = 384 조각을 한 배열로 만든다', () => {
    expect(sprites).toHaveLength(384);
    expect(transforms).toHaveLength(384);
  });

  it('아틀라스 소스 rect 는 margin 1 · pitch 130(128+spacing 2) · 31열', () => {
    expect([sprites[0].x, sprites[0].y, sprites[0].width, sprites[0].height]).toEqual([
      1, 1, 128, 128,
    ]);
    // gid 384 → slot 383 = 12행 11열
    const last = sprites[383];
    expect([last.x, last.y, last.width, last.height]).toEqual([
      1 + 11 * 130,
      1 + 12 * 130,
      128,
      128,
    ]);
  });

  it('목적지는 1x 64px 격자, 2x→1x 축소 0.5, 회전 없음', () => {
    const t0 = transforms[0];
    expect([t0.scos, t0.ssin, t0.tx, t0.ty]).toEqual([0.5, 0, 0, 0]);
    const t25 = transforms[25]; // 2행 2열
    expect([t25.tx, t25.ty]).toEqual([64, 64]);
    const last = transforms[383];
    expect([last.tx, last.ty]).toEqual([23 * 64, 15 * 64]);
  });
});

describe('이동 보기 helper', () => {
  it('막힌 셀만 한 경로로 묶는다(셀 크기 = 1536/cols × 1024/rows)', () => {
    const nav = { cols: 4, rows: 2, walkable: Uint8Array.from([1, 0, 1, 1, 1, 1, 1, 1]) } as any;
    const b = buildBlockedPath(nav).getBounds();
    expect([b.x, b.y, b.width, b.height]).toEqual([384, 0, 384, 512]);
  });

  it('읽기 줄: 경로 칸 수 · 탭과 목적지 거리 · nav 출처', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ];
    expect(navDebugText({ tap: { x: 0, y: 40 }, path }, 'cache')).toBe(
      '경로 2칸 · 보정 30px · nav cache',
    );
    expect(navDebugText(null, 'bundle')).toBe('경로 없음 · nav bundle');
  });
});

describe('서버 이동 보기 helper (GROMO-2249)', () => {
  it('buildArrowPath: 자루+쉐브론 bounds 는 scale 로 나뉜다', () => {
    const b1 = buildArrowPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 1).getBounds();
    expect([b1.x, b1.y, b1.width, b1.height]).toEqual([0, -4, 20, 8]);
    const b2 = buildArrowPath({ x: 0, y: 0 }, { x: 20, y: 0 }, 2).getBounds();
    expect([b2.x, b2.y, b2.width, b2.height]).toEqual([0, -2, 20, 4]);
  });

  it('correctionFlash: 499ms 는 깜빡이고 501ms·null 은 꺼진다', () => {
    expect(correctionFlash(1000, 1499)).toBe(true);
    expect(correctionFlash(1000, 1501)).toBe(false);
    expect(correctionFlash(null, 1499)).toBe(false);
  });

  it('navDebugText 둘째 줄: Δ·지연 / 대기 / 없음 세 가지', () => {
    const predicted = { x: 10, y: 0 },
      snapshot = { x: 13, y: 4 };
    // Δ = hypot(3,4) = 5
    expect(
      navDebugText(null, 'bundle', { ...noServer, predicted, snapshot, snapshotAgeMs: 83.4 }),
    ).toBe('경로 없음 · nav bundle\n서버 Δ 5px · 틱 지연 83ms');
    expect(navDebugText(null, 'bundle', { ...noServer, waitingSince: 1000 }, 1300)).toBe(
      '경로 없음 · nav bundle\n서버 대기 300ms',
    );
    expect(navDebugText(null, 'bundle', noServer)).toBe('경로 없음 · nav bundle\n서버 없음');
    // server 를 안 주면(기존 호출) 둘째 줄이 없다 — 기존 동작 불변.
    expect(navDebugText(null, 'bundle')).toBe('경로 없음 · nav bundle');
  });
});
