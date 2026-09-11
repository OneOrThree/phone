import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function migrate(pool) {
  const tx = await pool.connect();
  try {
    await tx.query('SELECT pg_advisory_lock(16600001)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter(name => /^\d+__.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(new URL(name, dir), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await tx.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (prior.rowCount) {
        if (prior.rows[0].checksum !== checksum) throw new Error(`이미 적용된 migration 변경: ${name}`);
        continue;
      }
      await tx.query('BEGIN');
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
      await tx.query('COMMIT');
    }
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await tx.query('SELECT pg_advisory_unlock(16600001)').catch(() => {});
    tx.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 필요합니다.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try { await migrate(pool); console.log('migration 완료'); }
  catch { console.error('migration 실패: DB 연결 및 migration 파일을 확인하세요.'); process.exitCode = 1; }
  finally { await pool.end(); }
}
