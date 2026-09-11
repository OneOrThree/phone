import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll } from 'vitest';
import { getPool, closePool } from '../src/lib/db/pool';
// 운영 CLI와 같은 migration 함수를 실행한다.
// @ts-expect-error 외부 실행용 JavaScript 모듈이다.
import { migrate } from '../scripts/migrate.mjs';

let container: string | undefined;

beforeAll(async () => {
  container = `gromo-link-test-${randomUUID()}`;
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=test', '-e', 'POSTGRES_DB=link',
    '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { stdio: 'pipe' });
  const port = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1);
  process.env.DATABASE_URL = `postgres://postgres:test@127.0.0.1:${port}/link`;
  process.env.DATABASE_SSL = 'disable';
  process.env.LINK_IP_SALT = 'fixture-existing-salt';
  process.env.LINK_BASE_URL = 'https://links.example.test';
  process.env.LINK_CAPABILITY_KEY = 'fixture-capability-key-only';
  process.env.LINK_PROXY_SECRET = 'fixture-proxy';
  process.env.SVC_TOKEN_BIZ_TO_LINK = 'fixture-business';
  process.env.SVC_TOKEN_DATA_TO_LINK = 'fixture-data';
  process.env.LINK_MIGRATION_TOKEN = 'fixture-import';
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await getPool().query('SELECT 1'); break; }
    catch { if (attempt === 99) throw new Error('PostgreSQL 준비 시간 초과'); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  await migrate(getPool());
});

afterAll(async () => {
  await closePool();
  if (container) execFileSync('docker', ['stop', container], { stdio: 'pipe' });
});
