import { createHash } from "node:crypto";
export const limits = {
  file: 16 * 1024 ** 2,
  pack: 32 * 1024 ** 2,
  manifest: 1024 ** 2,
  channel: 16 * 1024,
};
export const immutableCache = "public, max-age=31536000, immutable";
export const channelCache = "public, max-age=60";
export const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function token(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  )
    throw Error("잘못된 식별자");
  return value;
}
export function png(bytes) {
  if (
    bytes.length < 33 ||
    bytes.length > limits.file ||
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw Error("잘못된 PNG");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16777216
  )
    throw Error("PNG 해상도 초과");
  return { width, height };
}
export function validateManifest(m) {
  if (m?.schemaVersion !== 1 || m.assetApiVersion !== 1)
    throw Error("호환되지 않는 manifest");
  token(m.releaseId);
  const packs = Object.entries(m.packs ?? {});
  if (!packs.length || packs.length > 512) throw Error("팩 개수 초과");
  let count = 0;
  for (const [id, p] of packs) {
    token(id);
    const files = Object.entries(p.files ?? {});
    if (
      !files.length ||
      files.length > 128 ||
      p.version !== digest(canonical(p.files))
    )
      throw Error("잘못된 팩");
    let size = 0;
    for (const [assetId, f] of files) {
      token(assetId);
      if (
        !/^[a-f0-9]{64}$/.test(f.sha256) ||
        f.path !== `assets/${f.sha256}.png` ||
        f.mediaType !== "image/png" ||
        !Number.isSafeInteger(f.bytes) ||
        f.bytes < 33 ||
        f.bytes > limits.file ||
        !Number.isSafeInteger(f.width) ||
        !Number.isSafeInteger(f.height) ||
        f.width < 1 ||
        f.height < 1 ||
        f.width > 4096 ||
        f.height > 4096 ||
        f.width * f.height > 16777216
      )
        throw Error("잘못된 파일");
      size += f.bytes;
      count++;
    }
    if (size > limits.pack) throw Error("팩 크기 초과");
  }
  if (count > 4096 || Buffer.byteLength(canonical(m)) > limits.manifest)
    throw Error("릴리스 한도 초과");
  return m;
}
export function validateChannel(c) {
  if (
    c?.schemaVersion !== 1 ||
    c.assetApiVersion !== 1 ||
    !Number.isSafeInteger(c.generation) ||
    c.generation < 1 ||
    !Number.isSafeInteger(c.manifestBytes) ||
    c.manifestBytes < 1 ||
    c.manifestBytes > limits.manifest ||
    !/^[a-f0-9]{64}$/.test(c.manifestSha256)
  )
    throw Error("잘못된 채널");
  token(c.releaseId);
  if (c.manifestPath !== `releases/${c.releaseId}/manifest.json`)
    throw Error("잘못된 manifest 경로");
  return c;
}
