import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { frozen, frozenLink, importBatch, verifyMigration } from '../src/lib/migration';
import { checksum } from '../src/lib/ledger';
import { hashIp } from '../src/lib/public-contract';
import { claim, confirm, findLink, match, revoke, withdraw } from '../src/lib/links';
import { ingestEvent } from '../src/lib/events';
import { getPool } from '../src/lib/db/pool';

afterEach(() => { delete process.env.LINK_MIGRATION_ID; });

function source() {
  return frozen({ clickId: randomUUID(), linkId: randomUUID(), slug: randomUUID().replaceAll('-', '').slice(0, 8),
    groupId: randomUUID(), inviterId: randomUUID(), linkVersion: '1', membershipEpoch: '1', transitionSeq: '1',
    groupName: '기존 그룹', inviterName: '기존 이름', groupNameVersion: '7', inviterNameVersion: '7',
    groupClosed: false, linkStatus: 'ACTIVE',
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

it('이관이 표시정보 필드별 version까지 복원해 동결 이전 지연 rename이 이름을 되돌리지 못한다', async () => {
  const row = source(), migrationId = randomUUID();
  await importBatch({ ...linkManifest(row), migrationId, expectedClicks: 0, sourceChecksum: checksum([]), clicks: [] });
  const event = (type: string, snapshotVersion: number, params: object) => ({
    eventId: randomUUID(), schemaVersion: 1, type, version: 100, userId: row.inviterId,
    occurredAt: new Date().toISOString(),
    params: { groupId: row.groupId, inviterId: row.inviterId, snapshotVersion, ...params },
  });
  // 동결(version 7) «이전» 에 발행돼 이관 뒤 도착한 사건이다. 적용되면 이름이 옛 값으로 되돌아간다.
  await ingestEvent(event('group.renamed', 3, { groupName: '동결 이전 이름' }));
  await ingestEvent(event('user.displayNameChanged', 3, { inviterDisplayName: '동결 이전 닉' }));
  expect(await findLink(row.slug)).toMatchObject({ group_name: row.groupName, inviter_name: row.inviterName });
  // 복원이 빠져 version 이 0 으로 남으면 verify 가 그 되돌림 창을 잡는다.
  await getPool().query('UPDATE link_display_snapshots SET group_name_version=0 WHERE group_id=$1 AND inviter_id=$2',
    [row.groupId, row.inviterId]);
  await expect(verifyMigration(migrationId)).rejects.toMatchObject({ code: 'FROZEN_DISPLAY_VERSION_MISMATCH' });
  await getPool().query('UPDATE link_display_snapshots SET group_name_version=7 WHERE group_id=$1 AND inviter_id=$2',
    [row.groupId, row.inviterId]);
  // 동결 이후 사건은 그대로 적용된다 — 되돌림 방지가 갱신 자체를 막아서는 안 된다.
  await ingestEvent(event('group.renamed', 8, { groupName: '동결 이후 이름' }));
  expect((await findLink(row.slug))!.group_name).toBe('동결 이후 이름');
});

/** 구 운영이 가입 검증 없이 남긴 귀속을 담은 클릭. */
function claimed(user: string) {
  const row = source();
  return frozen({ ...row, matched: true, matchedAt: new Date().toISOString(), matchedDeviceId: randomUUID(),
    claimedUserId: user, claimedAt: new Date().toISOString() });
}

function clickManifest(row: ReturnType<typeof source>, migrationId: string) {
  const entry = { source: row, sourceChecksum: checksum(row) };
  return { ...linkManifest(row), migrationId, expectedClicks: 1, clicks: [entry],
    sourceChecksum: checksum([{ clickId: row.clickId, sourceChecksum: entry.sourceChecksum }]) };
}

it('구 claimed_user_id는 LEGACY 원장으로만 복원되고 진짜 Data 확정 명령에만 승격된다', async () => {
  const user = randomUUID(), row = claimed(user), migrationId = randomUUID();
  await importBatch(clickManifest(row, migrationId));
  const legacy = (await getPool().query('SELECT * FROM link_claims WHERE link_id=$1', [row.linkId])).rows[0];
  expect(legacy).toMatchObject({ status: 'LEGACY', claimed_user_id: user, click_id: row.clickId, confirm_proof: null });
  expect((await getPool().query('SELECT claim_id FROM link_clicks WHERE id=$1', [row.clickId])).rows[0].claim_id).toBe(legacy.id);
  // 원장 행이 없으면 같은 사용자의 재시도가 capability 없이 끝난다 — 같은 claimId로 이어져야 한다.
  const retried = await claim(row.slug, user, randomUUID());
  expect(retried.claimId).toBe(legacy.id);
  expect(retried.capability).toBeTruthy();
  // 이관만으로는 확정이 아니다. 확정 근거를 실은 Data 명령이 와야 CONFIRMED 가 된다.
  const applied = await confirm(legacy.id, { groupId: row.groupId, inviterId: row.inviterId,
    membershipEpoch: row.linkVersion, transitionSeq: '2',
    proof: { confirmationId: randomUUID(), committedAt: new Date().toISOString() } }, randomUUID());
  expect(applied).toEqual({ applied: true });
  expect((await getPool().query('SELECT status FROM link_claims WHERE id=$1', [legacy.id])).rows[0].status).toBe('CONFIRMED');
});

it('폐기가 먼저 도착하면 지연 import의 legacy 귀속은 승격되지 않는다', async () => {
  const user = randomUUID(), row = claimed(user), migrationId = randomUUID();
  const body = { groupId: row.groupId, inviterId: row.inviterId };
  await revoke({ ...body, membershipEpoch: '2', linkVersion: row.linkVersion, transitionSeq: '5' }, randomUUID());
  await importBatch(clickManifest(row, migrationId));
  const legacy = (await getPool().query('SELECT * FROM link_claims WHERE link_id=$1', [row.linkId])).rows[0];
  expect(legacy.status).toBe('LEGACY');
  // 낡은 세대로 온 확정은 CLAIM_MISMATCH 이고, 현 세대로 오면 원장 행의 세대와 어긋난다.
  await expect(confirm(legacy.id, { ...body, membershipEpoch: '2', transitionSeq: '6',
    proof: { confirmationId: randomUUID(), committedAt: new Date().toISOString() } }, randomUUID()))
    .rejects.toMatchObject({ code: 'CLAIM_MISMATCH' });
  expect(await confirm(legacy.id, { ...body, membershipEpoch: row.linkVersion, transitionSeq: '4',
    proof: { confirmationId: randomUUID(), committedAt: new Date().toISOString() } }, randomUUID())).toEqual({ applied: false });
  expect((await getPool().query('SELECT status FROM link_claims WHERE id=$1', [legacy.id])).rows[0].status).toBe('LEGACY');
});

it('탈퇴 뒤 늦게 도착한 import는 익명화된 귀속을 되살리지 않는다', async () => {
  const user = randomUUID(), row = claimed(user), migrationId = randomUUID();
  await withdraw(user, { transitionSeq: '1' }, randomUUID());
  await importBatch(clickManifest(row, migrationId));
  const click = (await getPool().query('SELECT claimed_user_id,claimed_at,claim_id FROM link_clicks WHERE id=$1', [row.clickId])).rows[0];
  expect(click.claimed_user_id).toBeNull();
  expect(click.claim_id).toBeNull();
  expect((await getPool().query('SELECT count(*)::int AS n FROM link_claims WHERE claimed_user_id=$1', [user])).rows[0].n).toBe(0);
  // 원본과 달라진 상태는 같은 TX 의 감사로 설명된다 — 검증이 이관 종료를 막으면 안 된다.
  expect((await verifyMigration(migrationId)).verified).toBe(1);
});

it('호환 소진과 벌크 적재가 동시에 돌아도 독점 run 락 없이 각자 다른 후보만 소비한다', async () => {
  const first = source(), migrationId = randomUUID();
  const rows = [first, frozen({ ...first, clickId: randomUUID(), clickedAt: new Date(Date.now() - 1000).toISOString() })];
  const entries = rows.map(source => ({ source, sourceChecksum: checksum(source) }));
  const manifest = { ...linkManifest(first), migrationId, expectedClicks: rows.length, clicks: [],
    sourceChecksum: checksum(entries.map(e => ({ clickId: e.source.clickId, sourceChecksum: e.sourceChecksum }))
      .sort((a, b) => a.clickId.localeCompare(b.clickId))) };
  await importBatch({ ...manifest, links: [] });
  const devices = [randomUUID(), randomUUID()];
  const results = await Promise.all([
    ...devices.map(deviceId => match({ ipHash: first.ipHash, os: first.os, deviceId, migrationId, frozenCandidates: entries })),
    importBatch({ ...manifest, clicks: entries }),
  ]);
  expect(results.slice(0, 2)).toEqual([{ matched: true, slug: first.slug, groupId: first.groupId },
    { matched: true, slug: first.slug, groupId: first.groupId }]);
  const consumed = await getPool().query('SELECT matched_device_id FROM link_clicks WHERE id=ANY($1::uuid[]) AND matched',
    [rows.map(row => row.clickId)]);
  expect(consumed.rows.map(row => row.matched_device_id).sort()).toEqual([...devices].sort());
  expect((await verifyMigration(migrationId)).verified).toBe(2);
});
