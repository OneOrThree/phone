import type { PoolClient } from './db/pool';
import { withTransaction } from './db/pool';
import { fail, object, text, uuid, version } from './errors';
import { canonical, checksum, lock } from './ledger';
import { optional } from './env';

export async function requireDirectWrites(tx: PoolClient) {
  const id = optional('LINK_MIGRATION_ID');
  if (!id) return;
  const row = (await tx.query('SELECT state FROM migration_runs WHERE id=$1 FOR SHARE', [id])).rows[0];
  if (row?.state !== 'IMPORT_CLOSED') fail(503, 'IMPORT_IN_PROGRESS');
}

export interface FrozenClick {
  clickId: string; linkId: string; slug: string; groupId: string; inviterId: string;
  linkVersion: string; membershipEpoch: string; transitionSeq: string;
  groupName: string; inviterName: string | null; groupClosed: boolean; linkStatus: 'ACTIVE' | 'REVOKED';
  // 표시정보의 «필드별» 출처 version. 이 값이 없으면 이관 뒤 link_display_snapshots 가 0 에서 시작해,
  // 동결 이전에 발행됐다가 늦게 도착한 group.renamed · user.displayNameChanged 가 다시 적용된다 —
  // 이관 시점의 이름이 그보다 옛 이름으로 되돌아간다.
  groupNameVersion: string; inviterNameVersion: string;
  linkCreatedAt: string; revokedAt: string | null;
  ipHash: string; os: string; userAgent: string | null; clickedAt: string;
  matched: boolean; matchedAt: string | null; matchedDeviceId: string | null; appInstanceId: string | null;
  claimedUserId: string | null; claimedAt: string | null;
}

function timestamp(value: unknown, nullable = false): string | null {
  if (value == null && nullable) return null;
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) fail(400, 'INVALID_TIMESTAMP');
  return new Date(result).toISOString();
}

export function frozen(value: unknown): FrozenClick {
  const b = object(value);
  const result: FrozenClick = {
    clickId: uuid(b.clickId), linkId: uuid(b.linkId), slug: text(b.slug, 12), groupId: uuid(b.groupId), inviterId: uuid(b.inviterId),
    linkVersion: version(b.linkVersion), membershipEpoch: version(b.membershipEpoch), transitionSeq: version(b.transitionSeq),
    groupName: text(b.groupName), inviterName: b.inviterName == null ? null : text(b.inviterName),
    groupClosed: b.groupClosed === true, linkStatus: b.linkStatus === 'REVOKED' ? 'REVOKED' : 'ACTIVE',
    groupNameVersion: version(b.groupNameVersion), inviterNameVersion: version(b.inviterNameVersion),
    linkCreatedAt: timestamp(b.linkCreatedAt)!, revokedAt: timestamp(b.revokedAt, true),
    ipHash: text(b.ipHash, 64), os: text(b.os, 16), userAgent: b.userAgent == null ? null : text(b.userAgent, 512),
    clickedAt: timestamp(b.clickedAt)!, matched: b.matched === true,
    matchedAt: timestamp(b.matchedAt, true), matchedDeviceId: b.matchedDeviceId == null ? null : text(b.matchedDeviceId, 64),
    appInstanceId: b.appInstanceId == null ? null : text(b.appInstanceId, 64),
    claimedUserId: b.claimedUserId == null ? null : uuid(b.claimedUserId), claimedAt: timestamp(b.claimedAt, true),
  };
  if (!/^[a-z0-9]{1,12}$/.test(result.slug) || !/^[a-f0-9]{64}$/.test(result.ipHash)
      || !['ios', 'android', 'other'].includes(result.os)
      || result.matched !== (result.matchedAt !== null)
      || (result.linkStatus === 'REVOKED') !== (result.revokedAt !== null)
      || (result.claimedUserId !== null && result.claimedAt === null)) fail(400, 'INVALID_FROZEN_CLICK');
  return result;
}

export async function openRun(tx: PoolClient, id: string) {
  // 이관 단위 «독점» 락은 호환 소진(최대 500 후보)과 백필을 한 줄로 세워 match 4초 예산을 통째로 먹는다.
  // drain 은 migration_runs 행의 공유/독점 쌍이 이미 맡고 있다 — 여기(그리고 requireDirectWrites)의
  // FOR SHARE 와 close 의 FOR UPDATE 가 짝이다. 병렬 importer 사이의 원자성은 lockImportRows 의
  // 행 단위 고정 순서(click → link)가 지킨다.
  const row = (await tx.query('SELECT * FROM migration_runs WHERE id=$1 FOR SHARE', [id])).rows[0];
  if (!row) fail(409, 'MIGRATION_NOT_INITIALIZED');
  if (row.state !== 'IMPORTING') fail(409, 'IMPORT_CLOSED');
  return row;
}

/**
 * 이관이 건드릴 행 잠금을 «한 번에, 전역 사전순» 으로 잡는다.
 *
 * <p>`migration-click:` 은 `migration-link:` 보다 항상 앞서므로 모든 진입점(호환 소진 · 벌크 import)이
 * 같은 순서로 잡는다 — 한쪽이 링크를 먼저 잡고 다른 쪽이 클릭을 먼저 잡는 교착이 성립하지 않는다.
 * 진입점은 자기가 쓸 키를 «전부» 여기서 미리 잡고, 그 뒤 호출되는 하위 단계는 이미 쥔 락을 재확인만 한다.
 */
async function lockImportRows(tx: PoolClient, clickIds: string[], linkIds: string[]) {
  const keys = [...new Set([...clickIds.map(id => `migration-click:${id}`), ...linkIds.map(id => `migration-link:${id}`)])].sort();
  if (!keys.length) return;
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended(key,0)) FROM (SELECT unnest($1::text[]) AS key ORDER BY 1) keys", [keys]);
}

/** 백필은 «더 높은 version 의 현재 값» 을 되돌리지 않는다 — 표시정보를 필드별로 원자 병합한다. */
const displayMerge = `ON CONFLICT(group_id,inviter_id) DO UPDATE SET
  group_name=CASE WHEN EXCLUDED.group_name_version>link_display_snapshots.group_name_version
    THEN EXCLUDED.group_name ELSE link_display_snapshots.group_name END,
  group_name_version=GREATEST(link_display_snapshots.group_name_version,EXCLUDED.group_name_version),
  inviter_name=CASE WHEN EXCLUDED.inviter_name_version>link_display_snapshots.inviter_name_version
    THEN EXCLUDED.inviter_name ELSE link_display_snapshots.inviter_name END,
  inviter_name_version=GREATEST(link_display_snapshots.inviter_name_version,EXCLUDED.inviter_name_version)`;

/** 후보 500개도 SQL 왕복은 상수 개수다. run 의 공유 락 안에서 적재·소진·감사가 함께 커밋된다. */
export async function importClicks(tx: PoolClient, migrationId: string, values: unknown[]) {
  const entries = new Map<string, { source: FrozenClick; sourceChecksum: string }>();
  for (const value of values) {
    const entry = object(value), source = frozen(entry.source), sourceChecksum = text(entry.sourceChecksum, 64);
    if (checksum(source) !== sourceChecksum) fail(409, 'SOURCE_CHECKSUM_MISMATCH');
    if (entries.has(source.clickId) && entries.get(source.clickId)!.sourceChecksum !== sourceChecksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.set(source.clickId, { source, sourceChecksum });
  }
  if (!entries.size) return;
  // run 락을 공유로 낮췄으므로 «조회 전에» 행 잠금을 잡아야 검사-후-삽입이 원자로 성립한다.
  await lockImportRows(tx, [...entries.keys()], [...entries.values()].map(e => e.source.linkId));
  const previous = await tx.query('SELECT click_id,source_checksum FROM migration_clicks WHERE migration_id=$1 AND click_id=ANY($2::uuid[])',
    [migrationId, [...entries.keys()]]);
  for (const row of previous.rows) {
    if (entries.get(row.click_id)!.sourceChecksum !== row.source_checksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.delete(row.click_id);
  }
  if (!entries.size) return;
  await importLinks(tx, migrationId, [...entries.values()].map(e => frozenLink(e.source)));
  const existing = await tx.query('SELECT id FROM link_clicks WHERE id=ANY($1::uuid[]) LIMIT 1', [[...entries.keys()]]);
  if (existing.rowCount) fail(409, 'UNTRACKED_LEGACY_CLICK');
  const payload = JSON.stringify([...entries.values()]);
  await tx.query(`INSERT INTO link_clicks(id,link_id,ip_hash,os,user_agent,clicked_at,matched,matched_at,matched_device_id,
    app_instance_id,claimed_user_id,claimed_at,legacy_click_id)
    SELECT (s->>'clickId')::uuid,(s->>'linkId')::uuid,s->>'ipHash',s->>'os',s->>'userAgent',
      (s->>'clickedAt')::timestamptz,(s->>'matched')::boolean,(s->>'matchedAt')::timestamptz,
      s->>'matchedDeviceId',s->>'appInstanceId',(s->>'claimedUserId')::uuid,(s->>'claimedAt')::timestamptz,
      (s->>'clickId')::uuid FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    ORDER BY s->>'clickId'`, [payload]);
  await tx.query(`INSERT INTO migration_clicks(migration_id,click_id,source_checksum,frozen_source)
    SELECT $1,(e->'source'->>'clickId')::uuid,e->>'sourceChecksum',e->'source'
    FROM jsonb_array_elements($2::jsonb) e`, [migrationId, payload]);
  await importLegacyClaims(tx, [...entries.values()].map(e => e.source));
}

/**
 * 구 클릭의 `claimed_user_id` 를 원장에 «근거 그대로» 남긴다.
 *
 * <p>구 운영은 가입(멤버십) 검증 없이 이 컬럼을 찍었다 — 그래서 확정 상태나 확정 근거를 지어내지 않고
 * `LEGACY` 로만 적재한다. 유효·보상 집계는 `CONFIRMED` 기준이므로 이 행만으로는 자격이 생기지 않고,
 * 뒤에 Data 가 진짜 membershipEpoch/transitionSeq/proof 를 실어 보내면 그때 승격된다(`confirm`).
 *
 * <p>원장 행이 아예 없으면 반대 방향으로 깨진다 — 같은 사용자의 재시도 claim 이 후보를 못 찾아
 * capability 없이 끝나고(links.ts `claim`), 탈퇴·폐기 어느 경로에도 걸리지 않는다.
 */
async function importLegacyClaims(tx: PoolClient, sources: FrozenClick[]) {
  const clickIds = sources.map(source => source.clickId);
  const users = [...new Set(sources.map(source => source.claimedUserId).filter((id): id is string => id !== null))].sort();
  if (!users.length) return;
  // 탈퇴 검사 전에 사용자 축을 먼저 잠근다 — 원장의 activeUsers 와 같은 순서·같은 락 이름이다.
  // 안 잡으면 tombstone 을 읽은 «뒤» 커밋된 탈퇴의 익명화를 이 import 가 그대로 되살린다.
  for (const id of users) await lock(tx, `user:${id}`);
  // 탈퇴는 동결된 원본보다 «뒤» 사건이다. 익명화된 귀속을 백필이 되살리지 않는다.
  const withdrawn = await tx.query(`UPDATE link_clicks c SET claimed_user_id=NULL
    FROM user_tombstones t WHERE c.id=ANY($1::uuid[]) AND c.claimed_user_id=t.user_id RETURNING c.id`, [clickIds]);
  // (link,user) 당 대표 클릭 1건만 원장 행이 된다 — 나머지 근거는 migration_clicks.frozen_source 에 남는다.
  // 같은 (link,user) 에 이미 claim 이 있으면(확정·폐기 포함) 덮지 않는다.
  await tx.query(`INSERT INTO link_claims(link_id,slug,group_id,inviter_id,claimed_user_id,click_id,membership_epoch,status,created_at)
    SELECT DISTINCT ON (c.link_id,c.claimed_user_id)
      c.link_id,l.slug,l.group_id,l.inviter_id,c.claimed_user_id,c.id,l.link_version,'LEGACY',c.claimed_at
    FROM link_clicks c JOIN links l ON l.id=c.link_id
    WHERE c.id=ANY($1::uuid[]) AND c.claimed_user_id IS NOT NULL AND c.claim_id IS NULL
    ORDER BY c.link_id,c.claimed_user_id,c.claimed_at,c.id
    ON CONFLICT (link_id,claimed_user_id) WHERE claimed_user_id IS NOT NULL DO NOTHING`, [clickIds]);
  // 형제 클릭도 대표 claim 에 묶어 둔다 — 소진되지 않은 claim 후보로 다시 잡히면 안 된다.
  await tx.query(`UPDATE link_clicks c SET claim_id=k.id FROM link_claims k
    WHERE c.id=ANY($1::uuid[]) AND c.claim_id IS NULL AND c.claimed_user_id IS NOT NULL
      AND k.link_id=c.link_id AND k.claimed_user_id=c.claimed_user_id`, [clickIds]);
  // 익명화로 원본과 달라진 행은 감사에 실제 상태를 남긴다(verify 는 그 뒤 audit 를 기대값으로 본다).
  for (const row of withdrawn.rows) await auditTransition(tx, row.id);
}

async function importLinks(tx: PoolClient, migrationId: string, sources: FrozenLink[]) {
  const entries = new Map<string, { source: FrozenLink; sourceChecksum: string }>();
  for (const source of sources) {
    const sourceChecksum = checksum(source);
    if (entries.has(source.linkId) && entries.get(source.linkId)!.sourceChecksum !== sourceChecksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.set(source.linkId, { source, sourceChecksum });
  }
  if (!entries.size) return;
  // 다른 회차 importer 와 링크별 잠금 이름을 공유한다. 조회 «전» 에 잡아야 검사-후-삽입이 원자다.
  await lockImportRows(tx, [], [...entries.keys()]);
  const previous = await tx.query('SELECT link_id,source_checksum FROM migration_links WHERE migration_id=$1 AND link_id=ANY($2::uuid[])',
    [migrationId, [...entries.keys()]]);
  for (const row of previous.rows) {
    if (entries.get(row.link_id)!.sourceChecksum !== row.source_checksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.delete(row.link_id);
  }
  if (!entries.size) return;
  const payload = JSON.stringify([...entries.values()]);
  await tx.query(`INSERT INTO membership_epochs(group_id,inviter_id,epoch,transition_seq)
    SELECT DISTINCT ON (s->>'groupId',s->>'inviterId') (s->>'groupId')::uuid,(s->>'inviterId')::uuid,
      (s->>'membershipEpoch')::bigint,(s->>'transitionSeq')::bigint
    FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    ORDER BY s->>'groupId',s->>'inviterId',(s->>'transitionSeq')::bigint DESC
    ON CONFLICT(group_id,inviter_id) DO NOTHING`, [payload]);
  await tx.query(`INSERT INTO links(id,slug,group_id,inviter_id,link_version,status,revoked_at,group_name,inviter_name,group_closed,created_at,snapshot_version)
    SELECT (s->>'linkId')::uuid,s->>'slug',(s->>'groupId')::uuid,(s->>'inviterId')::uuid,
      (s->>'linkVersion')::bigint,s->>'linkStatus',(s->>'revokedAt')::timestamptz,s->>'groupName',s->>'inviterName',
      (s->>'groupClosed')::boolean,(s->>'linkCreatedAt')::timestamptz,
      GREATEST((s->>'groupNameVersion')::bigint,(s->>'inviterNameVersion')::bigint)
    FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    ORDER BY s->>'linkId' ON CONFLICT(id) DO NOTHING`, [payload]);
  const actual = await tx.query('SELECT id,slug,group_id,inviter_id,link_version FROM links WHERE id=ANY($1::uuid[])', [[...entries.keys()]]);
  if (actual.rows.length !== entries.size) fail(409, 'FROZEN_LINK_CONFLICT');
  for (const row of actual.rows) {
    const source = entries.get(row.id)!.source;
    if (row.slug !== source.slug || row.group_id !== source.groupId || row.inviter_id !== source.inviterId
        || row.link_version !== source.linkVersion) fail(409, 'FROZEN_LINK_CONFLICT');
  }
  // 표시정보는 «필드별 version 까지» 복원해야 한다. 0 에서 시작하면 동결 이전에 발행된 지연 rename 이
  // 다시 적용돼 이름이 되돌아간다. 같은 (group,inviter) 를 공유하는 링크는 필드별 최신 값으로 접는다.
  await tx.query(`INSERT INTO link_display_snapshots(group_id,inviter_id,group_name,group_name_version,inviter_name,inviter_name_version)
    SELECT (s->>'groupId')::uuid,(s->>'inviterId')::uuid,
      (array_agg(s->>'groupName' ORDER BY (s->>'groupNameVersion')::bigint DESC,s->>'linkId'))[1],
      max((s->>'groupNameVersion')::bigint),
      (array_agg(s->>'inviterName' ORDER BY (s->>'inviterNameVersion')::bigint DESC,s->>'linkId'))[1],
      max((s->>'inviterNameVersion')::bigint)
    FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    GROUP BY s->>'groupId',s->>'inviterId' ORDER BY 1,2
    ${displayMerge}`, [payload]);
  await tx.query(`INSERT INTO group_snapshots(group_id,name,version,closed)
    SELECT (s->>'groupId')::uuid,min(s->>'groupName'),0,bool_or((s->>'groupClosed')::boolean)
    FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    GROUP BY s->>'groupId' ORDER BY s->>'groupId'
    ON CONFLICT(group_id) DO UPDATE SET closed=group_snapshots.closed OR EXCLUDED.closed`, [payload]);
  await tx.query(`INSERT INTO migration_links(migration_id,link_id,source_checksum,frozen_source)
    SELECT $1,(e->'source'->>'linkId')::uuid,e->>'sourceChecksum',e->'source'
    FROM jsonb_array_elements($2::jsonb) e`, [migrationId, payload]);
}

export async function importBatch(input: unknown) {
  const body = object(input), id = text(body.migrationId, 100), manifest = text(body.sourceChecksum, 64);
  const count = version(body.expectedClicks), expectedLinks = version(body.expectedLinks);
  const linkChecksum = text(body.linkChecksum, 64);
  if (!/^[a-f0-9]{64}$/.test(manifest) || !Array.isArray(body.clicks) || body.clicks.length > 20
      || !Array.isArray(body.links) || body.links.length > 20 || !/^[a-f0-9]{64}$/.test(linkChecksum)) fail(400, 'INVALID_IMPORT');
  const entries = body.clicks as unknown[], links = body.links as unknown[];
  const linkSources = links.map(value => {
    const entry = object(value), source = frozenLink(entry.source);
    if (checksum(source) !== text(entry.sourceChecksum, 64)) fail(409, 'SOURCE_CHECKSUM_MISMATCH');
    return source;
  });
  const clickSources = entries.map(value => frozen(object(value).source));
  return withTransaction(async tx => {
    await tx.query("INSERT INTO migration_runs(id,source_checksum,state,expected_clicks,expected_links,link_checksum) VALUES($1,$2,'IMPORTING',$3,$4,$5) ON CONFLICT(id) DO NOTHING", [id, manifest, count, expectedLinks, linkChecksum]);
    const run = await openRun(tx, id);
    if (run.source_checksum !== manifest || run.expected_clicks !== count || run.expected_links !== expectedLinks || run.link_checksum !== linkChecksum) fail(409, 'MANIFEST_CHANGED');
    // 이 트랜잭션이 건드릴 링크·클릭 락을 «한 번에» 전역 순서로 잡는다. 링크를 먼저 잡는 경로와
    // 클릭을 먼저 잡는 경로가 섞이면 run 독점 락 없이는 교착이므로, 하위 단계는 재확인만 하게 만든다.
    await lockImportRows(tx, clickSources.map(source => source.clickId),
      [...linkSources.map(source => source.linkId), ...clickSources.map(source => source.linkId)]);
    await importLinks(tx, id, linkSources);
    await importClicks(tx, id, entries);
    return { imported: entries.length, importedLinks: links.length };
  });
}

export async function auditTransition(tx: PoolClient, clickId: string) {
  const markers = await tx.query('SELECT migration_id FROM migration_clicks WHERE click_id=$1 FOR UPDATE', [clickId]);
  for (const marker of markers.rows) {
    const current = (await tx.query('SELECT matched,matched_at,matched_device_id,app_instance_id,claimed_user_id,claimed_at FROM link_clicks WHERE id=$1', [clickId])).rows[0];
    await tx.query('UPDATE migration_clicks SET compat_applied=true WHERE migration_id=$1 AND click_id=$2', [marker.migration_id, clickId]);
    await tx.query("INSERT INTO migration_audit(migration_id,click_id,action,result) VALUES($1,$2,'TRANSITION',$3)", [marker.migration_id, clickId, JSON.stringify(current)]);
  }
}

async function verify(tx: PoolClient, id: string) {
  const run = (await tx.query('SELECT * FROM migration_runs WHERE id=$1', [id])).rows[0];
  if (!run) fail(409, 'MIGRATION_NOT_INITIALIZED');
  await verifyLinks(tx, id, run);
  const rows = await tx.query(`SELECT m.*,c.link_id,c.ip_hash,c.os,c.user_agent,c.clicked_at,c.matched,c.matched_at,
    c.matched_device_id,c.app_instance_id,c.claimed_user_id,c.claimed_at,
    (SELECT result FROM migration_audit a WHERE a.migration_id=m.migration_id AND a.click_id=m.click_id ORDER BY a.id DESC LIMIT 1) AS audit
    FROM migration_clicks m JOIN link_clicks c ON c.id=m.click_id WHERE m.migration_id=$1 ORDER BY m.click_id`, [id]);
  if (BigInt(rows.rowCount!) !== BigInt(run.expected_clicks)) fail(409, 'IMPORT_COUNT_MISMATCH');
  const manifest = rows.rows.map(row => ({ clickId: row.click_id, sourceChecksum: row.source_checksum }));
  if (checksum(manifest) !== run.source_checksum) fail(409, 'MANIFEST_CHECKSUM_MISMATCH');
  for (const row of rows.rows) {
    const source = frozen(row.frozen_source);
    if (checksum(source) !== row.source_checksum || source.linkId !== row.link_id || source.ipHash !== row.ip_hash.trim()
        || source.os !== row.os || source.userAgent !== row.user_agent || source.clickedAt !== row.clicked_at.toISOString()) fail(409, 'IMMUTABLE_FIELD_MISMATCH');
    const actual = { matched: row.matched, matched_at: row.matched_at?.toISOString() ?? null, matched_device_id: row.matched_device_id,
      app_instance_id: row.app_instance_id, claimed_user_id: row.claimed_user_id, claimed_at: row.claimed_at?.toISOString() ?? null };
    const expected = row.compat_applied ? row.audit : { matched: source.matched, matched_at: source.matchedAt,
      matched_device_id: source.matchedDeviceId, app_instance_id: source.appInstanceId, claimed_user_id: source.claimedUserId, claimed_at: source.claimedAt };
    if (!expected || canonical(actual) !== canonical(expected)) fail(409, 'TRANSITION_AUDIT_MISMATCH');
  }
  return { verified: rows.rowCount, sourceChecksum: run.source_checksum };
}

export async function verifyMigration(id: string, close = false) {
  return withTransaction(async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    // 독점 run 락이 기존 import/compat TX를 drain하고 늦은 import를 막는다.
    await tx.query(`SELECT id FROM migration_runs WHERE id=$1 FOR ${close ? 'UPDATE' : 'SHARE'}`, [id]);
    const result = await verify(tx, id);
    if (close) await tx.query("UPDATE migration_runs SET state='IMPORT_CLOSED',closed_at=COALESCE(closed_at,now()) WHERE id=$1", [id]);
    return result;
  });
}

export type FrozenLink = Pick<FrozenClick, 'linkId' | 'slug' | 'groupId' | 'inviterId' | 'linkVersion' |
  'membershipEpoch' | 'transitionSeq' | 'groupName' | 'inviterName' | 'groupNameVersion' | 'inviterNameVersion' |
  'groupClosed' | 'linkStatus' | 'linkCreatedAt' | 'revokedAt'>;

export function frozenLink(value: unknown): FrozenLink {
  const b = object(value);
  const link: FrozenLink = { linkId: uuid(b.linkId), slug: text(b.slug, 12), groupId: uuid(b.groupId), inviterId: uuid(b.inviterId),
    linkVersion: version(b.linkVersion), membershipEpoch: version(b.membershipEpoch), transitionSeq: version(b.transitionSeq),
    groupName: text(b.groupName), inviterName: b.inviterName == null ? null : text(b.inviterName),
    groupClosed: b.groupClosed === true, linkStatus: b.linkStatus === 'REVOKED' ? 'REVOKED' : 'ACTIVE',
    groupNameVersion: version(b.groupNameVersion), inviterNameVersion: version(b.inviterNameVersion),
    linkCreatedAt: timestamp(b.linkCreatedAt)!, revokedAt: timestamp(b.revokedAt, true) };
  if (!/^[a-z0-9]{1,12}$/.test(link.slug) || (link.linkStatus === 'REVOKED') !== (link.revokedAt !== null)) fail(400, 'INVALID_FROZEN_LINK');
  return link;
}

async function verifyLinks(tx: PoolClient, id: string, run: { expected_links: string | null; link_checksum: string | null; state: string }) {
  const rows = await tx.query(`SELECT m.source_checksum,m.frozen_source,l.* FROM migration_links m JOIN links l ON l.id=m.link_id
    WHERE m.migration_id=$1 ORDER BY m.link_id`, [id]);
  if (run.expected_links === null || BigInt(rows.rowCount!) !== BigInt(run.expected_links)) fail(409, 'LINK_IMPORT_COUNT_MISMATCH');
  const manifest = rows.rows.map(row => ({ linkId: row.id, sourceChecksum: row.source_checksum }));
  if (checksum(manifest) !== run.link_checksum) fail(409, 'LINK_MANIFEST_CHECKSUM_MISMATCH');
  const stored = await tx.query<{ group_id: string; inviter_id: string; group_name_version: string; inviter_name_version: string }>(
    `SELECT d.* FROM link_display_snapshots d
    JOIN (SELECT DISTINCT group_id,inviter_id FROM links WHERE id=ANY($1::uuid[])) k
      ON k.group_id=d.group_id AND k.inviter_id=d.inviter_id`, [rows.rows.map(row => row.id)]);
  const display = new Map(stored.rows.map(row => [`${row.group_id}:${row.inviter_id}`, row] as const));
  for (const row of rows.rows) {
    const source = frozenLink(row.frozen_source);
    if (checksum(source) !== row.source_checksum || source.linkId !== row.id || source.slug !== row.slug
      || source.groupId !== row.group_id || source.inviterId !== row.inviter_id || source.linkVersion !== row.link_version
      || source.linkCreatedAt !== row.created_at.toISOString()) fail(409, 'FROZEN_LINK_CONFLICT');
    // IMPORT_CLOSED 이후에는 정당한 명령으로 상태가 바뀔 수 있으므로 옛 snapshot으로 되돌리지 않는다.
    if (run.state === 'IMPORTING' && (source.groupName !== row.group_name || source.inviterName !== row.inviter_name
      || source.groupClosed !== row.group_closed || source.linkStatus !== row.status
      || source.revokedAt !== (row.revoked_at?.toISOString() ?? null))) fail(409, 'FROZEN_LINK_STATE_MISMATCH');
    // 표시정보 version 이 동결값보다 낮으면 지연 rename 이 이관 이름을 되돌릴 창이 열려 있다는 뜻이다.
    const versions = display.get(`${source.groupId}:${source.inviterId}`);
    if (!versions || BigInt(versions.group_name_version) < BigInt(source.groupNameVersion)
      || BigInt(versions.inviter_name_version) < BigInt(source.inviterNameVersion)) fail(409, 'FROZEN_DISPLAY_VERSION_MISMATCH');
  }
}
