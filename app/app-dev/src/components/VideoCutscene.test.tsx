import assert from 'node:assert/strict';
import { cutsceneVideoBox } from '@/components/VideoCutscene';

test('영상 상자는 화면 높이에 맞춘 9:16 — 세로 폰은 좌우가 밖으로, 납작한 화면은 좌우 여백', () => {
  const phone = cutsceneVideoBox(440, 956); // iPhone 16 Pro Max
  assert.equal(Math.round(phone.width), 538);
  assert.ok(phone.left < 0 && phone.left > -50, `좌우 한쪽 ${phone.left}`);

  const tablet = cutsceneVideoBox(1024, 1366); // iPad 세로
  assert.equal(Math.round(tablet.width), 768);
  assert.ok(tablet.left > 0, '좌우 여백');

  const exact = cutsceneVideoBox(360, 640); // 정확히 9:16
  assert.equal(exact.width, 360);
  assert.equal(exact.left, 0);
});
