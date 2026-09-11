import { Pool, type PoolClient } from 'pg';
import { required } from '@/lib/env';

/**
 * Neon(운영)·로컬 PostgreSQL(테스트)에 «같은 SQL» 로 붙는다.
 *
 * <p>표준 `pg` 드라이버를 쓰는 이유는 소진 경로가 세션에 고정된 커넥션을 필요로 하기 때문이다 —
 * `BEGIN … SELECT … FOR UPDATE SKIP LOCKED … COMMIT` 은 한 커넥션 안에서 돌아야 하고,
 * HTTP 단발 쿼리 드라이버로는 성립하지 않는다. Neon 은 표준 Postgres 와이어 프로토콜을
 * 그대로 받으므로 연결 문자열만 바꾸면 된다(운영은 pooled endpoint 사용, DEPLOY.md 참고).
 *
 * <p>그래서 이 서비스의 모든 라우트는 Node 런타임이다. Edge 로 옮기면 위 트랜잭션이 깨진다.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool === undefined) {
    const connectionString = required('DATABASE_URL');
    pool = new Pool({
      connectionString,
      // 서버리스에서 커넥션이 폭증하지 않게 인스턴스당 상한을 낮게 잡는다.
      max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? '5', 10),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 2_000,
      // 요청 하나가 락을 오래 쥐고 있으면 매치 5초 예산을 통째로 먹는다 — 문장 단위로 자른다.
      statement_timeout: Number.parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? '4000', 10),
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: true } : undefined,
    });
  }
  return pool;
}

/** 테스트가 커넥션을 정리할 때만 쓴다. */
export async function closePool(): Promise<void> {
  if (pool !== undefined) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}

/**
 * 한 트랜잭션을 연다 — 커밋/롤백을 호출부가 잊을 수 없게 감싼다.
 *
 * <p>이 서비스의 불변식은 전부 «DB 잠금» 으로 성립한다(메모리 잠금·프로세스 로컬 상태로
 * 대체하지 않는다). Vercel 은 인스턴스가 여러 개 뜨므로 프로세스 안의 뮤텍스는 아무것도 막지 못한다.
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const deadline = Date.now() + 4000;
  const client = await getPool().connect();
  let discard = false;
  const bounded = new Proxy(client, {
    get(target, key) {
      if (key !== 'query') return Reflect.get(target, key);
      return async (sql: string, values?: unknown[]) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('DB_TRANSACTION_DEADLINE');
        // pg Client.query는 query별 query_timeout을 지원하지만 @types/pg에는 ClientConfig에만 선언되어 있다.
        const query = { text: sql, values, query_timeout: remaining };
        try { return await target.query(query); }
        catch (error) { discard = true; throw error; }
      };
    },
  });
  try {
    await bounded.query('BEGIN');
    const result = await fn(bounded);
    await bounded.query('COMMIT');
    return result;
  } catch (error) {
    try {
      if (discard) throw error;
      await client.query('ROLLBACK');
    } catch {
      discard = true;
      // 롤백 실패는 원래 오류를 가리면 안 된다 — 커넥션은 release 시 폐기된다.
    }
    throw error;
  } finally {
    // client 측 timeout 뒤에는 서버 쿼리가 아직 돌 수 있으므로 커넥션을 재사용하지 않는다.
    client.release(discard);
  }
}

function shouldUseSsl(connectionString: string): boolean {
  if (process.env.DATABASE_SSL === 'disable') return false;
  if (process.env.DATABASE_SSL === 'require') return true;
  // 로컬 테스트(localhost)는 SSL 없이, 그 밖(Neon 등)은 SSL 로 붙는 것이 기본이다.
  return !/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
}

export type { PoolClient };
