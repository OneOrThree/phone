import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { frozen, frozenLink, importBatch, verifyMigration } from '../src/lib/migration';
import { checksum } from '../src/lib/ledger';
import { hashIp } from '../src/lib/public-contract';
import { match } from '../src/lib/links';
import { getPool } from '../src/lib/db/pool';

afterEach(() => { delete process.env.LINK_MIGRATION_ID; });

function source() {
  return frozen({ clickId: randomUUID(), linkId: randomUUID(), slug: randomUUID().replaceAll('-', '').slice(0, 8),
    groupId: randomUUID(), inviterId: randomUUID(), linkVersion: '1', membershipEpoch: '1', transitionSeq: '1',
    groupName: '기존 그룹', inviterName: '기존 이름', groupClosed: false, linkStatus: 'ACTIVE',
    linkCreatedAt: new Date().toISOString(), revokedAt: null,
    ipHash: hashIp(randomUUID()), os: 'ios', userAgent: 'iPhone', clickedAt: new Date().toISOString(),
    matched: false, matchedAt: null, matchedDeviceId: null, appInstanceId: null, claimedUserId: null, claimedAt: null });
}

it('호환 소비와 최종 백필이 경합해도 신 소비 상태와 체크섬/감사가 유지된다', async () => {
  const row = source(), entry = { source: row, sourceChecksum: checksum(row) }, migrationId = randomUUID();
  const body = { ...linkManifest(row), migrationId, expectedClicks: 1, sourceChecksum: checksum([{ clickId: row.clickId, sourceChecksum: entry.sourceChecksum }]), clicks: [entry] };
  await importBatch(body);
  const device = randomUUID();
  const results = await Promise.all([
    match({ ipHash: row.ipHash, os: row.os, deviceId: device, migrationId, frozenCandidates: [entry] }),
    importBatch(body),
  ]);
  expect(results[0]).toMatchObject({ matched: true, slug: row.slug });
  await importBatch(body);
  expect((await verifyMigration(migrationId)).verified).toBe(1);
  const current = (await getPool().query('SELECT matched_device_id FROM link_clicks WHERE id=$1', [row.clickId])).rows[0];
  expect(current.matched_device_id).toBe(device);
  await verifyMigration(migrationId, true);
  await expect(importBatch(body)).rejects.toMatchObject({ code: 'IMPORT_CLOSED' });
});

it('불완전 백필과 원본 변경은 검증을 실패시키고 직접 쓰기를 열지 않는다', async () => {
  const row = source(), entry = { source: row, sourceChecksum: checksum(row) }, migrationId = randomUUID();
  const body = { ...linkManifest(row), migrationId, expectedClicks: 2, sourceChecksum: checksum([]), clicks: [entry] };
  await importBatch(body);
  process.env.LINK_MIGRATION_ID = migrationId;
  await expect(match({ ipHash: row.ipHash, os: 'ios', deviceId: randomUUID() })).rejects.toMatchObject({ code: 'IMPORT_IN_PROGRESS' });
  await expect(verifyMigration(migrationId, true)).rejects.toMatchObject({ code: 'IMPORT_COUNT_MISMATCH' });
  const changed = { ...row, groupName: '정지 후 변경' };
  await expect(importBatch({ ...body, clicks: [{ source: changed, sourceChecksum: checksum(changed) }] }))
    .rejects.toMatchObject({ code: 'FROZEN_SOURCE_CHANGED' });
  expect((await getPool().query('SELECT state FROM migration_runs WHERE id=$1', [migrationId])).rows[0].state).toBe('IMPORTING');
});

it('동일 트랜잭션에 감사가 빠진 소비 변경은 이관 종료를 막는다', async () => {
  const row = source(), entry = { source: row, sourceChecksum: checksum(row) }, migrationId = randomUUID();
  await importBatch({ ...linkManifest(row), migrationId, expectedClicks: 1, sourceChecksum: checksum([{ clickId: row.clickId, sourceChecksum: entry.sourceChecksum }]), clicks: [entry] });
  await getPool().query('UPDATE link_clicks SET matched=true,matched_at=now(),matched_device_id=$2 WHERE id=$1', [row.clickId, randomUUID()]);
  await expect(verifyMigration(migrationId, true)).rejects.toMatchObject({ code: 'TRANSITION_AUDIT_MISMATCH' });
});

function linkManifest(row: unknown) {
  const source = frozenLink(row), sourceChecksum = checksum(source);
  return { expectedLinks: 1, links: [{ source, sourceChecksum }], linkChecksum: checksum([{ linkId: source.linkId, sourceChecksum }]) };
}

it('클릭 0건인 기존 링크도 독립 manifest로 보존하며 누락되면 종료하지 않는다', async () => {
  const row = source(), migrationId = randomUUID(), manifest = linkManifest(row);
  const body = { ...manifest, migrationId, expectedClicks: 0, sourceChecksum: checksum([]), clicks: [] };
  await importBatch({ ...body, links: [] });
  await expect(verifyMigration(migrationId, true)).rejects.toMatchObject({ code: 'LINK_IMPORT_COUNT_MISMATCH' });
  await importBatch(body);
  await verifyMigration(migrationId, true);
  const link = (await getPool().query('SELECT slug,group_name FROM links WHERE id=$1', [row.linkId])).rows[0];
  expect(link).toEqual({ slug: row.slug, group_name: row.groupName });
});

it('500개 호환 후보를 한 트랜잭션에 적재하고 소진한 뒤 재백필해도 상태를 되돌리지 않는다', async () => {
  const first = source(), migrationId = randomUUID();
  const rows = Array.from({ length: 500 }, (_, i) => frozen({ ...first, clickId: randomUUID(),
    clickedAt: new Date(Date.now() - i * 1000).toISOString() }));
  const entries = rows.map(source => ({ source, sourceChecksum: checksum(source) }));
  const manifest = { ...linkManifest(first), migrationId, expectedClicks: rows.length,
    sourceChecksum: checksum(entries.map(e => ({ clickId: e.source.clickId, sourceChecksum: e.sourceChecksum }))
      .sort((a, b) => a.clickId.localeCompare(b.clickId))), clicks: [] };
  await importBatch({ ...manifest, links: [] });
  const device = randomUUID();
  expect(await match({ ipHash: first.ipHash, os: first.os, deviceId: device, migrationId, frozenCandidates: entries }))
    .toMatchObject({ matched: true, slug: first.slug });
  expect((await verifyMigration(migrationId)).verified).toBe(500);
  await importBatch({ ...manifest, clicks: entries.slice(0, 20) });
  expect((await getPool().query('SELECT count(*)::int AS n FROM link_clicks WHERE id=ANY($1::uuid[]) AND matched',
    [rows.map(r => r.clickId)])).rows[0].n).toBe(1);
  expect(await match({ ipHash: first.ipHash, os: first.os, deviceId: device, migrationId, frozenCandidates: entries }))
    .toMatchObject({ matched: true, slug: first.slug });
  await verifyMigration(migrationId, true);
});
