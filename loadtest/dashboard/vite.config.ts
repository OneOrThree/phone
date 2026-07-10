import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 정적 SPA — 백엔드 없음. GitHub API(api.github.com, CORS 허용)와
// loadtest-reports 브랜치 Contents API 만 호출한다.
export default defineConfig({
  plugins: [react()],
  server: { port: 5273 },
});
