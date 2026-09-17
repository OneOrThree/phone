import assert from 'node:assert/strict';
import { restSeats, seatBox } from '@/screens/focus/RestGroup';

const screens = [
  // 세로·가로 폰(검수 캡처와 같은 안전 여백)
  { W: 402, H: 874, inset: { top: 52, bottom: 32, left: 0, right: 0 } },
  { W: 874, H: 402, inset: { top: 0, bottom: 21, left: 52, right: 52 } },
];

test('모닥불: 6명까지는 시안 6자리 그대로', () => {
  for (const { W, H, inset } of screens) {
    const six = restSeats(6, W, H, inset),
      fifteen = restSeats(15, W, H, inset);
    assert.equal(six.seats.length, 6);
    assert.deepEqual(fifteen.seats.slice(0, 6), six.seats);
    assert.equal(fifteen.x0, six.x0);
    assert.equal(fifteen.y0, six.y0);
  }
});

test('모닥불: 아주 작은 화면(320×568)에서도 15명 모두 자리를 받는다', () => {
  const { seats } = restSeats(15, 320, 568, { top: 24, bottom: 16, left: 0, right: 0 });
  assert.equal(seats.length, 15);
  assert.ok(seats.every((a) => Number.isFinite(a.x) && Number.isFinite(a.top) && a.n > 0));
});

test('모닥불: 정원 15명이 모두 화면 안에 서로 겹치지 않게 앉는다', () => {
  for (const { W, H, inset } of screens) {
    const { seats } = restSeats(15, W, H, inset);
    assert.equal(seats.length, 15, `${W}x${H}`);
    const boxes = seats.map((a) => seatBox(a.x, a.top, a.n));
    boxes.slice(6).forEach((b, n) => {
      assert.ok(b.l >= 0 && b.r <= W && b.t >= 0 && b.b <= H, `${W}x${H} ${n}`);
      boxes.forEach((c, m) => {
        if (m !== n + 6)
          assert.ok(!(b.l < c.r && c.l < b.r && b.t < c.b && c.t < b.b), `${W}x${H} ${n + 6}-${m}`);
      });
    });
  }
});
