import { returningVisitor } from "./returning-visitor.mjs";
import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4173";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
await mkdir("artifacts/islands", { recursive: true });
const browser = await chromium.launch({
  ...browserOptions,
  args: [...browserOptions.args, "--autoplay-policy=user-gesture-required"],
});
const errors = [],
  external = [],
  results = [];
async function ready(options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  page.on("request", (r) => {
    if (!["127.0.0.1", "localhost"].includes(new URL(r.url()).hostname))
      external.push(r.url());
  });
  await page.addInitScript(() => {
    const Base = window.AudioContext;
    window.__audioProbe = { contexts: [], gains: [], sources: [] };
    window.AudioContext = class extends Base {
      constructor(...args) {
        super(...args);
        window.__audioProbe.contexts.push(this);
      }
      createGain() {
        const n = super.createGain();
        window.__audioProbe.gains.push(n);
        return n;
      }
      createBufferSource() {
        const n = super.createBufferSource();
        window.__audioProbe.sources.push(n);
        return n;
      }
    };
  });
  await returningVisitor(page);
  await page.goto(target);
  await page.waitForFunction(
    () =>
      !document.querySelector(".loading") &&
      document.querySelector(".connection.online"),
  );
  await page
    .getByRole("button", { name: "낚시섬으로 가기", exact: true })
    .waitFor();
  return page;
}
const coords = (p) => p.getByLabel("고양이 위치").textContent();
const clock = async (p) =>
  (await p.getByRole("timer").textContent())
    .split(":")
    .reduce((n, v) => n * 60 + Number(v), 0);
const state = (p, island, focus) =>
  p.waitForFunction(
    ([island, focus]) => {
      const d = document.querySelector("main").dataset;
      return d.island === island && d.focus === focus;
    },
    [island, focus],
  );
async function travel(p) {
  await p.getByRole("button", { name: "낚시섬으로 가기", exact: true }).click();
  await state(p, "focus", "idle");
  await p.getByRole("button", { name: "자리 고르기", exact: true }).waitFor();
}
async function pick(p, n, changing = false) {
  await p
    .getByRole("button", {
      name: changing ? "자리 바꾸기" : "자리 고르기",
      exact: true,
    })
    .click();
  await p
    .getByRole("button", { name: `${n}번 의자 · 비어 있음`, exact: true })
    .click();
  await state(p, "focus", "active");
  await p
    .locator(".focus-caption")
    .getByText(new RegExp(`^${n}번 의자`))
    .waitFor();
}
async function finish(p, touch = false) {
  const button = p.getByRole("button", { name: "종료하기", exact: true });
  if (touch) {
    const box = await button.boundingBox();
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 },
      ],
    });
    await p.getByRole("dialog", { name: "이번 집중 결과" }).waitFor();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await button.focus();
    await p.keyboard.down("Space");
    await p.getByRole("dialog", { name: "이번 집중 결과" }).waitFor();
    await p.keyboard.up("Space");
  }
}
async function gains(p, ambient, focus) {
  await p.waitForFunction(
    ([a, f]) => {
      const g = window.__audioProbe.gains;
      return (
        g.length === 3 &&
        Math.abs(g[1].gain.value - a) < 0.01 &&
        Math.abs(g[2].gain.value - f) < 0.01
      );
    },
    [ambient, focus],
  );
}
try {
  const a = await ready();
  assert.equal(await a.locator("main").getAttribute("data-island"), "home");
  assert.equal(
    await a.getByRole("button", { name: "자리 고르기", exact: true }).count(),
    0,
  );
  assert.equal(
    await a.locator(".sound-status").getAttribute("data-audio-state"),
    "locked",
  );
  await a.getByRole("button", { name: "내 고양이와 설정" }).click();
  await a.getByLabel("섬에서 부를 이름").fill("물가 친구");
  await a.getByRole("button", { name: "이 모습으로 산책하기" }).click();
  await gains(a, 1, 0);
  const sound = await a.evaluate(() => ({
    durations: window.__audioProbe.sources.map((s) => s.buffer.duration),
    loops: window.__audioProbe.sources.map((s) => s.loop),
    state: window.__audioProbe.contexts[0].state,
  }));
  assert.deepEqual(sound.durations, [90, 90]);
  assert.deepEqual(sound.loops, [true, true]);
  assert.equal(sound.state, "running");
  results.push({
    check: "일반 섬 기능과 첫 입력 뒤 기존 숲바람 90초 루프",
    sound,
  });
  const b = await ready({ viewport: { width: 1100, height: 800 } });
  await b.getByText("물가 친구", { exact: true }).waitFor();
  await a.screenshot({ path: "artifacts/islands/home-desktop.png" });
  await travel(a);
  await b
    .getByText("물가 친구", { exact: true })
    .waitFor({ state: "detached" });
  await a.getByText("함께 있는 고양이 1", { exact: true }).waitFor();
  await b.getByText("함께 있는 고양이 1", { exact: true }).waitFor();
  assert.equal(await a.getByRole("button", { name: "섬 둘러보기" }).count(), 0);
  assert.equal(await a.getByRole("timer").count(), 0);
  assert.equal(
    await a.locator(".sound-status").getAttribute("data-audio-mode"),
    "ambient",
  );
  results.push({
    check: "섬 이동만으로 집중하지 않음·서로 다른 섬의 주민과 기능 분리",
    pass: true,
  });
  const beforeInput = await coords(a);
  await a.getByLabel("오늘의 할 일", { exact: true }).fill("책 읽기");
  await a.keyboard.press("ArrowLeft");
  assert.equal(await coords(a), beforeInput);
  await a.screenshot({ path: "artifacts/islands/prepare-desktop.png" });
  await pick(a, 1);
  await gains(a, 0, 1);
  const seated = await coords(a);
  const started = await clock(a);
  await a.waitForFunction((old) => {
    const values = document
      .querySelector(".focus-clock")
      .textContent.split(":")
      .map(Number);
    return values.reduce((n, v) => n * 60 + v, 0) > old;
  }, started);
  await a.locator(".world").focus();
  await a.keyboard.down("w");
  await a.waitForTimeout(450);
  await a.keyboard.up("w");
  assert.equal(await coords(a), seated);
  assert.equal(await a.locator(".focus-subject").textContent(), "책 읽기");
  results.push({
    check: "의자 선택 즉시 낚시 집중·주제·타이머·기존 모닥불 ASMR·오입력 방지",
    pass: true,
  });
  await travel(b);
  await b.getByText("물가 친구", { exact: true }).waitFor();
  await b.getByRole("button", { name: "자리 고르기", exact: true }).click();
  assert.ok(
    await b.getByRole("button", { name: /^1번 의자 · 사용 중/ }).isDisabled(),
  );
  await b
    .getByRole("button", { name: "2번 의자 · 비어 있음", exact: true })
    .click();
  await state(b, "focus", "active");
  await a.getByText("함께 있는 고양이 2", { exact: true }).waitFor();
  results.push({
    check: "같은 낚시섬 주민 공유·의자 중복 선택 방지",
    pass: true,
  });
  await a.getByRole("button", { name: "휴식하기", exact: true }).click();
  await state(a, "home", "paused");
  const pausedTime = await a.getByRole("timer").textContent();
  const restPosition = await coords(a);
  await a.waitForTimeout(1400);
  assert.equal(await a.getByRole("timer").textContent(), pausedTime);
  await a.keyboard.press("d");
  assert.equal(await coords(a), restPosition);
  assert.equal(
    await a.getByRole("button", { name: "종료하기", exact: true }).count(),
    0,
  );
  await b.getByRole("button", { name: "자리 바꾸기", exact: true }).click();
  assert.ok(
    await b.getByRole("button", { name: /^1번 의자 · 휴식 중/ }).isDisabled(),
  );
  await b.getByRole("button", { name: "닫기", exact: true }).click();
  await b
    .getByText("물가 친구", { exact: true })
    .waitFor({ state: "detached" });
  await a.screenshot({ path: "artifacts/islands/rest-desktop.png" });
  results.push({
    check: "모닥불 휴식은 일반 섬으로 이동·시간 정지·낚시 의자 예약 유지",
    pausedTime,
  });
  await a.getByRole("button", { name: "집중 이어가기", exact: true }).click();
  await state(a, "focus", "active");
  assert.equal(await coords(a), seated);
  assert.equal(await a.locator(".focus-subject").textContent(), "책 읽기");
  await a.waitForFunction(
    (old) => document.querySelector(".focus-clock").textContent !== old,
    pausedTime,
  );
  results.push({
    check: "같은 의자·주제·누적 시간으로 집중 이어가기",
    pass: true,
  });
  await a.getByRole("button", { name: "소리 끄기", exact: true }).click();
  const elapsed = await clock(a);
  await pick(a, 3, true);
  assert.ok((await clock(a)) >= elapsed);
  assert.equal(
    await a.locator(".sound-status").getAttribute("data-audio-state"),
    "muted",
  );
  assert.equal(await a.locator(".focus-subject").textContent(), "책 읽기");
  results.push({ check: "자리 변경은 누적·주제·음소거 유지", pass: true });
  const end = a.getByRole("button", { name: "종료하기", exact: true });
  await end.click();
  await a.waitForTimeout(1700);
  assert.equal(await a.locator("main").getAttribute("data-focus"), "active");
  const endBox = await end.boundingBox();
  await a.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await a.mouse.down();
  await a.waitForTimeout(300);
  await a.mouse.move(endBox.x - 20, endBox.y - 20);
  await a.waitForTimeout(1400);
  await a.mouse.up();
  assert.equal(await a.locator("main").getAttribute("data-focus"), "active");
  results.push({
    check: "종료 짧은 클릭·누르다 버튼 이탈은 집중을 끝내지 않음",
    pass: true,
  });
  await finish(a);
  const result = a.getByRole("dialog", { name: "이번 집중 결과" });
  assert.ok((await result.textContent()).includes("책 읽기"));
  assert.equal(await a.locator("main").getAttribute("data-focus"), "idle");
  assert.equal(
    await a.locator(".sound-status").getAttribute("data-audio-state"),
    "muted",
  );
  await a.screenshot({ path: "artifacts/islands/result-desktop.png" });
  await result
    .getByRole("button", { name: "우리 섬으로", exact: true })
    .click();
  await state(a, "home", "idle");
  await a.getByRole("button", { name: "소리 켜기", exact: true }).click();
  await gains(a, 1, 0);
  results.push({
    check: "키보드 1.5초 종료·실제 결과·우리 섬 복귀·숲바람 전환",
    pass: true,
  });
  await finish(b);
  await b
    .getByRole("dialog", { name: "이번 집중 결과" })
    .getByRole("button", { name: "다시 집중하기", exact: true })
    .click();
  await state(b, "focus", "idle");
  assert.equal(await b.getByRole("timer").count(), 0);
  await b.getByRole("button", { name: "우리 섬으로", exact: true }).click();
  await b.close();
  await a.close();
  results.push({
    check: "다시 집중하기는 새 자리 준비로 복귀하며 자동 시작하지 않음",
    pass: true,
  });
  for (const width of [320, 375, 768]) {
    const p = await ready({
      viewport: { width, height: 812 },
      hasTouch: true,
      isMobile: width < 700,
    });
    await p.screenshot({ path: `artifacts/islands/home-${width}.png` });
    await travel(p);
    await p.getByLabel("오늘의 할 일", { exact: true }).fill("모바일 낚시");
    await p.screenshot({ path: `artifacts/islands/prepare-${width}.png` });
    await p.getByRole("button", { name: "자리 고르기", exact: true }).click();
    assert.equal(
      await p.getByRole("button", { name: /번 의자 ·/ }).count(),
      30,
    );
    const layout = await p.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      buttons: [...document.querySelectorAll("dialog[open] button")].map(
        (e) => ({
          width: e.getBoundingClientRect().width,
          height: e.getBoundingClientRect().height,
        }),
      ),
    }));
    assert.ok(layout.scroll <= width);
    assert.ok(layout.buttons.every((b) => b.width >= 43.5 && b.height >= 43.5));
    await p.screenshot({ path: `artifacts/islands/seats-${width}.png` });
    await p
      .getByRole("button", { name: "30번 의자 · 비어 있음", exact: true })
      .click();
    await state(p, "focus", "active");
    await p.screenshot({ path: `artifacts/islands/fishing-${width}.png` });
    if (width === 375) {
      for (const n of [1, 8, 16, 24]) {
        await pick(p, n, true);
        await p.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await p.screenshot({ path: `artifacts/islands/fishing-seat-${n}.png` });
      }
    }
    await p.getByRole("button", { name: "휴식하기", exact: true }).click();
    await state(p, "home", "paused");
    await p.screenshot({ path: `artifacts/islands/rest-${width}.png` });
    await p.getByRole("button", { name: "집중 이어가기", exact: true }).click();
    await state(p, "focus", "active");
    await finish(p, width < 700);
    await p.screenshot({ path: `artifacts/islands/result-${width}.png` });
    await p
      .getByRole("dialog", { name: "이번 집중 결과" })
      .getByRole("button", { name: "우리 섬으로", exact: true })
      .click();
    await state(p, "home", "idle");
    await p.close();
    results.push({
      check: `${width}px 두 섬·30석·44px·휴식/이어가기·길게 눌러 종료`,
      layout,
    });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    "artifacts/focus-results.json",
    JSON.stringify({ results, errors, external }, null, 2),
  );
  console.log(
    JSON.stringify({ passed: results.length, errors, external }, null, 2),
  );
} finally {
  await browser.close();
}
