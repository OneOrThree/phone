import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetFile, canonical, digest, token, validateManifest } from "./core.mjs";
export async function buildRelease({
  repo = process.cwd(),
  out = path.join(repo, "dist/assets-cdn"),
  releaseId,
}) {
  token(releaseId);
  repo = await realpath(repo);
  const packs = Object.create(null),
    objects = new Map();
  for (const name of (await readdir(path.join(repo, "assets-cdn/packs")))
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const definition = JSON.parse(
      await readFile(path.join(repo, "assets-cdn/packs", name), "utf8"),
    );
    token(definition.packId);
    if (packs[definition.packId]) throw Error("중복 팩");
    const files = Object.create(null);
    for (const [assetId, source] of Object.entries(definition.files)) {
      token(assetId);
      if (typeof source !== "string" || path.isAbsolute(source))
        throw Error("잘못된 원본 경로");
      const absolute = await realpath(path.resolve(repo, source));
      if (!absolute.startsWith(repo + path.sep)) throw Error("원본 경로 탈출");
      const bytes = await readFile(absolute),
        metadata = assetFile(bytes, path.extname(absolute)),
        sha256 = digest(bytes),
        objectPath = source.startsWith("server/static/customization/")
          ? source.slice("server/".length)
          : `assets/${sha256}${path.extname(absolute)}`;
      files[assetId] = {
        path: objectPath,
        sha256,
        bytes: bytes.length,
        ...metadata,
      };
      objects.set(objectPath, bytes);
    }
    packs[definition.packId] = { version: digest(canonical(files)), files };
  }
  const manifest = validateManifest({
      schemaVersion: 1,
      assetApiVersion: 1,
      releaseId,
      packs,
    }),
    manifestPath = `releases/${releaseId}/manifest.json`;
  objects.set(manifestPath, Buffer.from(canonical(manifest)));
  for (const [key, bytes] of objects) {
    const destination = path.join(out, key);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await writeFile(destination, bytes, { flag: "wx" });
    } catch (error) {
      if (
        error.code !== "EEXIST" ||
        !(await readFile(destination)).equals(bytes)
      )
        throw error;
    }
  }
  return { manifest, manifestPath, objects };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const releaseId = process.argv[2];
  buildRelease({ releaseId })
    .then((r) =>
      console.log(
        canonical({
          releaseId,
          manifestPath: r.manifestPath,
          files: r.objects.size,
        }),
      ),
    )
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
