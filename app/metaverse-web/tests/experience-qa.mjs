import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
await mkdir("artifacts/quality-revision", { recursive: true });
const browser = await chromium.launch(browserOptions);
const errors = [],
  results = [];
const coords = async (page) =>
  (await page.getByLabel("고양이 위치").textContent()).split(",").map(Number);
const center = async (page) => {
  const box = await page.locator(".cat-label.self").boundingBox();
  assert.ok(box);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 375, 812],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width < 700,
      isMobile: width < 700,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (e.type() === "error") errors.push(e.text());
    });
    await page.goto(target);
    await page.waitForFunction(() => !document.querySelector(".loading"));
    await page.waitForTimeout(600);
    assert.equal(
      await page.locator("main").getAttribute("data-camera"),
      "follow",
    );
    await page.screenshot({
      path: `artifacts/quality-revision/follow-${name}.png`,
    });
    const initial = await coords(page),
      before = await center(page);
    if (width < 700) {
      const cdp = await page.context().newCDPSession(page);
      const stick = await page.locator(".joystick").boundingBox();
      const x = stick.x + stick.width / 2,
        y = stick.y + stick.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y, id: 0 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + 28, y, id: 0 }],
      });
      await page.waitForTimeout(850);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      // 버튼을 누른 뒤 장면에 초점을 옮기지 않아도 이동해야 한다.
      await page.getByRole("button", { name: "쉬기", exact: true }).click();
      await page.keyboard.down("d");
      await page.waitForTimeout(850);
      await page.keyboard.up("d");
    }
    await page.waitForTimeout(600);
    const moved = await coords(page),
      after = await center(page);
    assert.ok(Math.hypot(moved[0] - initial[0], moved[1] - initial[1]) > 0.5);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 12);
    results.push({
      check: `${name}: 이동 중 추적 시점과 ${width < 700 ? "터치 입력" : "버튼 클릭 후 키보드 입력"}`,
      initial,
      moved,
      before,
      after,
    });
    await page.getByRole("button", { name: "쉬기", exact: true }).click();
    await page.waitForTimeout(450);
    await page.screenshot({
      path: `artifacts/quality-revision/sit-${name}.png`,
    });
    await page.getByRole("button", { name: "인사", exact: false }).click();
    await page.waitForTimeout(350);
    await page.screenshot({
      path: `artifacts/quality-revision/wave-${name}.png`,
    });
    await page.getByRole("button", { name: "섬 전체 보기" }).click();
    assert.equal(
      await page.locator("main").getAttribute("data-camera"),
      "overview",
    );
    await page.waitForTimeout(400);
    const overview = await center(page);
    assert.ok(Math.hypot(overview.x - after.x, overview.y - after.y) > 15);
    await page.screenshot({
      path: `artifacts/quality-revision/overview-${name}.png`,
    });
    await page.getByRole("button", { name: "고양이 따라가기" }).click();
    await page.waitForTimeout(400);
    const restored = await center(page);
    assert.ok(Math.hypot(restored.x - after.x, restored.y - after.y) < 12);
    results.push({ check: `${name}: 전체 시점 전환 후 추적 복귀`, pass: true });
    await page
      .getByRole("button", { name: "낚시섬으로 가기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "자리 고르기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "14번 의자 · 비어 있음", exact: true })
      .click();
    await page.getByRole("timer").waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    await page.screenshot({
      path: `artifacts/quality-revision/focus-${name}.png`,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/experience-results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
