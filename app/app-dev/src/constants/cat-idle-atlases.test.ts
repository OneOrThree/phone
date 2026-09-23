import { readFileSync } from 'node:fs';
import path from 'node:path';
import { colors } from '@/services/model';
import { CAT_IDLE_ATLAS_FRAMES, CAT_IDLE_ATLAS_SIZES } from './cat-idle-atlases';

describe('고양이 모션 에셋과 자르기 좌표', () => {
  test.each(colors)('%s: 12개 자세가 실제 PNG 범위 안에 있고 발 기준점이 유효하다', (color) => {
    const png = readFileSync(
      path.join(__dirname, '../assets/characters/cat', color, 'idle/idle-atlas.png'),
    );
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    expect(CAT_IDLE_ATLAS_SIZES[color]).toEqual(size);
    expect(CAT_IDLE_ATLAS_FRAMES[color]).toHaveLength(12);
    for (const { rect, footAnchor, scale } of CAT_IDLE_ATLAS_FRAMES[color]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(size.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(size.height);
      expect(footAnchor.x).toBeGreaterThanOrEqual(0);
      expect(footAnchor.x).toBeLessThanOrEqual(1);
      expect(footAnchor.y).toBeGreaterThanOrEqual(0);
      expect(footAnchor.y).toBeLessThanOrEqual(1);
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThan(2);
    }
  });
});
