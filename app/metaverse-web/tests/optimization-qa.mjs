import { returningVisitor } from "./returning-visitor.mjs";
import { chromium } from "playwright";
import { browserOptions } from "./browser-options.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const target = process.env.CATTUS_QA_URL || "http://127.0.0.1:4176";
if (!["localhost", "127.0.0.1"].includes(new URL(target).hostname))
  throw new Error("로컬 최적화 검사만 허용");
const b = await chromium.launch(browserOptions);
const errors = [];
try {
  const p = await b.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => {
    window.__qa = { draws: 0, moves: 0 };
    for (const cls of [WebGLRenderingContext, WebGL2RenderingContext])
      for (const name of [
        "drawArrays",
        "drawElements",
        "drawArraysInstanced",
        "drawElementsInstanced",
      ]) {
        const original = cls.prototype[name];
        if (!original) continue;
        cls.prototype[name] = function (...args) {
          window.__qa.draws++;
          return original.apply(this, args);
        };
      }
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.includes('"type":"move"'))
        window.__qa.moves++;
      return send.call(this, data);
    };
  });
  await returningVisitor(p);
  await p.goto(target);
  await p.waitForFunction(
    () =>
      !document.querySelector(".loading") &&
      document.querySelector(".connection.online"),
  );
  await p.waitForTimeout(400);
  const initial = await p.evaluate(() => ({ ...window.__qa }));
  await p.waitForTimeout(1000);
  const active = await p.evaluate(() => ({ ...window.__qa }));
  assert.ok(active.draws > initial.draws);
  assert.equal(active.moves, initial.moves);
  await p.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await p.waitForTimeout(200);
  const hiddenStart = await p.evaluate(() => window.__qa.draws);
  await p.waitForTimeout(600);
  const hiddenEnd = await p.evaluate(() => window.__qa.draws);
  assert.equal(hiddenEnd, hiddenStart);
  await p.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await p.waitForTimeout(300);
  assert.ok((await p.evaluate(() => window.__qa.draws)) > hiddenEnd);
  const manifest = JSON.parse(
    await readFile("artifacts/optimized-preview/.vite/manifest.json", "utf8"),
  );
  const entry = Object.entries(manifest).find(([, v]) => v.isEntry)[0];
  const initialKeys = new Set();
  function visit(k) {
    if (initialKeys.has(k)) return;
    initialKeys.add(k);
    for (const i of manifest[k].imports || []) visit(i);
  }
  visit(entry);
  const chunks = await Promise.all(
    [...initialKeys].map(async (k) => {
      const item = manifest[k];
      const raw = await readFile("artifacts/optimized-preview/" + item.file);
      return { file: item.file, bytes: raw.length, gzip: gzipSync(raw).length };
    }),
  );
  const before = await readFile("artifacts/optimization/before.js");
  const total = chunks.reduce((n, c) => n + c.bytes, 0);
  assert.ok(total < before.length * 0.3);
  assert.deepEqual(errors, []);
  await mkdir("artifacts/optimization", { recursive: true });
  const result = {
    beforeInitialJs: before.length,
    beforeInitialGzip: gzipSync(before).length,
    afterInitialJs: total,
    afterInitialGzip: chunks.reduce((n, c) => n + c.gzip, 0),
    chunks,
    idleMoveMessages: active.moves - initial.moves,
    hiddenDrawCalls: hiddenEnd - hiddenStart,
    visibilityMethod:
      "document.hidden + visibilitychange 경로를 직접 전환한 로컬 회귀 검사",
    errors,
  };
  await writeFile(
    "artifacts/optimization/results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await b.close();
}
