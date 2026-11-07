import test from "node:test";
import assert from "node:assert/strict";
import { movementKey } from "../src/keyboard";

test("한글·IME·대문자 입력에서도 WASD 물리 키를 같은 이동으로 해석한다", () => {
  for (const [code, expected, korean] of [
    ["KeyW", "w", "ㅈ"],
    ["KeyA", "a", "ㅁ"],
    ["KeyS", "s", "ㄴ"],
    ["KeyD", "d", "ㅇ"],
  ]) {
    for (const key of [korean, "Process", expected.toUpperCase()])
      assert.equal(movementKey({ code, key }), expected);
  }
});
test("키를 뗄 때 입력 언어가 달라도 같은 키를 해제하며 화살표는 그대로 쓴다", () => {
  assert.equal(
    movementKey({ code: "KeyW", key: "w" }),
    movementKey({ code: "KeyW", key: "ㅈ" }),
  );
  assert.equal(movementKey({ code: "ArrowUp", key: "ArrowUp" }), "arrowup");
  assert.equal(movementKey({ code: "KeyZ", key: "w" }), undefined);
});
test("물리 code가 없는 보조 입력만 문자 키를 사용한다", () => {
  assert.equal(movementKey({ code: "", key: "W" }), "w");
  assert.equal(movementKey({ code: "", key: "ArrowRight" }), "arrowright");
  assert.equal(movementKey({ code: "Space", key: " " }), undefined);
});
