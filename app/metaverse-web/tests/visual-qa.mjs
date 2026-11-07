import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import { WebSocket } from "ws";
import { PerspectiveCamera, Vector3 } from "three";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
const url = new URL(target);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
await mkdir("artifacts/islands", { recursive: true });
const browser = await chromium.launch(browserOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  results = [],
  peers = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (e) => {
  if (e.type() === "error") errors.push(e.text());
});
const state = (island, focus) =>
  page.waitForFunction(
    ([island, focus]) => {
      const d = document.querySelector("main").dataset;
      return d.island === island && d.focus === focus;
    },
    [island, focus],
  );
const project = (position, cameraPosition, cameraTarget) => {
  const c = new PerspectiveCamera(38, 1440 / 1000, 0.1, 400);
  c.position.set(...cameraPosition);
  c.lookAt(...cameraTarget);
  c.updateMatrixWorld();
  const p = new Vector3(...position).project(c);
  return { x: (p.x * 0.5 + 0.5) * 1440, y: (-p.y * 0.5 + 0.5) * 1000 };
};
async function motion(clip, name) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(
    () => document.querySelector("main").dataset.motion === "full",
  );
  const a = await page.screenshot({
    clip,
    path: `artifacts/islands/${name}-moving-a.png`,
  });
  await page.waitForTimeout(850);
  const b = await page.screenshot({
    clip,
    path: `artifacts/islands/${name}-moving-b.png`,
  });
  assert.ok(!a.equals(b), `${name} 수면이 시간에 따라 변해야 한다`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () => document.querySelector("main").dataset.motion === "reduced",
  );
  await page.waitForTimeout(300);
  const c = await page.screenshot({
    clip,
    path: `artifacts/islands/${name}-reduced-a.png`,
  });
  await page.waitForTimeout(850);
  const d = await page.screenshot({
    clip,
    path: `artifacts/islands/${name}-reduced-b.png`,
  });
  assert.ok(c.equals(d), `${name} 수면이 동작 줄이기에서 정지해야 한다`);
  results.push({
    check: `${name} 실제 수면 픽셀 변화·동작 줄이기 정지`,
    pass: true,
  });
}
let requestSequence = 0;
async function command(ws, type, params = {}) {
  const requestId = `visual-${++requestSequence}`;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", receive);
      ws.off("error", fail);
    };
    const fail = (e) => {
      cleanup();
      reject(e);
    };
    const timer = setTimeout(
      () => fail(new Error(`${type} 로컬 응답 지연`)),
      10000,
    );
    const receive = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type !== "command-result" || m.requestId !== requestId) return;
      cleanup();
      m.ok ? resolve(m) : reject(new Error(m.reason));
    };
    ws.on("message", receive);
    ws.on("error", fail);
    ws.send(JSON.stringify({ type, requestId, ...params }));
  });
}
try {
  await page.goto(target);
  await page.waitForFunction(
    () =>
      !document.querySelector(".loading") &&
      document.querySelector(".connection.online"),
  );
  await page.screenshot({ path: "artifacts/islands/final-home-walk.png" });
  await page
    .getByRole("button", { name: "낚시섬으로 가기", exact: true })
    .click();
  await state("focus", "idle");
  await page.waitForTimeout(400);
  // 낚시섬에 도착한 실제 추적 시점에서 첫 의자의 좌판을 눌러 raycast 경로를 검증한다.
  const angle = Math.PI / 30;
  const pixel = project(
    [Math.sin(angle) * 13.2, 0.8, Math.cos(angle) * 13.2],
    [0, 10.8, 33.2],
    [0, 0.65, 17.2],
  );
  await page.mouse.move(pixel.x, pixel.y);
  await page
    .locator(".scene-labels .place-label")
    .filter({ hasText: /(?:^|\s)1번 낚시 의자.*비어 있음/ })
    .waitFor();
  await page.mouse.click(pixel.x, pixel.y);
  await state("focus", "active");
  await page
    .locator(".focus-caption")
    .getByText(/^1번 의자/)
    .waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "artifacts/islands/direct-chair-fishing.png" });
  results.push({
    check: "물가 3D 의자 직접 hover·클릭으로 즉시 앉아서 낚시 집중",
    pixel,
  });
  const end = page.getByRole("button", { name: "종료하기", exact: true });
  await end.focus();
  await page.keyboard.down("Space");
  const result = page.getByRole("dialog", { name: "이번 집중 결과" });
  await result.waitFor();
  await page.keyboard.up("Space");
  await result
    .getByRole("button", { name: "우리 섬으로", exact: true })
    .click();
  await state("home", "idle");
  await page.getByRole("button", { name: "섬 전체 보기" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/islands/final-home-overview.png" });
  await motion({ x: 1080, y: 185, width: 240, height: 80 }, "sea");
  // 로컬 기능 검증용 주민 29명. AWS·외부 서버에는 접속하지 않는다.
  for (let i = 0; i < 29; i++) {
    const ws = new WebSocket(
      `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/island-room`,
      { origin: url.origin },
    );
    peers.push(ws);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("로컬 연결 지연")),
        10000,
      );
      ws.once("error", reject);
      const receive = (raw) => {
        if (JSON.parse(raw.toString()).type !== "welcome") return;
        clearTimeout(timer);
        ws.off("message", receive);
        ws.off("error", reject);
        resolve();
      };
      ws.on("message", receive);
    });
    const arrival = await command(ws, "travel", { island: "focus" });
    ws.send(
      JSON.stringify({
        type: "move",
        actor: {
          ...arrival.actor,
          name: `낚시 고양이 ${i + 1}`,
          color: ["cream", "peach", "gray", "black", "white", "brown"][i % 6],
        },
      }),
    );
    await command(ws, "claim-seat", { seatId: i, subject: "로컬 낚시 검토" });
  }
  await page.getByText("낚시 의자 29/30", { exact: true }).waitFor();
  assert.equal(await page.locator(".cat-label").count(), 2);
  results.push({
    check: "일반 섬에 다른 낚시섬 주민을 그리지 않음",
    pass: true,
  });
  await page
    .getByRole("button", { name: "낚시섬으로 가기", exact: true })
    .click();
  await state("focus", "idle");
  await page.getByRole("button", { name: "자리 고르기", exact: true }).click();
  await page
    .getByRole("button", { name: "30번 의자 · 비어 있음", exact: true })
    .click();
  await state("focus", "active");
  await page.getByText("낚시 의자 30/30", { exact: true }).waitFor();
  assert.equal(await page.locator(".cat-label").count(), 31);
  await page.screenshot({ path: "artifacts/islands/thirty-fishing-close.png" });
  await page.getByRole("button", { name: "자리 바꾸기", exact: true }).click();
  await page.getByText(/지금은 낚시 의자 30개가 모두 사용 중/).waitFor();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /번 의자 ·/ })
      .count(),
    30,
  );
  assert.equal(
    await page
      .getByRole("dialog")
      .locator("button[aria-pressed]")
      .evaluateAll((nodes) => nodes.filter((n) => !n.disabled).length),
    0,
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "섬 전체 보기" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "artifacts/islands/thirty-fishing-overview.png",
  });
  const pond = project([3, 0, 3], [30, 48, 56], [0, 0, 1]);
  await motion(
    {
      x: Math.round(pond.x) - 35,
      y: Math.round(pond.y) - 15,
      width: 70,
      height: 30,
    },
    "pond",
  );
  await page.getByRole("button", { name: "휴식하기", exact: true }).click();
  await state("home", "paused");
  assert.equal(await page.locator(".cat-label").count(), 2);
  await page.getByText("낚시 의자 30/30", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/islands/thirty-reserved-home-rest.png",
  });
  results.push({
    check: "로컬 29명+브라우저 1명 30석 낚시·만석 안내·휴식 중 예약 및 섬 분리",
    pass: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/visual-results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: "artifacts/islands/visual-failure.png" });
  throw error;
} finally {
  for (const ws of peers) ws.terminate();
  await browser.close();
}
