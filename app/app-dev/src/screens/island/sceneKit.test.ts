import assert from 'node:assert/strict';
import { safeOffset } from '@/screens/island/sceneKit';

test('안전영역 보정은 시안 기준(세로 위 52·가로 좌우 52)을 넘는 만큼만 민다', () => {
  // 검토 모드 402×874 / 874×402 = 시안 좌표 그대로
  assert.deepEqual(safeOffset({ landscape: false, insets: { top: 52, left: 0, right: 0 } }), {
    top: 0,
    left: 0,
    right: 0,
  });
  assert.deepEqual(safeOffset({ landscape: true, insets: { top: 0, left: 52, right: 52 } }), {
    top: 0,
    left: 0,
    right: 0,
  });
  // 다이내믹 아일랜드 세로(59)·가로(좌우 59)는 넘치는 7만큼만
  assert.equal(safeOffset({ landscape: false, insets: { top: 59, left: 0, right: 0 } }).top, 7);
  const land = safeOffset({ landscape: true, insets: { top: 0, left: 59, right: 59 } });
  assert.deepEqual([land.left, land.right], [7, 7]);
  // 안전영역이 더 좁은 태블릿·안드로이드는 시안 그대로
  assert.equal(safeOffset({ landscape: false, insets: { top: 24, left: 0, right: 0 } }).top, 0);
});
