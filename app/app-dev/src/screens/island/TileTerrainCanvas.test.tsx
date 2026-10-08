/**
 * @jest-environment @shopify/react-native-skia/jestEnv.js
 */
// Skia 공식 jest 설정: CanvasKit(wasm)을 올리는 jestEnv 를 이 파일에만 건다(mock 은 jest.setup.js).
import { buildBlockedPath, buildTerrainAtlas, navDebugText } from './TileTerrainCanvas';

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
