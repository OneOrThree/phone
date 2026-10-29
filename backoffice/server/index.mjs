import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, requireValue } from "./store.mjs";
import { Upstream } from "./upstream.mjs";
import { createApp } from "./app.mjs";
const mode = process.env.BACKOFFICE_MODE ?? "local";
requireValue(
  ["local", "connected"].includes(mode),
  "BACKOFFICE_MODE는 local 또는 connected입니다.",
);
const origin = process.env.BACKOFFICE_ORIGIN ?? "http://127.0.0.1:4310";
const parsed = new URL(origin);
requireValue(
  parsed.origin === origin,
  "BACKOFFICE_ORIGIN에 경로를 포함하지 마세요.",
);
requireValue(
  mode !== "connected" || parsed.protocol === "https:",
  "연결 모드는 HTTPS 출처가 필요합니다.",
);
if (mode === "connected") {
  for (const name of ["NOTIFICATION_URL", "DATA_API_URL"]) {
    const value = process.env[name];
    requireValue(value, `${name}을 설정하세요.`);
    const address = new URL(value);
    requireValue(
      ["http:", "https:"].includes(address.protocol) &&
        !address.username &&
        !address.password,
      `${name}은 자격 정보 없는 HTTP(S) 서비스 주소여야 합니다.`,
    );
  }
}
const operators = JSON.parse(process.env.BACKOFFICE_OPERATORS ?? "{}");
requireValue(
  Object.keys(operators).length > 0,
  "BACKOFFICE_OPERATORS에 운영자 암호 해시를 설정하세요. README를 참고하세요.",
);
for (const [actor, operator] of Object.entries(operators)) {
  requireValue(
    /^member-[1-3]$/.test(actor) &&
      /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(operator.passwordHash ?? ""),
    "운영자 계정 또는 비밀번호 해시 형식을 확인하세요.",
  );
  requireValue(
    mode !== "connected" || (operator.notificationToken && operator.dataToken),
    "연결 모드에는 운영자별 두 서비스 토큰이 필요합니다.",
  );
}
const directory = resolve(process.env.BACKOFFICE_STATE_DIR ?? "var");
process.umask(0o077);
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const store = new Store(
  resolve(directory, mode === "local" ? "local.sqlite" : "content.sqlite"),
);
const upstream = new Upstream({
  mode,
  notificationUrl: process.env.NOTIFICATION_URL,
  dataUrl: process.env.DATA_API_URL,
});
const app = createApp({
  store,
  upstream,
  operators,
  origin,
  mode,
  staticDir: fileURLToPath(new URL("../dist", import.meta.url)),
});
const host =
  mode === "local" ? "127.0.0.1" : (process.env.BACKOFFICE_HOST ?? "127.0.0.1");
app.listen(Number(process.env.PORT ?? 4310), host, () =>
  console.log(
    `백오피스 ${mode} 모드 · ${origin}${mode === "local" ? " · 실제 발송/게시 없음" : ""}`,
  ),
);
function stop() {
  app.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
