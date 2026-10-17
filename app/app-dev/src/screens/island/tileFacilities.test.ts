import { TILE_FACILITIES, layoutFacilitySigns, facilityTouchBox } from './tileFacilities';

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
    TILE_FACILITIES.raft.y * scale + 2,
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
