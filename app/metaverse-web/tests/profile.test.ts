import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_KEY, readProfile, saveProfile } from "../src/profile";

function storage(initial: string | null = null) {
  const data = new Map(initial === null ? [] : [[PROFILE_KEY, initial]]);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test("첫 방문·손상되거나 유효하지 않은 저장값은 이름을 다시 묻는다", () => {
  for (const value of [
    null,
    "{",
    "null",
    '"이름"',
    "{}",
    '{"name":"  ","color":"cream"}',
    '{"name":"모카","color":"red"}',
    JSON.stringify({ name: "a".repeat(17), color: "cream" }),
  ])
    assert.equal(readProfile(storage(value)), null);
});
test("이름·털색만 저장하고 다음 방문에 앞뒤 공백 없이 복원한다", () => {
  const store = storage();
  assert.equal(
    saveProfile({ name: "  물가 친구  ", color: "gray" }, store),
    true,
  );
  assert.deepEqual(readProfile(store), { name: "물가 친구", color: "gray" });
  assert.equal(saveProfile({ name: " ", color: "gray" }, store), false);
  assert.deepEqual(readProfile(store), { name: "물가 친구", color: "gray" });
});
test("저장소 읽기·쓰기가 거부돼도 예외를 전파하지 않는다", () => {
  const denied = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.equal(readProfile(denied), null);
  assert.equal(saveProfile({ name: "모카", color: "brown" }, denied), false);
});
