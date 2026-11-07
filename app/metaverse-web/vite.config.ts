import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { attachRoom } from "./server/room.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "cattus-app-tokens",
      enforce: "pre",
      resolveId(id) {
        if (id.endsWith("/app-dev/src/design-system/tokens"))
          return "\0cattus-app-tokens";
      },
      load(id) {
        if (id !== "\0cattus-app-tokens") return;
        const path = new URL(
          "../app-dev/src/design-system/tokens.ts",
          import.meta.url,
        );
        this.addWatchFile(fileURLToPath(path));
        return ts.transpileModule(readFileSync(path, "utf8"), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText;
      },
    },
    {
      name: "cattus-local-room",
      configureServer(server) {
        if (server.httpServer) attachRoom(server.httpServer);
      },
      configurePreviewServer(server) {
        attachRoom(server.httpServer);
      },
    },
  ],
  build: { chunkSizeWarningLimit: 1200 },
});
