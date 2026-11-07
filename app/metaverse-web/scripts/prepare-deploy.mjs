import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = resolve(root, process.argv[2] || "dist");
if (!relative(root, dir) || relative(root, dir).startsWith(".."))
  throw new Error("웹 빌드 폴더를 지정하세요.");
const room = new URL(process.env.VITE_ROOM_URL || "");
if (
  room.protocol !== "wss:" ||
  room.username ||
  room.password ||
  room.search ||
  room.hash ||
  room.pathname !== "/island-room" ||
  !room.hostname.endsWith(".workers.dev")
)
  throw new Error(
    "VITE_ROOM_URL은 공개 방의 wss://…workers.dev/island-room 주소여야 합니다.",
  );
const manifest = JSON.parse(
  await readFile(resolve(dir, ".vite/manifest.json"), "utf8"),
);
const entry = Object.values(manifest).find((v) => v.isEntry);
if (
  !entry ||
  !(await readFile(resolve(dir, entry.file), "utf8")).includes(room.href)
)
  throw new Error("빌드된 웹의 실시간 방 주소와 배포 설정이 다릅니다.");
const assets = await readdir(resolve(dir, "assets"));
if (assets.some((f) => !/-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(f)))
  throw new Error("1년 캐시 경로에 해시 없는 파일이 있습니다.");
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  `connect-src 'self' ${room.origin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");
const config = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
    ...["/", "/index.html", "/version.json"].map((source) => ({
      source,
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=0, must-revalidate, no-transform",
        },
      ],
    })),
    {
      source: "/assets/(.*)",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
    ...["audio", "fonts"].map((folder) => ({
      source: `/${folder}/(.*)`,
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=86400, must-revalidate",
        },
      ],
    })),
  ],
  redirects: [
    "/experience",
    "/experience.html",
    "/google-login",
    "/google-login.html",
  ].map((source) => ({ source, destination: "/", permanent: false })),
};
const revision = execFileSync(
  "git",
  ["rev-parse", process.env.SOURCE_REVISION || "HEAD"],
  {
    cwd: root,
    encoding: "utf8",
  },
).trim();
execFileSync(
  "git",
  [
    "diff",
    "--exit-code",
    revision,
    "--",
    root,
    resolve(root, "../app-dev/src/design-system/tokens.ts"),
  ],
  { cwd: root, stdio: "pipe" },
);
if (
  execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", root],
    { cwd: root, encoding: "utf8" },
  ).trim()
)
  throw new Error("아직 커밋하지 않은 웹 파일이 있습니다.");
await writeFile(
  resolve(dir, "vercel.json"),
  JSON.stringify(config, null, 2) + "\n",
);
await writeFile(
  resolve(dir, "version.json"),
  JSON.stringify({ revision, app: "cattus-3d", room: room.href }) + "\n",
);
console.log(`배포 설정 준비: ${dir}, ${revision}`);
