import test from "node:test";
import assert from "node:assert/strict";
import { confirmEditorLeave } from "../src/navigation.ts";

test("정책에 미저장 변경이 있으면 메뉴 이동을 취소할 수 있다", () => {
  let asked = 0;
  const allowed = confirmEditorLeave(false, true, () => { asked++; return false; });
  assert.equal(allowed, false);
  assert.equal(asked, 1);
  assert.equal(confirmEditorLeave(false, true, () => true), true);
});

test("저장된 화면 이동에는 확인 창을 띄우지 않는다", () => {
  assert.equal(confirmEditorLeave(false, false, () => { throw new Error("확인 창을 띄우면 안 됩니다"); }), true);
});

test("건설 정책을 포함한 콘텐츠 편집 중 Focus 메뉴 이동도 미저장 변경을 지킨다", () => {
  assert.equal(confirmEditorLeave(true, false, () => false), false);
  assert.equal(confirmEditorLeave(true, true, () => false), false);
  assert.equal(confirmEditorLeave(true, false, () => true), true);
});
