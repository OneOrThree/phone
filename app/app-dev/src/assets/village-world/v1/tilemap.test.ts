// GROMO-2229: 타일 아틀라스 산출물의 데이터 계약 검증 (이미지는 열지 않는다).
import homeMap from './home.map.json';
import tilemap from './tilemap.json';
import tileset from './tileset.json';

describe('village-world v1 tilemap', () => {
  const [terrain, detail, roads] = tilemap.layers;

  it('terrain 은 1..384 를 위치 순으로 한 번씩 가진다', () => {
    expect(terrain.name).toBe('terrain');
    expect(terrain.data).toHaveLength(384);
    expect(new Set(terrain.data).size).toBe(384);
    expect(Math.min(...terrain.data)).toBe(1);
    expect(Math.max(...terrain.data)).toBe(384);
  });

  it('terrain-detail · roads 는 빈 data 다', () => {
    expect(detail.name).toBe('terrain-detail');
    expect(detail.data).toEqual([]);
    expect(roads.name).toBe('roads');
    expect(roads.data).toEqual([]);
  });

  it('타일셋 슬롯 수가 384 이상이고 이미지 안에 들어간다', () => {
    const { columns, tilewidth, tileheight, margin, spacing, imagewidth, imageheight } = tileset;
    const pitchX = tilewidth + spacing;
    const pitchY = tileheight + spacing;
    const rows = Math.floor((imageheight - 2 * margin + spacing) / pitchY);
    expect(columns).toBeLessThanOrEqual(Math.floor((imagewidth - 2 * margin + spacing) / pitchX));
    expect(columns * rows).toBeGreaterThanOrEqual(tileset.tilecount);
    expect(tileset.tilecount).toBe(384);
  });

  it('@2x 타일은 월드 64px 의 2배다', () => {
    expect(tileset.tilewidth / tileset.scale).toBe(64);
    expect(tilemap.tilewidth).toBe(64);
    expect(tilemap.tileheight).toBe(64);
  });

  it('home.map.json 의 타일 격자와 일치한다', () => {
    expect(homeMap.tiles.size).toBe(tilemap.tilewidth);
    expect(homeMap.tiles.columns).toBe(tilemap.width);
    expect(homeMap.tiles.rows).toBe(tilemap.height);
    expect(homeMap.tiles.tileset).toBe(tileset.image);
    expect(homeMap.tiles.map).toBe('tilemap.json');
  });

  // 타일셋 메타(margin·spacing·columns)로 gid 의 아틀라스 원본 좌표와 지형 목적지 좌표를 계산한다.
  const rects = (gid: number) => {
    const { margin, spacing, columns, tilewidth, tileheight } = tileset;
    const k = gid - 1;
    return {
      src: [margin + (k % columns) * (tilewidth + spacing), margin + Math.floor(k / columns) * (tileheight + spacing)],
      dest: [(k % tilemap.width) * tilemap.tilewidth, Math.floor(k / tilemap.width) * tilemap.tileheight],
    };
  };

  it.each([
    [1, [1, 1], [0, 0]],
    [32, [1, 131], [448, 64]],
    [384, [1431, 1561], [1472, 960]],
  ])('gid %d 의 src·dest 좌표가 고정값과 같다', (gid, src, dest) => {
    expect(rects(gid)).toEqual({ src, dest });
  });

  it('scale 은 Tiled 가 보존하는 properties 에도 있다', () => {
    expect(tileset.properties).toEqual([{ name: 'scale', type: 'int', value: 2 }]);
    expect(tileset.scale).toBe(2);
  });
});
