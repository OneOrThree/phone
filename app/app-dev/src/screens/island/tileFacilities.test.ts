import {
  TILE_FACILITIES,
  layoutFacilitySigns,
  facilityTouchBox,
  facilitySignBox,
} from './tileFacilities';

it.each([0.26, 0.73, 1.9])('배율 %s에서 팻말이 겹치지 않고 뗏목 팻말은 위쪽에 둔다', (scale) => {
  const signs = layoutFacilitySigns(
    Object.entries(TILE_FACILITIES).map(([id, rect]) => ({ id, rect })),
    scale,
  );
  const boxes = Object.values(signs);
  boxes.forEach((a, i) =>
    boxes.slice(i + 1).forEach((b) => {
      expect(
        a.left < b.left + b.width &&
          a.left + a.width > b.left &&
          a.top < b.top + b.height &&
          a.top + a.height > b.top,
      ).toBe(false);
    }),
  );
  expect(signs.raft.top + signs.raft.height).toBeLessThanOrEqual(
    TILE_FACILITIES.raft.y * scale + 2 * scale,
  );
  for (const rect of Object.values(TILE_FACILITIES)) {
    const touch = facilityTouchBox(rect, scale);
    expect(touch.width).toBeGreaterThanOrEqual(44);
    expect(touch.height).toBeGreaterThanOrEqual(44);
  }
});

it('큰 글자 설정에서는 팻말도 커진다', () => {
  const facilities = [{ id: 'mail', rect: TILE_FACILITIES.mail }];
  const normal = layoutFacilitySigns(facilities, 0.73, 1).mail;
  const large = layoutFacilitySigns(facilities, 0.73, 2).mail;
  expect(large.width).toBe(normal.width * 2);
  expect(large.height).toBe(normal.height * 2);
});

it.each([
  '마을회관',
  'Town Hall',
  'Notice Board',
  'Lookout Tower',
  'Gramophone',
  'Campfire',
  'Library',
  'Mailbox',
  'Shop',
  'Raft',
])('%s 팻말은 건물 대비 크기와 상대 위치를 유지한다', (label) => {
  const rect = TILE_FACILITIES.hall;
  const small = facilitySignBox('hall', rect, 0.26, 1, label, 0.73);
  const large = facilitySignBox('hall', rect, 1.9, 1, label, 0.73);
  expect(large.width / 1.9).toBeCloseTo(small.width / 0.26);
  expect(large.height / 1.9).toBeCloseTo(small.height / 0.26);
  expect(large.left + large.width / 2).toBeCloseTo((rect.x + rect.w / 2) * 1.9);
  expect(large.top / 1.9).toBeCloseTo(small.top / 0.26);
});

it('긴 영어 이름은 팻말의 가로폭만 늘린다', () => {
  const rect = TILE_FACILITIES.tower;
  const ko = facilitySignBox('tower', rect, 0.26, 1, '전망대');
  const en = facilitySignBox('tower', rect, 0.26, 1, 'Lookout Tower');
  expect(en.width).toBeGreaterThan(ko.width);
  expect(en.height).toBe(ko.height);
});

it('충돌을 피한 팻말 배치도 빠른 줌에서 상대 위치가 바뀌지 않는다', () => {
  const facilities = Object.entries(TILE_FACILITIES).map(([id, rect]) => ({ id, rect }));
  const base = 0.73;
  const original = layoutFacilitySigns(facilities, base, 1, base);
  for (const scale of [0.26, 1.9, 0.35, 1.5, 0.26]) {
    const signs = layoutFacilitySigns(facilities, scale, 1, base);
    for (const id of Object.keys(original)) {
      for (const key of ['left', 'top', 'width', 'height'] as const) {
        expect(signs[id][key] / scale).toBeCloseTo(original[id][key] / base);
      }
    }
  }
});
