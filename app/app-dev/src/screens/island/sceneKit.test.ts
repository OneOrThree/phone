import assert from 'node:assert/strict';
import { renderHook } from '@testing-library/react-native';
import { GOWUN, safeOffset, useGowun, useGowunFont } from '@/screens/island/sceneKit';

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

test('네이티브는 앱에 넣은 고운돋움을 첫 렌더부터 쓴다 — 글꼴 불러오기를 기다리지 않는다', async () => {
  const first: [boolean, string | undefined][] = [];
  await renderHook(() => {
    first.push([useGowunFont()[0], useGowun()]);
  });
  // jest 기본 플랫폼은 iOS — 글꼴 파일 속 가족 이름으로 찾는다
  assert.equal(GOWUN, 'Gowun Dodum');
  assert.deepEqual(first[0], [true, 'Gowun Dodum']);
});
