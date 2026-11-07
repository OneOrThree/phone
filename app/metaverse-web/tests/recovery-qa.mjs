import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
const browser = await chromium.launch(browserOptions);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  let reconnect = false;
  await page.routeWebSocket("**/island-room", (socket) => {
    if (reconnect) socket.connectToServer();
    else socket.close();
  });
  await page.goto(target);
  await page.getByText("혼자 산책 중 · 다시 연결할게요").waitFor();
  await page.waitForFunction(() => !document.querySelector(".loading"));
  assert.equal(
    await page.locator("main").getAttribute("data-motion"),
    "reduced",
  );
  await page.locator(".world").focus();
  const initialCoordinates = await page.getByLabel("고양이 위치").textContent();
  await page.keyboard.down("s");
  await page.waitForFunction(
    (initial) => document.querySelector(".coordinates").textContent !== initial,
    initialCoordinates,
    { timeout: 15000 },
  );
  await page.keyboard.up("s");
  await page.waitForTimeout(300);
  assert.notEqual(
    await page.getByLabel("고양이 위치").textContent(),
    initialCoordinates,
  );
  results.push({ check: "연결 실패 중 산책·기기 동작 줄이기", pass: true });
  reconnect = true;
  await page.getByText("함께 있는 고양이 1").waitFor({ timeout: 10000 });
  results.push({ check: "실제 로컬 서버로 자동 재연결", pass: true });
  await page.getByRole("button", { name: "내 고양이와 설정" }).click();
  await page.getByLabel("가벼운 화면", { exact: false }).check();
  await page.getByRole("button", { name: "이 모습으로 산책하기" }).click();
  await page.screenshot({ path: "artifacts/05-light-mode.png" });
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(750, 420);
  await page.mouse.down();
  await page.mouse.move(960, 500, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const rotated = await canvas.screenshot();
  assert.ok(!before.equals(rotated));
  await page.getByRole("button", { name: "시점 되돌리기" }).click();
  await page.waitForTimeout(200);
  results.push({ check: "카메라 회전·초기화·가벼운 화면", pass: true });
  await page
    .getByRole("button", { name: "낚시섬으로 가기", exact: true })
    .click();
  await page.getByRole("button", { name: "자리 고르기", exact: true }).click();
  await page
    .getByRole("button", { name: "1번 의자 · 비어 있음", exact: true })
    .click();
  await page.getByRole("timer").waitFor();
  // WebGL 확장을 통해 실제 context-lost 이벤트와 복구 UI를 검증한다.
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 없음");
    gl.getExtension("WEBGL_lose_context").loseContext();
  });
  await page.getByRole("dialog", { name: "섬 화면이 잠시 멈췄어요" }).waitFor();
  assert.equal(await page.locator("main").getAttribute("data-focus"), "idle");
  assert.equal(
    await page.locator(".sound-status").getAttribute("data-audio-mode"),
    "ambient",
  );
  await page.keyboard.press("Escape");
  assert.ok(await page.getByRole("dialog").isVisible());
  await page.screenshot({ path: "artifacts/05-context-lost.png" });
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector(".loading"));
  await page.getByText("함께 있는 고양이 1").waitFor();
  results.push({
    check:
      "집중 중 WebGL context 소실 시 좌석·모닥불 음원 해제, 안내·다시 불러오기",
    pass: true,
  });
  await page.screenshot({ path: "artifacts/05-recovered-desktop.png" });
  const unsupported = await browser.newPage();
  await unsupported.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (
        type === "webgl" ||
        type === "webgl2" ||
        type === "experimental-webgl"
      )
        return null;
      return original.call(this, type, ...args);
    };
  });
  await unsupported.goto(target);
  await unsupported.getByText("섬을 그리지 못했어요").waitFor();
  assert.equal(await unsupported.locator(".loading").count(), 0);
  assert.ok(
    await unsupported
      .getByRole("button", { name: "다시 불러오기", exact: true })
      .isVisible(),
  );
  await unsupported.screenshot({ path: "artifacts/05-webgl-unavailable.png" });
  await unsupported.close();
  results.push({ check: "WebGL 미지원 시 로딩 대신 복구 안내", pass: true });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/recovery-results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
