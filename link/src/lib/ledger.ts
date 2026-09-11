import { createHash } from 'node:crypto';
import type { PoolClient } from './db/pool';
import { withTransaction } from './db/pool';
import { fail, text } from './errors';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function checksum(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export async function lock(tx: PoolClient, key: string): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export async function activeUsers(tx: PoolClient, ...userIds: string[]): Promise<void> {
  for (const id of [...new Set(userIds)].sort()) await lock(tx, `user:${id}`);
  if ((await tx.query('SELECT 1 FROM user_tombstones WHERE user_id = ANY($1::uuid[])', [userIds])).rowCount) {
    fail(410, 'USER_WITHDRAWN');
  }
}

export async function idempotent<T>(scope: string, key: string, body: unknown,
  action: (tx: PoolClient) => Promise<T>, envelope?: unknown): Promise<T> {
  text(key, 200);
  // relay eventId는 명령 종류·사용자와 무관하게 봉투 전체를 식별한다.
  if (envelope !== undefined) scope = 'event';
  const digest = checksum(envelope ?? body);
  return withTransaction(async tx => {
    await lock(tx, `command:${scope}:${key}`);
    const prior = await tx.query('SELECT request_hash, response FROM idempotency_results WHERE scope=$1 AND key=$2', [scope, key]);
    if (prior.rowCount) {
      if (prior.rows[0].request_hash !== digest) fail(409, 'IDEMPOTENCY_KEY_CONFLICT');
      return prior.rows[0].response as T;
    }
    const result = await action(tx);
    await tx.query('INSERT INTO idempotency_results(scope,key,request_hash,status_code,response) VALUES($1,$2,$3,200,$4)',
      [scope, key, digest, JSON.stringify(result)]);
    return result;
  });
}
