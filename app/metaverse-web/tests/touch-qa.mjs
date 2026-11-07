import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { writeFile } from "node:fs/promises";
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
const browser = await chromium.launch(browserOptions);
const page = await browser.newPage({
  viewport: { width: 375, height: 812 },
  hasTouch: true,
  isMobile: true,
  reducedMotion: "reduce",
});
const errors = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
const coords = () => page.locator(".coordinates").textContent();
try {
  await page.goto(target);
  await page.waitForFunction(() => !document.querySelector(".loading"));
  await page.getByRole("button", { name: "섬 전체 보기" }).click();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  const stick = await page.locator(".joystick").boundingBox(),
    x = stick.x + stick.width / 2,
    y = stick.y + stick.height / 2;
  const initial = await coords();
  await touch("touchStart", [[x, y]]);
  await touch("touchMove", [[x + 28, y]]);
  await page.waitForFunction(
    (old) => document.querySelector(".coordinates").textContent !== old,
    initial,
    { timeout: 15000 },
  );
  await touch("touchEnd", []);
  await page.waitForTimeout(400);
  const released = await coords();
  await page.waitForTimeout(500);
  assert.equal(await coords(), released);
  results.push({
    check: "실제 터치 조이스틱 이동·손을 떼면 정지",
    initial,
    released,
  });
  const camera = new PerspectiveCamera(38, 375 / 812, 0.1, 400);
  camera.position.set(60, 84, 108);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld();
  const ground = new Vector3(2.8, 0.115, 13).project(camera);
  await page.touchscreen.tap(
    (ground.x * 0.5 + 0.5) * 375,
    (-ground.y * 0.5 + 0.5) * 812,
  );
  await page.waitForFunction(
    (old) => document.querySelector(".coordinates").textContent !== old,
    released,
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "산책", exact: true }).click();
  results.push({ check: "실제 땅 터치 이동", pass: true });
  const landmark = page.getByText("마을회관", { exact: true }),
    before = await landmark.boundingBox();
  await touch("touchStart", [[180, 280]]);
  await touch("touchMove", [[220, 290]]);
  await touch("touchMove", [[260, 300]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(300);
  const rotated = await landmark.boundingBox();
  assert.ok(Math.hypot(rotated.x - before.x, rotated.y - before.y) > 5);
  results.push({ check: "한 손가락 카메라 회전", pass: true });
  await page.getByRole("button", { name: "시점 되돌리기" }).click();
  await page.waitForTimeout(250);
  const reset = await landmark.boundingBox();
  assert.ok(Math.hypot(reset.x - before.x, reset.y - before.y) < 2);
  await touch("touchStart", [
    [130, 390],
    [240, 390],
  ]);
  await touch("touchMove", [
    [110, 390],
    [260, 390],
  ]);
  await touch("touchMove", [
    [95, 390],
    [275, 390],
  ]);
  await touch("touchEnd", []);
  await page.waitForTimeout(300);
  const zoomed = await landmark.boundingBox();
  assert.ok(Math.hypot(zoomed.x - reset.x, zoomed.y - reset.y) > 5);
  results.push({ check: "두 손가락 핀치 확대·시점 초기화", pass: true });
  await page.screenshot({ path: "artifacts/06-touch-zoom.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/touch-results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
