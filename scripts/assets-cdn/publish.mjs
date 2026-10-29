import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonical,
  digest,
  limits,
  immutableCache,
  channelCache,
  validateManifest,
  validateChannel,
  token,
  png,
} from "./core.mjs";
import { getVerified, baseUrl } from "./verify.mjs";
const exec = promisify(execFile);
export async function runAws(args) {
  const { stdout } = await exec("aws", [...args, "--output", "json"], {
    maxBuffer: 2 * 1024 ** 2,
  });
  return stdout.trim() ? JSON.parse(stdout) : {};
}
const missing = (e) => /\(NoSuchKey\)|\(404\)/.test(e.stderr ?? e.message);
const conflict = (e) =>
  /\(PreconditionFailed\)|\(412\)|\(ConditionalRequestConflict\)/.test(
    e.stderr ?? e.message,
  );
export async function publishRelease({
  directory,
  releaseId,
  environment,
  bucket,
  base,
  rollback = false,
  aws = runAws,
  fetcher = fetch,
}) {
  token(releaseId);
  if (!["dev", "prod"].includes(environment)) throw Error("환경은 dev/prod");
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw Error("잘못된 버킷");
  baseUrl(base);
  const temporary = await mkdtemp(path.join(tmpdir(), "asset-publish-"));
  const channelKey = `channels/${environment}/1.json`;
  const get = async (key, limit) => {
    const destination = path.join(temporary, "get");
    const meta = await aws([
      "s3api",
      "get-object",
      "--bucket",
      bucket,
      "--key",
      key,
      destination,
    ]);
    const body = await readFile(destination);
    if (body.length > limit) throw Error("S3 객체 크기 초과");
    return { meta, body };
  };
  try {
    // 최초 읽은 ETag만 사용하며 CAS 실패를 새 포인터로 재시도하지 않는다.
    let previous = null;
    try {
      previous = await get(channelKey, limits.channel);
      validateChannel(JSON.parse(previous.body));
      if (!previous.meta.ETag) throw Error("채널 ETag 없음");
    } catch (e) {
      if (!missing(e)) throw e;
    }
    const manifestKey = `releases/${releaseId}/manifest.json`;
    const manifestBytes = rollback
      ? (await get(manifestKey, limits.manifest)).body
      : await readFile(path.join(directory, manifestKey));
    if (manifestBytes.length > limits.manifest)
      throw Error("manifest 크기 초과");
    const manifest = validateManifest(JSON.parse(manifestBytes));
    if (manifest.releaseId !== releaseId) throw Error("releaseId 불일치");
    const objects = new Map();
    for (const pack of Object.values(manifest.packs))
      for (const file of Object.values(pack.files))
        objects.set(file.path, file);
    const upload = async (key, body, type) => {
      const source = path.join(temporary, "put");
      await writeFile(source, body);
      try {
        await aws([
          "s3api",
          "put-object",
          "--bucket",
          bucket,
          "--key",
          key,
          "--body",
          source,
          "--content-type",
          type,
          "--cache-control",
          immutableCache,
          "--if-none-match",
          "*",
        ]);
      } catch (e) {
        if (!conflict(e)) throw e;
        const existing = await get(key, body.length);
        if (
          !existing.body.equals(body) ||
          existing.meta.ContentType !== type ||
          existing.meta.CacheControl !== immutableCache
        )
          throw Error("기존 불변 객체 불일치");
      }
    };
    for (const [key, file] of objects) {
      if (!rollback) {
        const body = await readFile(path.join(directory, key));
        const dimensions = png(body);
        if (
          body.length !== file.bytes ||
          digest(body) !== file.sha256 ||
          dimensions.width !== file.width ||
          dimensions.height !== file.height
        )
          throw Error("로컬 파일 무결성 실패");
        await upload(key, body, file.mediaType);
      }
    }
    if (!rollback) await upload(manifestKey, manifestBytes, "application/json");
    for (const [key, file] of objects)
      await getVerified({
        base,
        key,
        bytes: file.bytes,
        sha256: file.sha256,
        mediaType: file.mediaType,
        fetcher,
      });
    await getVerified({
      base,
      key: manifestKey,
      bytes: manifestBytes.length,
      sha256: digest(manifestBytes),
      mediaType: "application/json",
      fetcher,
    });
    const generation = previous ? JSON.parse(previous.body).generation + 1 : 1;
    const channel = validateChannel({
      schemaVersion: 1,
      assetApiVersion: 1,
      generation,
      releaseId,
      manifestPath: manifestKey,
      manifestSha256: digest(manifestBytes),
      manifestBytes: manifestBytes.length,
    });
    const source = path.join(temporary, "channel");
    await writeFile(source, canonical(channel));
    await aws([
      "s3api",
      "put-object",
      "--bucket",
      bucket,
      "--key",
      channelKey,
      "--body",
      source,
      "--content-type",
      "application/json",
      "--cache-control",
      channelCache,
      ...(previous
        ? ["--if-match", previous.meta.ETag]
        : ["--if-none-match", "*"]),
    ]);
    return channel;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  publishRelease({
    directory: "dist/assets-cdn",
    releaseId: process.argv[2],
    environment: process.env.ASSET_ENVIRONMENT,
    bucket: process.env.ASSET_BUCKET,
    base: process.env.ASSET_CDN_URL,
    rollback: process.argv.includes("--rollback"),
  })
    .then((c) => console.log(canonical(c)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
