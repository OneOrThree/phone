// 잡지 꾸미기 재료 표(GROMO-2289) — 개수·id 모양·서랍 탭, 표에 적은 그림 비율이 실제 PNG 와 같은지, 틀 글 상자,
// 섬 그림 7단계 매핑(P8).
import fs from 'fs';
import path from 'path';
import {
  ISLAND_STAGE_ART,
  MAGAZINE_FRAMES,
  MAGAZINE_STICKERS,
  MAGAZINE_TAPES,
  islandStage,
} from './magazineAssets';

// PNG 머리(IHDR)의 너비·높이 — 그림을 바꿨는데 표의 aspect 를 안 고치면 스티커가 찌그러진다
const pngSize = (file: string) => {
  const buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};
const SRC = fs.readFileSync(path.join(__dirname, 'magazineAssets.ts'), 'utf8');
const fileOf = (id: string) => {
  const row = SRC.split('\n').find((line) => line.includes(`'${id}'`));
  const rel = row?.match(/require\('@\/(.+?)'\)/)?.[1];
  return path.join(__dirname, '..', rel ?? 'missing');
};

describe('재료 표', () => {
  it('틀 11 · 스티커 45 · 테이프 8 이고 id 는 mag.<종류>.<이름> 이다', () => {
    expect(Object.keys(MAGAZINE_FRAMES)).toHaveLength(11);
    expect(Object.keys(MAGAZINE_STICKERS)).toHaveLength(45);
    expect(Object.keys(MAGAZINE_TAPES)).toHaveLength(8);
    for (const id of Object.keys(MAGAZINE_FRAMES)) expect(id).toMatch(/^mag\.frame\.[a-z0-9-]+$/);
    for (const id of Object.keys(MAGAZINE_STICKERS))
      expect(id).toMatch(/^mag\.sticker\.[a-z0-9-]+$/);
    for (const id of Object.keys(MAGAZINE_TAPES)) expect(id).toMatch(/^mag\.tape\.[a-z0-9-]+$/);
  });

  it('스티커는 서랍 탭 넷(고양이·바다·친구들·꾸미기) 중 하나에 든다', () => {
    const tabs = Object.values(MAGAZINE_STICKERS).map((s) => s.tab);
    expect(new Set(tabs)).toEqual(new Set(['cat', 'sea', 'friends', 'deco']));
  });

  it('표의 그림 비율이 PNG 실제 크기와 같다', () => {
    const all = { ...MAGAZINE_FRAMES, ...MAGAZINE_STICKERS, ...MAGAZINE_TAPES };
    for (const [id, asset] of Object.entries(all)) {
      const { w, h } = pngSize(fileOf(id));
      expect([id, asset.aspect]).toEqual([id, expect.closeTo(w / h, 2)]);
    }
  });

  it('틀 글 상자는 칸 안쪽에 넉넉한 넓이로 있다', () => {
    for (const [id, { inset }] of Object.entries(MAGAZINE_FRAMES)) {
      const [l, t, r, b] = inset;
      expect([id, 1 - l - r > 0.55, 1 - t - b > 0.45]).toEqual([id, true, true]);
    }
  });
});

describe('섬 그림 단계(P8)', () => {
  it.each([
    [0, 7, 's0'],
    [1, 0, 's1'],
    [3, 1, 's1'],
    [3, 2, 's2'],
    [3, 3, 's3'],
    [3, 4, 's4'],
    [3, 5, 's5'],
    [3, 6, 's5'],
    [3, 7, 's7'],
    [3, 9, 's7'],
  ])('주민 %i명 · 완공 건물 %i개 → %s', (members, buildings, stage) => {
    expect(islandStage(members, buildings)).toBe(stage);
    expect(ISLAND_STAGE_ART[islandStage(members, buildings)]).toBeTruthy();
  });
});
