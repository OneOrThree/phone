import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4176";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname))
  throw new Error("로컬 주소에서만 검토할 수 있어요");
const browser = await chromium.launch(browserOptions);
const results = [],
  errors = [];
const note = (check) => {
  results.push(check);
  console.log(check);
};
async function open(options = {}, init) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  if (init) await page.addInitScript(init);
  return page;
}
const welcome = (p) => p.getByRole("dialog", { name: "섬에 온 걸 환영해요" });
async function join(page, name) {
  await page.getByLabel("섬에서 부를 이름").fill(name);
  await page.getByRole("button", { name: "이 이름으로 섬에 들어가기" }).click();
  await page.locator(".connection.online").waitFor();
  await page.waitForFunction(() => !document.querySelector(".loading"));
}
try {
  await mkdir("artifacts/welcome", { recursive: true });
  const p = await open();
  let connections = 0;
  p.on("websocket", () => connections++);
  await p.goto(target);
  await welcome(p).waitFor();
  await p.waitForFunction(() => !document.querySelector(".loading"));
  assert.equal(connections, 0);
  assert.equal(await p.locator(".connection.online").count(), 0);
  assert.ok(
    await p
      .getByRole("button", { name: "이 이름으로 섬에 들어가기" })
      .isDisabled(),
  );
  await p.keyboard.press("Escape");
  assert.ok(await welcome(p).isVisible());
  const position = await p.locator(".coordinates").textContent();
  await p.getByLabel("섬에서 부를 이름").fill("   ");
  await p.keyboard.press("Enter");
  await p.keyboard.down("w");
  await p.waitForTimeout(300);
  await p.keyboard.up("w");
  assert.equal(await p.locator(".coordinates").textContent(), position);
  assert.equal(connections, 0);
  await p.getByLabel("섬에서 부를 이름").fill("");
  await p.screenshot({ path: "artifacts/welcome/first-visit-desktop.png" });
  note(
    "첫 방문은 이름 입력 전 연결·이동·빈 이름 입장·Escape 건너뛰기를 막는다",
  );

  await p.getByRole("button", { name: "회색 고양이", exact: true }).click();
  await join(p, "  물가 친구  ");
  assert.equal(connections, 1);
  assert.equal(await welcome(p).count(), 0);
  assert.equal(
    await p.locator(".cat-label.self").textContent(),
    "물가 친구 · 나",
  );
  assert.deepEqual(
    await p.evaluate(() =>
      JSON.parse(localStorage.getItem("cattus-island-profile-v1")),
    ),
    { name: "물가 친구", color: "gray" },
  );
  await p.getByText("함께 있는 고양이 1", { exact: true }).waitFor();
  assert.equal(
    await p.locator(".cat-label").filter({ hasText: "· 봇" }).count(),
    3,
  );
  await p.getByText("낚시 의자 0/30", { exact: true }).waitFor();
  await p.screenshot({ path: "artifacts/welcome/companions-home.png" });
  note("이름·털색으로 입장하며 봇 3마리는 인원·낚시 좌석에 포함되지 않는다");

  await p.reload();
  await p.locator(".connection.online").waitFor();
  assert.equal(await welcome(p).count(), 0);
  await p.getByRole("button", { name: "내 고양이와 설정" }).click();
  assert.equal(
    await p.getByLabel("섬에서 부를 이름").inputValue(),
    "물가 친구",
  );
  assert.equal(
    await p
      .getByRole("button", { name: "회색 고양이", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await p.getByLabel("섬에서 부를 이름").fill("밤산책");
  await p.getByRole("button", { name: "검정 고양이", exact: true }).click();
  await p.getByRole("button", { name: "이 모습으로 산책하기" }).click();
  await p.reload();
  await p.locator(".connection.online").waitFor();
  await p.waitForFunction(
    () =>
      document.querySelector(".cat-label.self")?.textContent === "밤산책 · 나",
  );
  assert.deepEqual(
    await p.evaluate(() =>
      JSON.parse(localStorage.getItem("cattus-island-profile-v1")),
    ),
    { name: "밤산책", color: "black" },
  );
  note(
    "재방문은 저장한 모습으로 바로 입장하고 설정 변경도 다음 방문에 유지한다",
  );

  await p.getByRole("button", { name: "낚시섬으로 가기", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("main").dataset.island === "focus",
  );
  assert.equal(
    await p.locator(".cat-label").filter({ hasText: "· 봇" }).count(),
    3,
  );
  await p.getByRole("button", { name: "자리 고르기", exact: true }).click();
  assert.equal(
    await p.getByRole("button", { name: /번 의자 · 비어 있음/ }).count(),
    30,
  );
  await p
    .getByRole("button", { name: "1번 의자 · 비어 있음", exact: true })
    .click();
  await p.waitForFunction(
    () => document.querySelector("main").dataset.focus === "active",
  );
  await p.screenshot({ path: "artifacts/welcome/companions-focus.png" });
  note("낚시섬에서도 봇을 구분하고 30개 의자를 모두 이용할 수 있다");
  await p.close();

  const mobile = await open({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobile.goto(target);
  await welcome(mobile).waitFor();
  const box = await welcome(mobile).boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.x + box.width <= 390 &&
      box.y >= 0 &&
      box.y + box.height <= 844,
  );
  await mobile.screenshot({ path: "artifacts/welcome/first-visit-mobile.png" });
  await join(mobile, "새 친구");
  await mobile.close();
  note("처음 온 다른 브라우저와 모바일에서도 이름 입력 후 입장한다");

  const corrupt = await open({}, () =>
    localStorage.setItem("cattus-island-profile-v1", "{bad"),
  );
  await corrupt.goto(target);
  await welcome(corrupt).waitFor();
  await join(corrupt, "다시 온 친구");
  await corrupt.close();
  const denied = await open({}, () =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    }),
  );
  await denied.goto(target);
  await welcome(denied).waitFor();
  await join(denied, "잠깐 온 친구");
  await denied
    .locator(".status-line")
    .getByText(
      "이번 방문은 이 이름으로 함께해요. 브라우저에서 이름을 기억할 수는 없어요.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await denied.locator(".cat-label.self").textContent(),
    "잠깐 온 친구 · 나",
  );
  await denied.close();
  note("저장값 손상·저장소 차단 때도 다시 이름을 정해 입장한다");
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/welcome/results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
} finally {
  await browser.close();
}
