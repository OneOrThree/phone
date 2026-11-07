// 낚시섬 집중 친구·이름표·물고기 낚기 연출을 실제 Chromium(Metal)으로 보고 캡처한다.
// 시간은 주입하지 않고 실제 박자를 따른다: 집중 친구 「보리」는 섬에 들어서고 2.5초 뒤,
// 내 고양이는 앉은 지 7초 뒤 입질이 오고 3.25~4.35초 동안 물고기를 들어 구경한다.
//   CATTUS_QA_URL=http://127.0.0.1:4188 node tests/fishing-qa.mjs
import { returningVisitor } from "./returning-visitor.mjs";
import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";

const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4188";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
const out = process.env.CATTUS_QA_OUT || "artifacts/fishing-local";
await mkdir(`${out}/frames`, { recursive: true });
await mkdir(`${out}/video`, { recursive: true });
const browser = await chromium.launch(browserOptions);
const results = [],
  errors = [],
  external = [];
const note = (check, detail = {}) => {
  results.push({ check, ...detail });
  console.log(check, Object.keys(detail).length ? detail : "");
};
const WALKERS = ["구름", "모카", "안내 고양이"];
const SITTERS = ["까미", "단비", "보리"];
const friendLabels = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll(".cat-label:not(.self)")]
      .map((e) => e.textContent)
      .sort(),
  );
const state = (p, key, value) =>
  p.waitForFunction(
    ([k, v]) => document.querySelector("main")?.dataset[k] === v,
    [key, value],
  );
async function open(options = {}, video = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
    ...(video
      ? {
          recordVideo: {
            dir: `${out}/video`,
            size: options.viewport ?? { width: 1440, height: 1000 },
          },
        }
      : {}),
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  page.on("request", (r) => {
    if (!["127.0.0.1", "localhost"].includes(new URL(r.url()).hostname))
      external.push(r.url());
  });
  await returningVisitor(page);
  await page.goto(target);
  await page.waitForFunction(
    () =>
      !document.querySelector(".loading") &&
      document.querySelector(".connection.online"),
  );
  return page;
}
async function travel(p) {
  await p.getByRole("button", { name: "낚시섬으로 가기", exact: true }).click();
  await state(p, "island", "focus");
  return Date.now();
}
async function sit(p, n) {
  await p.getByRole("button", { name: "자리 고르기", exact: true }).click();
  await p
    .getByRole("button", { name: `${n}번 의자 · 비어 있음`, exact: true })
    .click();
  await state(p, "focus", "active");
  return Date.now();
}
const until = (p, t0, seconds) =>
  p.waitForTimeout(Math.max(0, t0 + seconds * 1000 - Date.now()));
// 같은 화면 영역을 시간차를 두고 두 번 찍어 바뀐 픽셀 비율을 잰다.
async function changed(p, clip, gapMs) {
  const a = await p.screenshot({ clip });
  await p.waitForTimeout(gapMs);
  const b = await p.screenshot({ clip });
  return p.evaluate(
    async ([x, y]) => {
      const load = (b64) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const c = document.createElement("canvas");
      c.width = ia.width;
      c.height = ia.height;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(ia, 0, 0);
      const da = g.getImageData(0, 0, c.width, c.height).data;
      g.drawImage(ib, 0, 0);
      const db = g.getImageData(0, 0, c.width, c.height).data;
      let diff = 0;
      for (let i = 0; i < da.length; i += 4)
        if (
          Math.abs(da[i] - db[i]) +
            Math.abs(da[i + 1] - db[i + 1]) +
            Math.abs(da[i + 2] - db[i + 2]) >
          24
        )
          diff++;
      return diff / (da.length / 4);
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

try {
  // ---- PC: 이름표 → 집중 친구 어획 → 내 어획 → 동작 줄이기 → 휴식 ----
  const p = await open({}, true);
  assert.deepEqual(await friendLabels(p), WALKERS);
  note("일반 섬: 산책 친구 3마리 이름표는 이름만 보인다", {
    labels: await friendLabels(p),
  });
  const arrived = await travel(p);
  assert.deepEqual(await friendLabels(p), [...WALKERS, ...SITTERS].sort());
  await p.getByText("함께 있는 고양이 1", { exact: true }).waitFor();
  await p.getByText("낚시 의자 0/30", { exact: true }).waitFor();
  await p.screenshot({ path: `${out}/01-pc-focus-arrive.png` });
  // 「섬 전체」에서 작은 섬 친구 셋과 물가 의자 30개를 함께 본다.
  await p.getByRole("button", { name: "섬 전체 보기", exact: true }).click();
  await until(p, arrived, 1.6);
  await p.screenshot({ path: `${out}/02-pc-overview-friends.png` });
  await p.getByRole("button", { name: "고양이 따라가기", exact: true }).click();
  // 보리(남쪽을 보는 친구)가 물고기를 들어 구경하는 순간
  await until(p, arrived, 6.0);
  await p.screenshot({ path: `${out}/03-pc-friend-catch.png` });
  note("낚시섬: 산책 친구 3 + 집중 친구 3 이름표, 인원·의자에 포함 안 됨", {
    labels: await friendLabels(p),
  });

  const sat = await sit(p, 1);
  await p.getByText("낚시 의자 1/30", { exact: true }).waitFor();
  // 입질(7.0) → 끌어올리기(9.15) → 구경(10.25~11.35) → 양동이(11.35~12.8) → 다시 던지기
  const frames = [];
  for (let k = 0; k < 30; k++) {
    await until(p, sat, 6.6 + k * 0.3);
    const file = `${out}/frames/pc-${String(k).padStart(2, "0")}.png`;
    await p.screenshot({ path: file });
    frames.push({ file, at: +((Date.now() - sat) / 1000).toFixed(2) });
  }
  note("내 고양이 첫 어획 장면 프레임 30장", {
    from: frames[0].at,
    to: frames.at(-1).at,
  });
  // 두 번째 어획 전 대기: 찌만 둥실거리고 물고기는 없다.
  await until(p, sat, 16);
  await p.screenshot({ path: `${out}/05-pc-waiting.png` });

  // 동작 줄이기: 정적인 착석 낚시 자세, 내 고양이 둘레가 움직이지 않는다.
  await p.emulateMedia({ reducedMotion: "reduce" });
  await state(p, "motion", "reduced");
  const box = { x: 520, y: 260, width: 420, height: 420 };
  const still = await changed(p, box, 2500);
  await p.screenshot({ path: `${out}/06-pc-reduced.png` });
  note("동작 줄이기에서는 의자 낚시 장면이 멈춘다", { changedRatio: still });
  assert.ok(still < 0.002, `동작 줄이기 변화 ${still}`);
  await p.emulateMedia({ reducedMotion: "no-preference" });
  await p.waitForFunction(
    () => document.querySelector("main")?.dataset.motion !== "reduced",
  );

  // 휴식: 일반 섬 모닥불로 가면 집중 친구·물고기가 남지 않는다.
  await p.getByRole("button", { name: "휴식하기", exact: true }).click();
  await state(p, "island", "home");
  await p.waitForTimeout(800);
  assert.deepEqual(await friendLabels(p), WALKERS);
  await p.screenshot({ path: `${out}/07-pc-rest-home.png` });
  note(
    "휴식으로 일반 섬에 가면 집중 친구 이름표가 사라지고 산책 친구만 남는다",
  );
  const video = p.video();
  await p.context().close();
  if (video) await rename(await video.path(), `${out}/video/pc-fishing.webm`);

  // ---- 모바일 390×844: 이름표와 내 어획 ----
  const m = await open({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await travel(m);
  assert.deepEqual(await friendLabels(m), [...WALKERS, ...SITTERS].sort());
  await m.screenshot({ path: `${out}/08-mobile-focus-arrive.png` });
  const msat = await sit(m, 16);
  for (const [name, at] of [
    ["09-mobile-bite", 7.6],
    ["10-mobile-catch", 10.6],
    ["11-mobile-bucket", 12.0],
  ]) {
    await until(m, msat, at);
    await m.screenshot({ path: `${out}/${name}.png` });
  }
  note("모바일 390px: 이름표·집중 친구·내 어획 캡처");
  await m.context().close();

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  note("콘솔 오류 0, 외부 요청 0");
  await writeFile(
    `${out}/results.json`,
    JSON.stringify({ target, results, frames, errors, external }, null, 2),
  );
} finally {
  await browser.close();
}
