import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonical,
  digest,
  immutableCache,
  channelCache,
  validateManifest,
  token,
} from "./core.mjs";
export async function serveRelease({
  directory = "dist/assets-cdn",
  releaseId,
  environment = "dev",
  port = 4301,
}) {
  token(releaseId);
  if (!["dev", "prod"].includes(environment)) throw Error("잘못된 환경");
  const manifestPath = `releases/${releaseId}/manifest.json`,
    body = await readFile(path.join(directory, manifestPath));
  const manifest = validateManifest(JSON.parse(body));
  if (manifest.releaseId !== releaseId) throw Error("릴리스 불일치");
  const channelKey = `channels/${environment}/1.json`;
  const bodies = new Map([
    [manifestPath, body],
    [
      channelKey,
      Buffer.from(
        canonical({
          schemaVersion: 1,
          assetApiVersion: 1,
          generation: 1,
          releaseId,
          manifestPath,
          manifestBytes: body.length,
          manifestSha256: digest(body),
        }),
      ),
    ],
  ]);
  for (const pack of Object.values(manifest.packs))
    for (const file of Object.values(pack.files)) {
      const b = await readFile(path.join(directory, file.path));
      if (b.length !== file.bytes || digest(b) !== file.sha256)
        throw Error("로컬 파일 무결성 실패");
      bodies.set(file.path, b);
    }
  const server = http.createServer((req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    const key = (req.url ?? "").slice(1),
      bytes = bodies.get(key);
    if (!bytes) {
      res.writeHead(404, { "Cache-Control": "no-store" }).end();
      return;
    }
    const etag = `"${digest(bytes)}"`;
    const headers = {
      "Content-Type": key.endsWith(".png") ? "image/png" : "application/json",
      "Cache-Control": key === channelKey ? channelCache : immutableCache,
      ETag: etag,
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers).end();
      return;
    }
    res
      .writeHead(200, { ...headers, "Content-Length": bytes.length })
      .end(req.method === "HEAD" ? undefined : bytes);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  serveRelease({
    releaseId: process.argv[2],
    port: Number(process.env.PORT ?? 4301),
  })
    .then((server) => console.log(`http://127.0.0.1:${server.address().port}`))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
