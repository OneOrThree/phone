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
  // 백필(link→click)과 호환 소진(click→link)의 교착을 이관 단위 고정 순서로 막는다.
  await lock(tx, `migration-import:${id}`);
  const row = (await tx.query('SELECT * FROM migration_runs WHERE id=$1 FOR SHARE', [id])).rows[0];
  if (!row) fail(409, 'MIGRATION_NOT_INITIALIZED');
  if (row.state !== 'IMPORTING') fail(409, 'IMPORT_CLOSED');
  return row;
}

export async function importClick(tx: PoolClient, migrationId: string, source: FrozenClick, suppliedChecksum: string) {
  if (checksum(source) !== suppliedChecksum) fail(409, 'SOURCE_CHECKSUM_MISMATCH');
  await lock(tx, `migration-click:${source.clickId}`);
  const previous = (await tx.query('SELECT * FROM migration_clicks WHERE migration_id=$1 AND click_id=$2 FOR UPDATE', [migrationId, source.clickId])).rows[0];
  if (previous) {
    if (previous.source_checksum !== suppliedChecksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    return; // 신 원장의 매치·claim 상태를 구 값으로 다시 쓰지 않는다.
  }
  await importLink(tx, migrationId, frozenLink(source), checksum(frozenLink(source)));
  const existing = (await tx.query('SELECT id FROM link_clicks WHERE id=$1', [source.clickId])).rowCount;
  if (existing) fail(409, 'UNTRACKED_LEGACY_CLICK');
  await tx.query(`INSERT INTO link_clicks(id,link_id,ip_hash,os,user_agent,clicked_at,matched,matched_at,matched_device_id,
    app_instance_id,claimed_user_id,claimed_at,legacy_click_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$1)`,
  [source.clickId, source.linkId, source.ipHash, source.os, source.userAgent, source.clickedAt, source.matched,
    source.matchedAt, source.matchedDeviceId, source.appInstanceId, source.claimedUserId, source.claimedAt]);
  await tx.query('INSERT INTO migration_clicks(migration_id,click_id,source_checksum,frozen_source) VALUES($1,$2,$3,$4)',
    [migrationId, source.clickId, suppliedChecksum, JSON.stringify(source)]);
}

/** 후보 500개도 SQL 왕복은 상수 개수다. run 잠금 안에서 적재·소진·감사가 함께 커밋된다. */
export async function importClicks(tx: PoolClient, migrationId: string, values: unknown[]) {
  const entries = new Map<string, { source: FrozenClick; sourceChecksum: string }>();
  for (const value of values) {
    const entry = object(value), source = frozen(entry.source), sourceChecksum = text(entry.sourceChecksum, 64);
    if (checksum(source) !== sourceChecksum) fail(409, 'SOURCE_CHECKSUM_MISMATCH');
    if (entries.has(source.clickId) && entries.get(source.clickId)!.sourceChecksum !== sourceChecksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.set(source.clickId, { source, sourceChecksum });
  }
  if (!entries.size) return;
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
}

async function importLinks(tx: PoolClient, migrationId: string, sources: FrozenLink[]) {
  const entries = new Map<string, { source: FrozenLink; sourceChecksum: string }>();
  for (const source of sources) {
    const sourceChecksum = checksum(source);
    if (entries.has(source.linkId) && entries.get(source.linkId)!.sourceChecksum !== sourceChecksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.set(source.linkId, { source, sourceChecksum });
  }
  const previous = await tx.query('SELECT link_id,source_checksum FROM migration_links WHERE migration_id=$1 AND link_id=ANY($2::uuid[])',
    [migrationId, [...entries.keys()]]);
  for (const row of previous.rows) {
    if (entries.get(row.link_id)!.sourceChecksum !== row.source_checksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    entries.delete(row.link_id);
  }
  if (!entries.size) return;
  // 다른 회차 importer와도 기존 단건 importer의 링크별 잠금 이름을 공유한다.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('migration-link:'||id,0)) FROM (SELECT unnest($1::text[]) AS id ORDER BY id) ids", [[...entries.keys()]]);
  const payload = JSON.stringify([...entries.values()]);
  await tx.query(`INSERT INTO membership_epochs(group_id,inviter_id,epoch,transition_seq)
    SELECT DISTINCT ON (s->>'groupId',s->>'inviterId') (s->>'groupId')::uuid,(s->>'inviterId')::uuid,
      (s->>'membershipEpoch')::bigint,(s->>'transitionSeq')::bigint
    FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    ORDER BY s->>'groupId',s->>'inviterId',(s->>'transitionSeq')::bigint DESC
    ON CONFLICT(group_id,inviter_id) DO NOTHING`, [payload]);
  await tx.query(`INSERT INTO links(id,slug,group_id,inviter_id,link_version,status,revoked_at,group_name,inviter_name,group_closed,created_at)
    SELECT (s->>'linkId')::uuid,s->>'slug',(s->>'groupId')::uuid,(s->>'inviterId')::uuid,
      (s->>'linkVersion')::bigint,s->>'linkStatus',(s->>'revokedAt')::timestamptz,s->>'groupName',s->>'inviterName',
      (s->>'groupClosed')::boolean,(s->>'linkCreatedAt')::timestamptz
    FROM (SELECT e->'source' AS s FROM jsonb_array_elements($1::jsonb) e) sources
    ORDER BY s->>'linkId' ON CONFLICT(id) DO NOTHING`, [payload]);
  const actual = await tx.query('SELECT id,slug,group_id,inviter_id,link_version FROM links WHERE id=ANY($1::uuid[])', [[...entries.keys()]]);
  if (actual.rows.length !== entries.size) fail(409, 'FROZEN_LINK_CONFLICT');
  for (const row of actual.rows) {
    const source = entries.get(row.id)!.source;
    if (row.slug !== source.slug || row.group_id !== source.groupId || row.inviter_id !== source.inviterId
        || row.link_version !== source.linkVersion) fail(409, 'FROZEN_LINK_CONFLICT');
  }
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
  const entries = body.clicks, links = body.links as unknown[];
  return withTransaction(async tx => {
    await tx.query("INSERT INTO migration_runs(id,source_checksum,state,expected_clicks,expected_links,link_checksum) VALUES($1,$2,'IMPORTING',$3,$4,$5) ON CONFLICT(id) DO NOTHING", [id, manifest, count, expectedLinks, linkChecksum]);
    const run = await openRun(tx, id);
    if (run.source_checksum !== manifest || run.expected_clicks !== count || run.expected_links !== expectedLinks || run.link_checksum !== linkChecksum) fail(409, 'MANIFEST_CHANGED');
    for (const value of links) {
      const entry = object(value);
      await importLink(tx, id, frozenLink(entry.source), text(entry.sourceChecksum, 64));
    }
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
  'membershipEpoch' | 'transitionSeq' | 'groupName' | 'inviterName' | 'groupClosed' | 'linkStatus' | 'linkCreatedAt' | 'revokedAt'>;

export function frozenLink(value: unknown): FrozenLink {
  const b = object(value);
  const link: FrozenLink = { linkId: uuid(b.linkId), slug: text(b.slug, 12), groupId: uuid(b.groupId), inviterId: uuid(b.inviterId),
    linkVersion: version(b.linkVersion), membershipEpoch: version(b.membershipEpoch), transitionSeq: version(b.transitionSeq),
    groupName: text(b.groupName), inviterName: b.inviterName == null ? null : text(b.inviterName),
    groupClosed: b.groupClosed === true, linkStatus: b.linkStatus === 'REVOKED' ? 'REVOKED' : 'ACTIVE',
    linkCreatedAt: timestamp(b.linkCreatedAt)!, revokedAt: timestamp(b.revokedAt, true) };
  if (!/^[a-z0-9]{1,12}$/.test(link.slug) || (link.linkStatus === 'REVOKED') !== (link.revokedAt !== null)) fail(400, 'INVALID_FROZEN_LINK');
  return link;
}

async function importLink(tx: PoolClient, migrationId: string, source: FrozenLink, suppliedChecksum: string) {
  if (checksum(source) !== suppliedChecksum) fail(409, 'SOURCE_CHECKSUM_MISMATCH');
  await lock(tx, `migration-link:${source.linkId}`);
  const previous = (await tx.query('SELECT source_checksum FROM migration_links WHERE migration_id=$1 AND link_id=$2', [migrationId, source.linkId])).rows[0];
  if (previous) {
    if (previous.source_checksum !== suppliedChecksum) fail(409, 'FROZEN_SOURCE_CHANGED');
    return;
  }
  await tx.query(`INSERT INTO membership_epochs(group_id,inviter_id,epoch,transition_seq) VALUES($1,$2,$3,$4)
    ON CONFLICT(group_id,inviter_id) DO NOTHING`, [source.groupId, source.inviterId, source.membershipEpoch, source.transitionSeq]);
  await tx.query(`INSERT INTO links(id,slug,group_id,inviter_id,link_version,status,revoked_at,group_name,inviter_name,group_closed,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
  [source.linkId, source.slug, source.groupId, source.inviterId, source.linkVersion, source.linkStatus, source.revokedAt,
    source.groupName, source.inviterName, source.groupClosed, source.linkCreatedAt]);
  const link = (await tx.query('SELECT * FROM links WHERE id=$1', [source.linkId])).rows[0];
  if (!link || link.slug !== source.slug || link.group_id !== source.groupId || link.inviter_id !== source.inviterId
      || link.link_version !== source.linkVersion) fail(409, 'FROZEN_LINK_CONFLICT');

  await tx.query(`INSERT INTO group_snapshots(group_id,name,version,closed) VALUES($1,$2,0,$3)
    ON CONFLICT(group_id) DO UPDATE SET closed=group_snapshots.closed OR EXCLUDED.closed`, [source.groupId, source.groupName, source.groupClosed]);
  await tx.query('INSERT INTO migration_links(migration_id,link_id,source_checksum,frozen_source) VALUES($1,$2,$3,$4)',
    [migrationId, source.linkId, suppliedChecksum, JSON.stringify(source)]);
}

async function verifyLinks(tx: PoolClient, id: string, run: { expected_links: string | null; link_checksum: string | null; state: string }) {
  const rows = await tx.query(`SELECT m.source_checksum,m.frozen_source,l.* FROM migration_links m JOIN links l ON l.id=m.link_id
    WHERE m.migration_id=$1 ORDER BY m.link_id`, [id]);
  if (run.expected_links === null || BigInt(rows.rowCount!) !== BigInt(run.expected_links)) fail(409, 'LINK_IMPORT_COUNT_MISMATCH');
  const manifest = rows.rows.map(row => ({ linkId: row.id, sourceChecksum: row.source_checksum }));
  if (checksum(manifest) !== run.link_checksum) fail(409, 'LINK_MANIFEST_CHECKSUM_MISMATCH');
  for (const row of rows.rows) {
    const source = frozenLink(row.frozen_source);
    if (checksum(source) !== row.source_checksum || source.linkId !== row.id || source.slug !== row.slug
      || source.groupId !== row.group_id || source.inviterId !== row.inviter_id || source.linkVersion !== row.link_version
      || source.linkCreatedAt !== row.created_at.toISOString()) fail(409, 'FROZEN_LINK_CONFLICT');
    // IMPORT_CLOSED 이후에는 정당한 명령으로 상태가 바뀔 수 있으므로 옛 snapshot으로 되돌리지 않는다.
    if (run.state === 'IMPORTING' && (source.groupName !== row.group_name || source.inviterName !== row.inviter_name
      || source.groupClosed !== row.group_closed || source.linkStatus !== row.status
      || source.revokedAt !== (row.revoked_at?.toISOString() ?? null))) fail(409, 'FROZEN_LINK_STATE_MISMATCH');
  }
}
