// 에셋 검토 화면 캡처. 로컬 개발 서버의 검토 화면만 연다(운영·외부 주소 금지).
//   node src/assets3d/preview/capture.mjs [view,view...] [출력폴더]
// 기본 주소 http://127.0.0.1:4173, CATTUS_PREVIEW_URL로 바꿀 수 있다.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { browserOptions } from "../../../tests/browser-options.mjs";

const base = new URL(process.env.CATTUS_PREVIEW_URL || "http://127.0.0.1:4173");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error("로컬 주소에서만 캡처할 수 있어요");
const views = (
  process.argv[2] ||
  "focus,pond,seat,fishing,bank,all30,waterfall,stream,shelter,gramophone,focusdock,island,plaza,campfire,dock"
).split(",");
const out = process.argv[3] || "artifacts/island-split-assets";
await mkdir(out, { recursive: true });
const browser = await chromium.launch(browserOptions);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (e) => {
  if (e.type() === "error" || e.type() === "warning")
    errors.push(`${e.type()}: ${e.text()}`);
});
const results = [];
for (const entry of views) {
  const [view, ...extra] = entry.split("&");
  const url = new URL("/src/assets3d/preview/index.html", base);
  url.searchParams.set("view", view);
  for (const kv of extra) {
    const [k, v] = kv.split("=");
    url.searchParams.set(k, v);
  }
  const started = Date.now();
  await page.goto(url.href);
  await page.waitForSelector("#preview-ready");
  await page.waitForTimeout(2200);
  const name = entry.replace(/[&=,]/g, "-");
  const first = await page.screenshot({ path: `${out}/${name}.png` });
  // CAPTURE_COMPARE=1: 0.9초 뒤 한 장 더 찍어 화면이 움직이는지(동작 줄이기면 멈춰야 한다) 본다.
  let moving;
  if (process.env.CAPTURE_COMPARE) {
    await page.waitForTimeout(900);
    const second = await page.screenshot();
    moving = !first.equals(second);
  }
  results.push({ view: entry, ms: Date.now() - started, moving });
}
await writeFile(
  `${out}/capture-results.json`,
  JSON.stringify({ results, errors }, null, 2),
);
console.log(JSON.stringify({ results, errors: errors.slice(0, 20) }, null, 2));
await browser.close();
