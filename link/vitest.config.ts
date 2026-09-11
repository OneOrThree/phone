import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 실제 Postgres 를 쓰는 테스트가 같은 DB 를 공유한다 — 파일 병렬을 끄고 순차로 돈다.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: { '@': new URL('./src/', import.meta.url).pathname },
  },
});
