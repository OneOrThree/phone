import {
  cellCenterToWorld,
  imageToWorld,
  screenToImage,
  isInsideWorld,
  worldToCell,
  worldToImage,
  worldToWire,
  wireToWorld,
} from './worldCoords';

const size = { imageWidth: 1536, imageHeight: 1024 };

describe('worldCoords', () => {
  it('회관 앵커 (1095,321) → world → cell → wire', () => {
    const w = imageToWorld({ x: 1095, y: 321 }, size);
    expect(w.x).toBeCloseTo(71.29, 2);
    expect(w.y).toBeCloseTo(31.35, 2);
    expect(worldToCell(w)).toEqual({ cx: 71, cy: 31 });
    expect(worldToWire({ x: 71.29, y: 31.35 })).toEqual({ x: 7129, y: 3135 });
  });

  it('screen → image 는 offset 을 빼고 scale 로 나눈다', () => {
    expect(screenToImage({ x: 120, y: 70 }, { offsetX: 20, offsetY: 10, scale: 0.5 })).toEqual({
      x: 200,
      y: 120,
    });
  });

  it('world → wire → world 왕복 오차는 축당 0.005 이하', () => {
    for (const v of [0, 0.004, 12.3456, 50.005, 99.999, 100]) {
      const back = wireToWorld(worldToWire({ x: v, y: v }) as { x: number; y: number });
      expect(Math.abs(back.x - v)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(back.y - v)).toBeLessThanOrEqual(0.005 + 1e-9);
    }
  });

  it('world ↔ image 왕복', () => {
    const w = imageToWorld(worldToImage({ x: 33.3, y: 66.6 }, size), size);
    expect(w.x).toBeCloseTo(33.3, 9);
    expect(w.y).toBeCloseTo(66.6, 9);
  });

  it('셀 경계: min(99, floor), 음수는 0', () => {
    expect(worldToCell({ x: 0, y: 0 })).toEqual({ cx: 0, cy: 0 });
    expect(worldToCell({ x: 99.99, y: 100 })).toEqual({ cx: 99, cy: 99 });
    expect(worldToCell({ x: -3.2, y: -0.01 })).toEqual({ cx: 0, cy: 0 });
    expect(cellCenterToWorld({ cx: 71, cy: 31 })).toEqual({ x: 71.5, y: 31.5 });
  });

  it('범위 밖·비유한값은 worldToWire 가 null, 경계(0·100)는 통과', () => {
    expect(worldToWire({ x: -0.01, y: 5 })).toBeNull();
    expect(worldToWire({ x: 5, y: 100.01 })).toBeNull();
    expect(worldToWire({ x: NaN, y: 5 })).toBeNull();
    expect(worldToWire({ x: 100, y: 0 })).toEqual({ x: 10000, y: 0 });
    expect(worldToCell({ x: 100, y: 100 })).toEqual({ cx: 99, cy: 99 });
  });

  it('isInsideWorld 경계', () => {
    expect(isInsideWorld({ x: 0, y: 100 })).toBe(true);
    expect(isInsideWorld({ x: -0.01, y: 50 })).toBe(false);
    expect(isInsideWorld({ x: 50, y: 100.01 })).toBe(false);
    expect(isInsideWorld({ x: Infinity, y: 1 })).toBe(false);
  });

  it('NaN·±Infinity 는 throw 없이 처리한다', () => {
    expect(worldToCell({ x: NaN, y: Infinity })).toEqual({ cx: 0, cy: 0 });
    expect(worldToWire({ x: NaN, y: -Infinity })).toBeNull();
    expect(screenToImage({ x: 5, y: 5 }, { offsetX: 0, offsetY: 0, scale: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
