import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FORCE_WARNING, confirmNotices } from "../src/confirmNotices.ts";
import { unpublishedWarning } from "../src/versions.ts";

const force = { kind: "notice", status: "review", noticeType: "force", minIosVersion: "2.0.0", minAndroidVersion: null };
const unpublished = { version: null, status: "unpublished" };
const APPROVE_HINT = "승인 후 내용이 바뀌면 다시 검토·승인이 필요합니다.";
// 스크린리더가 읽는 문구 전체: 미리보기 앞(before) + 뒤(after).
const described = (...args) => { const { before, after } = confirmNotices(...args); return [...before, ...after].map(notice => notice.text); };

test("강제 업데이트와 스토어 미공개 안내가 겹치면 둘 다 설명에 들어가고 화면 순서를 지킨다", () => {
  const { before, after } = confirmNotices(force, "approve", unpublished);
  assert.deepEqual(before, []);
  assert.deepEqual(after.map(({ text, className, role }) => [text, className, role]), [
    [FORCE_WARNING, "callout", "alert"],
    [unpublishedWarning, "callout", "status"],
    [APPROVE_HINT, "field-hint", undefined],
  ]);
});

test("패치노트와 경고 대상이 아닌 action 에는 FORCE_WARNING 이 없다", () => {
  assert.deepEqual(described({ ...force, noticeType: "patch", minIosVersion: null }, "approve", unpublished), [APPROVE_HINT]);
  for (const action of ["cancel", "cancel-delivery", "withdraw", "archive"]) {
    const texts = described(force, action, unpublished);
    assert.ok(!texts.includes(FORCE_WARNING) && !texts.includes(unpublishedWarning), action);
  }
});

test("uncertain 재시도 안내는 미리보기 앞(before)에 둔다", () => {
  const { before, after } = confirmNotices({ ...force, status: "uncertain" }, "publish", unpublished);
  assert.equal(before.length, 1);
  assert.ok(after.every(notice => notice.text !== before[0].text));
});

test("승인 대화상자의 aria-describedby 는 안내를 담는 실제 요소를 가리킨다", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const dialog = app.slice(app.indexOf("<dialog"), app.indexOf("</dialog>"));
  const ids = dialog.match(/aria-describedby="([^"]+)"/)?.[1].split(" ") ?? [];
  assert.notEqual(ids.length, 0, "dialog 에 aria-describedby 가 없다");
  for (const id of ids) assert.ok(dialog.includes(`id="${id}"`), `${id} 요소가 없다`);
  // 두 요소는 confirmNotices 의 before·after 만 담는다(오류 메시지·버튼은 밖). 미리보기 앞뒤 순서도 그대로다.
  const [uncertain, notices] = ['<div id="confirm-uncertain">{renderNotices(before)}</div>', '<div id="confirm-notices">{renderNotices(after)}</div>'].map(tag => dialog.indexOf(tag));
  assert.ok(uncertain >= 0 && uncertain < dialog.indexOf("<ContentPreview") && dialog.indexOf("<ContentPreview") < notices, "안내 요소 위치");
  // 안내를 dialog 안에 직접 쓰면 설명에서 빠진다.
  assert.ok(!/callout|field-hint/.test(dialog), "설명 밖에 안내 문구가 있다");
});
