import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
await mkdir("artifacts/controls", { recursive: true });
const browser = await chromium.launch(browserOptions);
const errors = [],
  results = [];
let current;
const note = (check, detail = {}) => {
  results.push({ check, ...detail });
  console.log(check);
};
const coordinates = async (p) =>
  (await p.locator(".coordinates").textContent()).split(",").map(Number);
const delta = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const label = (p) =>
  p.locator(".cat-label.self").evaluate((e) => {
    const b = e.getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  });
const metric = async (p) => {
  const v = await label(p),
    s = p.viewportSize();
  return Math.hypot(v[0] - s.width / 2, v[1] - s.height / 2);
};
const reset = async (p) => {
  await p.getByRole("button", { name: "시점 되돌리기", exact: true }).click();
  await p.waitForTimeout(750);
};
const ready = async (options) => {
  const p = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  current = p;
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await p.goto(target);
  await p.waitForFunction(
    () =>
      !document.querySelector(".loading") &&
      document.querySelector(".connection.online"),
  );
  return p;
};
async function drag(p, button = "left", from = [720, 330], to = [900, 390]) {
  await p.mouse.move(...from);
  await p.mouse.down({ button });
  await p.mouse.move(...to, { steps: 12 });
  await p.mouse.up({ button });
  await p.waitForTimeout(700);
}
try {
  const p = await ready();
  const cdp = await p.context().newCDPSession(p);
  const key = (type, code, value, vk) =>
    cdp.send("Input.dispatchKeyEvent", {
      type,
      code,
      key: value,
      windowsVirtualKeyCode: vk,
    });
  for (const [code, value, vk] of [
    ["KeyW", "ㅈ", 87],
    ["KeyA", "ㅁ", 65],
    ["KeyS", "ㄴ", 83],
    ["KeyD", "ㅇ", 68],
  ]) {
    const before = await coordinates(p);
    await key("keyDown", code, value, vk);
    await p.waitForTimeout(500);
    await key("keyUp", code, value, vk);
    await p.waitForTimeout(250);
    assert.ok(delta(before, await coordinates(p)) > 0.5, code);
  }
  note("한글 입력 상태 물리 WASD 네 방향 이동");
  await key("keyDown", "KeyD", "D", 68);
  await p.waitForTimeout(250);
  await key("keyUp", "KeyD", "ㅇ", 68);
  await p.waitForTimeout(300);
  const released = await coordinates(p);
  await p.waitForTimeout(500);
  assert.deepEqual(await coordinates(p), released);
  await p.keyboard.press("Control+d");
  await p.waitForTimeout(250);
  assert.deepEqual(await coordinates(p), released);
  note("대문자·한영 전환 뒤 키 해제·브라우저 단축키 이동 방지");
  await p.getByRole("button", { name: "내 고양이와 설정" }).click();
  await p.getByLabel("섬에서 부를 이름").fill("wasd");
  await p.getByLabel("섬에서 부를 이름").press("ArrowLeft");
  assert.deepEqual(await coordinates(p), released);
  await p.getByRole("button", { name: "이 모습으로 산책하기" }).click();
  const beforeButton = await coordinates(p);
  await p.keyboard.down("s");
  await p.waitForTimeout(350);
  await p.keyboard.up("s");
  await p.waitForTimeout(250);
  assert.ok(delta(beforeButton, await coordinates(p)) > 0.3);
  note("입력창에서는 이동하지 않고 버튼 사용 뒤 즉시 이동");
  await reset(p);
  const beforePan = await label(p),
    stationary = await coordinates(p);
  await drag(p, "right");
  const afterPan = await label(p);
  assert.ok(delta(beforePan, afterPan) > 40);
  assert.deepEqual(await coordinates(p), stationary);
  await p.waitForTimeout(700);
  assert.ok(delta(afterPan, await label(p)) < 2);
  await p.screenshot({ path: "artifacts/controls/pan-desktop.png" });
  note("우클릭 드래그는 카메라만 이동하고 놓은 구도를 유지");
  await p.keyboard.down("s");
  await p.waitForTimeout(900);
  await p.keyboard.up("s");
  await p.waitForTimeout(500);
  assert.ok(delta(await label(p), beforePan) < 8);
  note("산책을 재개하면 고양이로 부드럽게 추적 복귀");
  await reset(p);
  const beforeShift = await label(p),
    pos = await coordinates(p);
  await p.keyboard.down("Shift");
  await drag(p, "left", [720, 330], [860, 330]);
  await p.keyboard.up("Shift");
  assert.ok(delta(beforeShift, await label(p)) > 30);
  assert.deepEqual(await coordinates(p), pos);
  note("Shift+드래그 평면 이동·드래그 뒤 땅 클릭 이동 방지");
  await reset(p);
  const base = await metric(p);
  await p.mouse.move(700, 350);
  await p.mouse.wheel(0, -100);
  await p.waitForTimeout(700);
  const zoomed = await metric(p);
  assert.ok(zoomed > base * 1.1 && zoomed < base * 1.4, { base, zoomed });
  await p.getByRole("button", { name: "축소", exact: true }).click();
  await p.waitForTimeout(700);
  assert.ok((await metric(p)) < zoomed * 0.9);
  note("휠 이동량 기반 줌·± 버튼 확대/축소", { base, zoomed });
  await reset(p);
  for (let i = 0; i < 12; i++)
    await p.getByRole("button", { name: "확대", exact: true }).click();
  await p.waitForTimeout(700);
  const near = await metric(p);
  for (let i = 0; i < 4; i++)
    await p.getByRole("button", { name: "확대", exact: true }).click();
  await p.waitForTimeout(700);
  assert.ok(Math.abs((await metric(p)) - near) < 1);
  await p.screenshot({ path: "artifacts/controls/zoom-near.png" });
  for (let i = 0; i < 20; i++)
    await p.getByRole("button", { name: "축소", exact: true }).click();
  await p.waitForTimeout(700);
  const far = await metric(p);
  for (let i = 0; i < 4; i++)
    await p.getByRole("button", { name: "축소", exact: true }).click();
  await p.waitForTimeout(700);
  assert.ok(Math.abs((await metric(p)) - far) < 1);
  assert.ok(near > far * 3);
  await p.screenshot({ path: "artifacts/controls/zoom-far.png" });
  note("최대·최소 줌에서 추가 입력을 제한", { near, far });
  await reset(p);
  await p.evaluate(() => {
    window.__cameraFrames = [];
    let n = 0;
    const sample = () => {
      const b = document
        .querySelector(".cat-label.self")
        .getBoundingClientRect();
      window.__cameraFrames.push([b.x, b.y]);
      if (++n < 45) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await p.getByRole("button", { name: "섬 전체 보기" }).click();
  await p.waitForTimeout(850);
  const count = await p.evaluate(
    () =>
      new Set(
        window.__cameraFrames.map((v) => v.map((n) => n.toFixed(1)).join(",")),
      ).size,
  );
  assert.ok(count > 4);
  await p.getByRole("button", { name: "고양이 따라가기" }).click();
  await p.waitForTimeout(700);
  note("전체/추적 시점은 여러 프레임에 걸쳐 부드럽게 전환", {
    distinctFrames: count,
  });
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.waitForFunction(
    () => document.querySelector("main").dataset.motion === "reduced",
  );
  await p.getByRole("button", { name: "섬 전체 보기" }).click();
  await p.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const still = await label(p);
  await p.waitForTimeout(250);
  assert.ok(delta(still, await label(p)) < 1);
  await p.getByRole("button", { name: "고양이 따라가기" }).click();
  note("동작 줄이기에서는 관성·시점 전환 애니메이션을 생략");
  await p.getByRole("button", { name: "낚시섬으로 가기", exact: true }).click();
  await p.getByLabel("오늘의 할 일", { exact: true }).fill("wasd");
  const idle = await coordinates(p);
  await p.getByLabel("오늘의 할 일", { exact: true }).press("w");
  assert.deepEqual(await coordinates(p), idle);
  await p.locator(".world").click({ position: { x: 720, y: 240 } });
  assert.equal(
    await p.evaluate(() => document.activeElement.className),
    "world",
  );
  await key("keyDown", "KeyD", "ㅇ", 68);
  await p.waitForTimeout(400);
  await key("keyUp", "KeyD", "ㅇ", 68);
  await p.waitForTimeout(250);
  assert.ok(delta(await coordinates(p), idle) > 0.3);
  note("할 일 입력 후 장면을 누르면 물리 WASD로 다시 산책");
  await p.getByRole("button", { name: "자리 고르기", exact: true }).click();
  await p
    .getByRole("button", { name: "1번 의자 · 비어 있음", exact: true })
    .click();
  await p.waitForFunction(
    () => document.querySelector("main").dataset.focus === "active",
  );
  const seated = await coordinates(p);
  await key("keyDown", "KeyW", "ㅈ", 87);
  await p.waitForTimeout(300);
  await key("keyUp", "KeyW", "ㅈ", 87);
  assert.deepEqual(await coordinates(p), seated);
  for (let i = 0; i < 7; i++)
    await p.getByRole("button", { name: "확대", exact: true }).click();
  await p.waitForTimeout(500);
  const inFrame = await label(p);
  assert.ok(
    inFrame[0] > 100 &&
      inFrame[0] < 1340 &&
      inFrame[1] > 200 &&
      inFrame[1] < 750,
  );
  await p.screenshot({ path: "artifacts/controls/fishing-zoom.png" });
  note("의자 집중은 이동 잠금·줌 조작 유지·고양이 구도 유지", { inFrame });
  await p.close();
  const m = await ready({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  const touch = await m.context().newCDPSession(m);
  const event = (type, points) =>
    touch.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
  const mobileStart = await coordinates(m),
    mobileLabel = await label(m);
  await event("touchStart", [
    [105, 330],
    [240, 330],
  ]);
  await event("touchMove", [
    [130, 345],
    [265, 345],
  ]);
  await event("touchMove", [
    [145, 350],
    [280, 350],
  ]);
  await event("touchEnd", []);
  await m.waitForTimeout(300);
  assert.ok(delta(mobileLabel, await label(m)) > 12);
  assert.deepEqual(await coordinates(m), mobileStart);
  await reset(m);
  const mobileBase = await metric(m);
  await event("touchStart", [
    [130, 330],
    [240, 330],
  ]);
  await event("touchMove", [
    [100, 330],
    [270, 330],
  ]);
  await event("touchEnd", []);
  await m.waitForTimeout(300);
  assert.ok((await metric(m)) > mobileBase * 1.15);
  assert.deepEqual(await coordinates(m), mobileStart);
  await m.screenshot({ path: "artifacts/controls/touch-pinch.png" });
  note("실제 두 손가락 이동·핀치 확대, 제스처 종료 후 고양이 제자리");
  for (const width of [320, 375, 768, 1024]) {
    await m.setViewportSize({ width, height: width === 320 ? 568 : 812 });
    await m.waitForTimeout(200);
    const boxes = await m.locator(".camera-tools button").evaluateAll((nodes) =>
      nodes.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    assert.equal(boxes.length, 4);
    assert.ok(
      boxes.every(
        (b) =>
          b.w >= 44 && b.h >= 44 && b.x >= 0 && b.x + b.w <= width && b.y > 180,
      ),
    );
    assert.equal(
      await m.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    const overlaps = await m.evaluate(() => {
      const camera = document
        .querySelector(".camera-tools")
        .getBoundingClientRect();
      return [".island-note", ".bottom-area"].filter((selector) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          camera.x < r.right &&
          r.x < camera.right &&
          camera.y < r.bottom &&
          r.y < camera.bottom
        );
      });
    });
    assert.deepEqual(
      overlaps,
      [],
      `${width}px 카메라 도구가 다른 조작부를 가리지 않는다`,
    );
  }
  note("320/375/768/1024px 카메라 4개 버튼·44px 조작 영역·가로 넘침 없음");
  await m.close();
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/controls/results.json",
    JSON.stringify({ results, errors, target }, null, 2),
  );
  console.log(JSON.stringify({ passed: results.length, errors }));
} catch (e) {
  if (current && !current.isClosed())
    await current.screenshot({ path: "artifacts/controls/failure.png" });
  await writeFile(
    "artifacts/controls/failure.json",
    JSON.stringify({ results, errors, error: String(e) }, null, 2),
  );
  throw e;
} finally {
  await browser.close();
}
