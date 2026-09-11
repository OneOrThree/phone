import type { Pool } from 'pg';

/**
 * 이 서비스가 실제로 읽고 쓰는 테이블 전부 — readiness 의 판정 기준이다.
 *
 * <p>`links` 하나만 확인하면 «부분 migration» 상태에서 readiness 가 UP 을 반환한다.
 * 예를 들어 0003 이 빠지면 콘솔 로그인이, 0004 가 빠지면 표시정보 relay 가,
 * 0005 가 빠지면 이관 import 가 즉시 실패하는데도 트래픽은 계속 들어온다.
 *
 * <p>migration 이 테이블을 추가하면 이 목록도 같이 늘린다 —
 * `tests/review-contracts.test.ts` 가 `migrations/*.sql` 과 대조해 강제한다.
 */
export const requiredTables = [
  'membership_epochs', 'links', 'link_clicks', 'link_claims', 'user_tombstones',
  'idempotency_results', 'claim_queue',
  'group_snapshots', 'user_snapshots', 'joined_events',
  'migration_runs', 'migration_clicks', 'migration_audit', 'migration_links',
  'console_login_attempts', 'console_sessions',
  'link_display_snapshots',
] as const;

/**
 * 목록 중 «검색 경로에서 보이지 않는» 테이블을 돌려준다 — 한 번의 왕복으로 전부 확인한다.
 *
 * <p>`to_regclass` 는 스키마를 명시하지 않으면 애플리케이션 쿼리와 같은 search_path 로
 * 해석하므로, 실제 쿼리가 닿는 테이블과 같은 것을 본다.
 */
export async function missingTables(pool: Pool, tables: readonly string[] = requiredTables): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT t.name FROM unnest($1::text[]) AS t(name)
      WHERE to_regclass(quote_ident(t.name)) IS NULL ORDER BY t.name`,
    [[...tables]],
  );
  return rows.map(row => row.name);
}
