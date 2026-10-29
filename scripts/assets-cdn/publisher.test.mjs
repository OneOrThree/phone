import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildRelease } from "./build.mjs";
import { serveRelease } from "./serve.mjs";
import { publishRelease } from "./publish.mjs";
import { getVerified } from "./verify.mjs";
import {
  digest,
  canonical,
  immutableCache,
  png,
  validateManifest,
} from "./core.mjs";
const repo = path.resolve(import.meta.dirname, "../..");
async function fixture(t) {
  const out = await mkdtemp(path.join(tmpdir(), "cdn-test-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  return {
    out,
    ...(await buildRelease({ repo, out, releaseId: "test-release" })),
  };
}
function storage() {
  const entries = new Map(),
    calls = [];
  let failKey = null;
  return {
    entries,
    calls,
    setFail: (key) => {
      failKey = key;
    },
    aws: async (args) => {
      const key = args[args.indexOf("--key") + 1];
      calls.push({ op: args[1], key, args });
      if (key === failKey) throw Error("(PreconditionFailed)");
      if (args[1] === "get-object") {
        const item = entries.get(key);
        if (!item) throw Error("(NoSuchKey)");
        await writeFile(args.at(-1), item.body);
        return {
          ETag: item.etag,
          ContentType: item.type,
          CacheControl: item.cache,
        };
      }
      const existing = entries.get(key);
      if (args.includes("--if-none-match") && existing)
        throw Error("(PreconditionFailed)");
      if (
        args.includes("--if-match") &&
        existing?.etag !== args[args.indexOf("--if-match") + 1]
      )
        throw Error("(PreconditionFailed)");
      const body = await readFile(args[args.indexOf("--body") + 1]);
      entries.set(key, {
        body,
        etag: `"${digest(body)}"`,
        type: args[args.indexOf("--content-type") + 1],
        cache: args[args.indexOf("--cache-control") + 1],
      });
      return {};
    },
    fetcher: async (url) => {
      const item = entries.get(new URL(url).pathname.slice(1));
      return new Response(item?.body, {
        status: item ? 200 : 404,
        headers: {
          "Content-Type": item?.type ?? "text/plain",
          "Cache-Control": item?.cache ?? "no-store",
        },
      });
    },
  };
}
const options = (f, s) => ({
  directory: f.out,
  releaseId: "test-release",
  environment: "dev",
  bucket: "test-assets-bucket",
  base: "https://cdn.example.com",
  aws: s.aws,
  fetcher: s.fetcher,
});
test("실제 회관 재현 빌드와 localhost GET/304", async (t) => {
  const f = await fixture(t);
  const second = await buildRelease({
    repo,
    out: f.out,
    releaseId: "test-release",
  });
  assert.deepEqual([...f.objects], [...second.objects]);
  const server = await serveRelease({
    directory: f.out,
    releaseId: "test-release",
    port: 0,
  });
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const file = f.manifest.packs["interior-hall"].files.background;
  await getVerified({ base, key: file.path, ...file, local: true });
  const first = await fetch(`${base}/channels/dev/1.json`);
  assert.equal(first.headers.get("cache-control"), "public, max-age=60");
  await first.arrayBuffer();
  const next = await fetch(`${base}/channels/dev/1.json`, {
    headers: { "If-None-Match": first.headers.get("etag") },
  });
  assert.equal(next.status, 304);
  assert.equal((await fetch(`${base}/%2e%2e/secret`)).status, 404);
});
test("PNG signature와 해상도 제한 및 manifest digest", () => {
  assert.throws(() => png(Buffer.alloc(33)));
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(4097, 16);
  b.writeUInt32BE(1, 20);
  assert.throws(() => png(b));
  assert.throws(() =>
    validateManifest({
      schemaVersion: 1,
      assetApiVersion: 1,
      releaseId: "x",
      packs: { x: { version: "x", files: {} } },
    }),
  );
});
test("최초 승격, 동일 객체 재검증 및 롤백 generation 증가", async (t) => {
  const f = await fixture(t),
    s = storage();
  const one = await publishRelease(options(f, s));
  assert.equal(one.generation, 1);
  assert.equal(s.calls.at(-1).key, "channels/dev/1.json");
  const two = await publishRelease(options(f, s));
  assert.equal(two.generation, 2);
  const before = s.calls.length;
  const rollback = await publishRelease({ ...options(f, s), rollback: true });
  assert.equal(rollback.generation, 3);
  assert.equal(
    s.calls.slice(before).filter((c) => c.op === "put-object").length,
    1,
  );
});
test("업로드 실패/CAS 경쟁은 포인터를 바꾸지 않으며 재시도하지 않음", async (t) => {
  const f = await fixture(t),
    s = storage();
  s.setFail([...f.objects.keys()][0]);
  await assert.rejects(publishRelease(options(f, s)));
  assert.equal(s.entries.has("channels/dev/1.json"), false);
  s.setFail(null);
  await publishRelease(options(f, s));
  const previous = s.entries.get("channels/dev/1.json");
  s.setFail("channels/dev/1.json");
  const start = s.calls.length;
  await assert.rejects(publishRelease(options(f, s)));
  assert.equal(s.entries.get("channels/dev/1.json"), previous);
  assert.equal(
    s.calls.slice(start).filter((c) => c.key === "channels/dev/1.json").length,
    1,
  );
});
test("최종 CAS 실패는 새 ETag로 재시도하지 않음", async (t) => {
  const f = await fixture(t),
    s = storage();
  await publishRelease(options(f, s));
  let puts = 0;
  await assert.rejects(
    publishRelease({
      ...options(f, s),
      aws: (args) => {
        if (args[1] === "put-object" && args.includes("channels/dev/1.json")) {
          puts++;
          throw Error("(PreconditionFailed)");
        }
        return s.aws(args);
      },
    }),
  );
  assert.equal(puts, 1);
});
test("이미 존재하는 immutable 객체 변조를 거부", async (t) => {
  const f = await fixture(t),
    s = storage();
  await publishRelease(options(f, s));
  const file = s.entries.get([...f.objects.keys()][0]);
  file.body = Buffer.from("broken");
  await assert.rejects(publishRelease(options(f, s)), /불변 객체/);
});
test("CDN 헤더/redirect/과대/해시 실패 모두 채널 공개 차단", async (t) => {
  const f = await fixture(t);
  for (const mode of ["headers", "redirect", "oversize", "hash"]) {
    const s = storage();
    const fetcher = async (url, args) => {
      assert.equal(args.redirect, "error");
      const original = await s.fetcher(url);
      if (mode === "redirect") return { status: 200, redirected: true };
      if (mode === "headers")
        original.headers.set("cache-control", "public, max-age=60");
      if (mode === "oversize")
        return new Response(Buffer.alloc(3 * 1024 ** 2), {
          headers: original.headers,
        });
      if (mode === "hash") {
        const body = Buffer.from(await original.arrayBuffer());
        body[0] ^= 1;
        return new Response(body, { headers: original.headers });
      }
      return original;
    };
    await assert.rejects(publishRelease({ ...options(f, s), fetcher }));
    assert.equal(s.entries.has("channels/dev/1.json"), false);
  }
});
test("이전 releaseId 롤백도 새 generation을 발행", async (t) => {
  const f = await fixture(t),
    s = storage();
  await publishRelease(options(f, s));
  const old = { ...f.manifest, releaseId: "previous-release" };
  const body = Buffer.from(canonical(old));
  s.entries.set("releases/previous-release/manifest.json", {
    body,
    etag: `"${digest(body)}"`,
    type: "application/json",
    cache: immutableCache,
  });
  const channel = await publishRelease({
    ...options(f, s),
    releaseId: "previous-release",
    rollback: true,
  });
  assert.equal(channel.releaseId, "previous-release");
  assert.equal(channel.generation, 2);
});
test("Content-Length와 Content-Encoding 오류 거부", async (t) => {
  const f = await fixture(t);
  const file = f.manifest.packs["interior-hall"].files.background;
  for (const headers of [
    { "Content-Length": String(file.bytes + 1) },
    { "Content-Encoding": "gzip" },
  ])
    await assert.rejects(
      getVerified({
        base: "https://cdn.example.com",
        key: file.path,
        ...file,
        fetcher: async () =>
          new Response(f.objects.get(file.path), {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": immutableCache,
              ...headers,
            },
          }),
      }),
    );
});
