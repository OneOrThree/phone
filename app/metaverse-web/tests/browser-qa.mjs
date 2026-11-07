import { returningVisitor } from "./returning-visitor.mjs";
import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
const browser = await chromium.launch(browserOptions);
const errors = [],
  results = [],
  external = [],
  snapshots = [];
const observe = (page) => {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(r.url());
  });
};
const a = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
observe(a);
a.on("websocket", (ws) =>
  ws.on("framereceived", (frame) => {
    try {
      const m = JSON.parse(frame.payload.toString());
      if (m.type === "snapshot") snapshots.push(m);
    } catch {}
  }),
);
const ready = async (page) => {
  await returningVisitor(page);
  await page.goto(target);
  await page
    .getByRole("button", { name: "낚시섬으로 가기", exact: true })
    .waitFor();
  await page.waitForFunction(() => !document.querySelector(".loading"));
};
const coords = async (page) =>
  (await page.getByLabel("고양이 위치").textContent()).split(",").map(Number);
try {
  await ready(a);
  // 지면 클릭 좌표와 원격 이름표 비교는 섬 전체 시점을 기준으로 한다.
  await a.getByRole("button", { name: "섬 전체 보기" }).click();
  await a.waitForTimeout(1000);
  const initial = await coords(a);
  await a.locator(".world").focus();
  await a.keyboard.down("d");
  await a.waitForFunction(
    ([x, z]) => {
      const p = document
        .querySelector(".coordinates")
        .textContent.split(",")
        .map(Number);
      return Math.hypot(p[0] - x, p[1] - z) > 1;
    },
    initial,
    { timeout: 15000 },
  );
  await a.keyboard.up("d");
  await a.waitForTimeout(300);
  const moved = await coords(a);
  console.log({ initial, moved });
  assert.ok(Math.hypot(moved[0] - initial[0], moved[1] - initial[1]) > 1);
  results.push({ check: "키보드 실시간 이동", initial, moved });
  const clickedFrom = await coords(a);
  const camera = new PerspectiveCamera(38, 1440 / 1000, 0.1, 400);
  camera.position.set(30, 48, 56);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld();
  const ground = new Vector3(-4, 0.115, 13).project(camera);
  await a.mouse.click(
    (ground.x * 0.5 + 0.5) * 1440,
    (-ground.y * 0.5 + 0.5) * 1000,
  );
  await a.waitForFunction(
    ([x, z]) => {
      const p = document
        .querySelector(".coordinates")
        .textContent.split(",")
        .map(Number);
      return Math.hypot(p[0] - x, p[1] - z) > 0.2;
    },
    clickedFrom,
    { timeout: 15000 },
  );
  results.push({ check: "지면 클릭 이동", pass: true });
  await a.getByRole("button", { name: "섬 둘러보기" }).click();
  await a.getByRole("button", { name: /뗏목 부두 바다 건너/ }).click();
  await a.waitForFunction(
    () => {
      const [x, z] = document
        .querySelector(".coordinates")
        .textContent.split(",")
        .map(Number);
      return Math.hypot(x, z - 24.8) < 0.15;
    },
    null,
    { timeout: 30000 },
  );
  await a.waitForTimeout(1300);
  const dock = await coords(a);
  console.log({ dock });
  assert.ok(Math.abs(dock[0]) < 0.15 && Math.abs(dock[1] - 24.8) < 0.15);
  await a.screenshot({ path: "artifacts/02-dock.png" });
  results.push({ check: "일반 섬의 경로 이동 뒤 뗏목 부두 도착", dock });
  await a.getByRole("button", { name: "쉬기", exact: true }).click();
  await a.waitForTimeout(300);
  assert.equal(
    await a
      .getByRole("button", { name: "쉬기", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await a.getByRole("button", { name: "인사", exact: false }).click();
  await a.waitForTimeout(500);
  await a.screenshot({ path: "artifacts/02-wave.png" });
  const b = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  observe(b);
  await ready(b);
  await a
    .getByText("함께 있는 고양이 2", { exact: true })
    .waitFor({ timeout: 15000 });
  await b.getByRole("button", { name: "내 고양이와 설정" }).click();
  await b.getByLabel("섬에서 부를 이름").fill("같이 걷는 고양이");
  await b.getByRole("button", { name: "회색 고양이", exact: true }).click();
  await b.getByRole("button", { name: "이 모습으로 산책하기" }).click();
  await a.getByText("같이 걷는 고양이", { exact: true }).waitFor();
  const remote = a.getByText("같이 걷는 고양이", { exact: true });
  const before = await remote.boundingBox();
  const remoteStart = await coords(b);
  await b.locator(".world").focus();
  await b.keyboard.down("a");
  await b.waitForFunction(
    ([x, z]) => {
      const p = document
        .querySelector(".coordinates")
        .textContent.split(",")
        .map(Number);
      return Math.hypot(p[0] - x, p[1] - z) > 1.5;
    },
    remoteStart,
    { timeout: 15000 },
  );
  await b.keyboard.up("a");
  await a.waitForFunction(
    (before) => {
      const label = [...document.querySelectorAll(".cat-label")].find(
        (e) => e.textContent === "같이 걷는 고양이",
      );
      if (!label) return false;
      const after = label.getBoundingClientRect();
      return Math.hypot(after.x - before.x, after.y - before.y) > 10;
    },
    before,
    { timeout: 15000 },
  );
  const after = await remote.boundingBox();
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) > 10);
  await b.getByRole("button", { name: "인사", exact: false }).click();
  await a.waitForTimeout(700);
  assert.ok(
    snapshots.some((m) =>
      m.residents.some(
        (p) =>
          p.name === "같이 걷는 고양이" &&
          p.color === "gray" &&
          p.action === "wave",
      ),
    ),
  );
  await a.screenshot({ path: "artifacts/03-two-cats.png" });
  results.push({
    check: "두 브라우저 입장·이름·털색·실시간 이동",
    before,
    after,
  });
  await b.close();
  await a
    .getByText("함께 있는 고양이 1", { exact: true })
    .waitFor({ timeout: 15000 });
  results.push({ check: "퇴장 후 주민 정리", pass: true });
  await a.getByRole("button", { name: "내 고양이와 설정" }).click();
  const stopped = await coords(a);
  await a.getByLabel("섬에서 부를 이름").fill("wasd");
  await a.keyboard.press("ArrowLeft");
  await a.waitForTimeout(500);
  assert.deepEqual(await coords(a), stopped);
  await a.getByLabel("동작 줄이기", { exact: false }).check();
  await a.getByRole("button", { name: "이 모습으로 산책하기" }).click();
  assert.equal(await a.locator("main").getAttribute("data-motion"), "reduced");
  results.push({ check: "입력창 키 차단·동작 줄이기", pass: true });
  await a.getByRole("button", { name: "조작 안내" }).click();
  await a.keyboard.press("Escape");
  await a.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await a.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    "조작 안내",
  );
  results.push({ check: "모달 Escape·포커스 복원", pass: true });
  for (const width of [320, 375, 414, 768]) {
    const page = await browser.newPage({
      viewport: { width, height: 812 },
      hasTouch: true,
      isMobile: width < 700,
    });
    observe(page);
    await ready(page);
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      buttons: [...document.querySelectorAll("button")]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({
          text: e.getAttribute("aria-label") || e.textContent.trim(),
          width: e.getBoundingClientRect().width,
          height: e.getBoundingClientRect().height,
        })),
    }));
    assert.ok(layout.scroll <= width);
    assert.ok(layout.buttons.every((b) => b.width >= 43.5 && b.height >= 43.5));
    await page.screenshot({ path: `artifacts/04-mobile-${width}.png` });
    if (width === 375) {
      const stick = await page.locator(".joystick").boundingBox();
      const old = await coords(page);
      await page.mouse.move(
        stick.x + stick.width / 2,
        stick.y + stick.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        stick.x + stick.width / 2 + 28,
        stick.y + stick.height / 2,
      );
      await page.waitForFunction(
        (old) => document.querySelector(".coordinates").textContent !== old,
        old.map((v) => v.toFixed(1)).join(", "),
        { timeout: 15000 },
      );
      await page.mouse.up();
      await page.waitForTimeout(300);
      assert.notDeepEqual(await coords(page), old);
      results.push({ check: "터치 조이스틱 포인터 캡처·이동", pass: true });
    }
    await page.getByRole("button", { name: "내 고양이와 설정" }).click();
    await page.screenshot({ path: `artifacts/04-settings-${width}.png` });
    await page.close();
    results.push({ check: `${width}px 화면·44px 터치 영역`, layout });
  }
  results.push({ check: "외부 네트워크 요청", external });
  assert.equal(external.length, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/browser-results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: results.length, errors }, null, 2));
} catch (e) {
  await a.screenshot({ path: "artifacts/qa-failure.png" });
  console.error(e);
  console.error({ errors });
  process.exitCode = 1;
} finally {
  await browser.close();
}
