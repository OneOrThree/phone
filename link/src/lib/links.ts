import { getPool, withTransaction, type PoolClient } from './db/pool';
import { baseUrl, matchWindowHours } from './env';
import { fail, object, text, uuid, version } from './errors';
import { activeUsers, idempotent, lock } from './ledger';
import { generateSlug } from './public-contract';
import { capability } from './auth';
import { auditTransition, auditTransitions, importClicks, openRun, requireDirectWrites } from './migration';
import { analytics } from './analytics';

export interface LinkRow {
  id: string; slug: string; group_id: string; inviter_id: string; link_version: string;
  snapshot_version: string;
  status: 'ACTIVE' | 'REVOKED'; group_closed: boolean; group_name: string; inviter_name: string | null;
}

function live(link: LinkRow): boolean { return link.status === 'ACTIVE' && !link.group_closed; }
function matchResult(link?: LinkRow) {
  return link && live(link) ? { matched: true, slug: link.slug, groupId: link.group_id } : { matched: false };
}

export async function findLink(slug: string): Promise<LinkRow | undefined> {
  return (await getPool().query<LinkRow>('SELECT * FROM links WHERE slug=$1', [slug])).rows[0];
}

async function membership(tx: PoolClient, group: string, inviter: string) {
  await lock(tx, `membership:${group}:${inviter}`);
  return (await tx.query('SELECT epoch,transition_seq FROM membership_epochs WHERE group_id=$1 AND inviter_id=$2', [group, inviter])).rows[0];
}

export async function issue(input: unknown, key: string, delegated?: string) {
  const body = object(input), group = uuid(body.groupId), inviter = uuid(body.inviterId);
  if (delegated && delegated !== inviter) fail(403, 'USER_MISMATCH');
  const epoch = version(body.membershipEpoch), linkVersion = version(body.linkVersion);
  const seq = version(body.transitionSeq), snapshot = version(body.snapshotVersion);
  if (epoch !== linkVersion) fail(400, 'ISSUE_EPOCH_MISMATCH');
  const name = text(body.groupName), display = body.inviterDisplayName == null ? null : text(body.inviterDisplayName);
  let created: LinkRow | undefined;
  const result = await idempotent(`issue:${inviter}`, key, body, async tx => {
    await requireDirectWrites(tx);
    await activeUsers(tx, inviter);
    await lock(tx, `group:${group}`);
    const previous = await membership(tx, group, inviter);
    if (previous && (BigInt(previous.epoch) > BigInt(epoch) || BigInt(previous.transition_seq) > BigInt(seq))) fail(409, 'STALE_MEMBERSHIP');
    const groupSnapshot = (await tx.query('SELECT * FROM group_snapshots WHERE group_id=$1', [group])).rows[0];
    if (groupSnapshot?.closed) fail(410, 'GROUP_CLOSED');
    await tx.query(`INSERT INTO membership_epochs(group_id,inviter_id,epoch,transition_seq) VALUES($1,$2,$3,$4)
      ON CONFLICT(group_id,inviter_id) DO UPDATE SET epoch=EXCLUDED.epoch,transition_seq=EXCLUDED.transition_seq,updated_at=now()`, [group, inviter, epoch, seq]);
    const names = await displaySnapshot(tx, group, inviter, snapshot, name, display);
    let row: LinkRow | undefined = (await tx.query<LinkRow>("SELECT * FROM links WHERE group_id=$1 AND inviter_id=$2 AND status='ACTIVE'", [group, inviter])).rows[0];
    if (row && row.link_version !== linkVersion) {
      await tx.query("UPDATE links SET status='REVOKED',revoked_at=now(),revoke_reason='MEMBERSHIP_ADVANCED' WHERE id=$1", [row.id]);
      row = undefined;
    }
    if (!row) {
      // slug 충돌만 재시도한다. 다른 제약 위반을 성공으로 접지 않는다.
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        row = (await tx.query<LinkRow>(`INSERT INTO links(slug,group_id,inviter_id,link_version,group_name,inviter_name,snapshot_version)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(slug) DO NOTHING RETURNING *`,
        [generateSlug(), group, inviter, linkVersion, names.group_name, names.inviter_name, snapshot])).rows[0];
      }
      if (!row) fail(503, 'SLUG_ALLOCATION_FAILED');
      created = row;
    }
    await tx.query('UPDATE links SET group_name=$3,inviter_name=$4 WHERE group_id=$1 AND inviter_id=$2',
      [group, inviter, names.group_name, names.inviter_name]);
    return { slug: row.slug, url: `${baseUrl()}/l/${row.slug}?g=${group}` };
  });
  if (created) await analytics('web', created.id, 'invite_link_created', { slug: created.slug, group_id: created.group_id });
  return result;
}

export async function revoke(input: unknown, key: string, envelope?: unknown) {
  const body = object(input), group = uuid(body.groupId), inviter = uuid(body.inviterId);
  const epoch = version(body.membershipEpoch), target = version(body.linkVersion), seq = version(body.transitionSeq);
  return idempotent(`revoke:${group}:${inviter}`, key, body, async tx => {
    await requireDirectWrites(tx);
    const previous = await membership(tx, group, inviter);
    if (previous && (BigInt(previous.epoch) > BigInt(epoch) || BigInt(previous.transition_seq) > BigInt(seq))) return { applied: false };
    await tx.query(`INSERT INTO membership_epochs(group_id,inviter_id,epoch,transition_seq) VALUES($1,$2,$3,$4)
      ON CONFLICT(group_id,inviter_id) DO UPDATE SET epoch=EXCLUDED.epoch,transition_seq=EXCLUDED.transition_seq,updated_at=now()`, [group, inviter, epoch, seq]);
    await tx.query(`UPDATE links SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()),revoke_reason='MEMBERSHIP_ENDED',updated_at=now()
      WHERE group_id=$1 AND inviter_id=$2 AND link_version=$3`, [group, inviter, target]);
    // 이미 확정된 정상 귀속은 보존하고, 지연 중 수락된 잠정 귀속만 폐기한다.
    await tx.query(`UPDATE link_claims SET status='REVOKED',revoked_at=now() WHERE group_id=$1 AND inviter_id=$2
      AND membership_epoch=$3 AND status IN ('PENDING','LEGACY')`, [group, inviter, target]);
    return { applied: true };
  }, envelope);
}

export async function recordClick(link: LinkRow, ipHash: string, os: string, ua: string, refererHost = '') {
  const click = await withTransaction(async tx => {
    await requireDirectWrites(tx);
    await lock(tx, `group:${link.group_id}`);
    const current = (await tx.query<LinkRow>('SELECT * FROM links WHERE id=$1 FOR SHARE', [link.id])).rows[0];
    if (current && live(current)) return (await tx.query('INSERT INTO link_clicks(link_id,ip_hash,os,user_agent) VALUES($1,$2,$3,$4) RETURNING id',
      [link.id, ipHash, os, ua.slice(0, 512)])).rows[0];
  });
  if (click) await analytics('web', click.id, 'invite_link_clicked', { slug: link.slug, group_id: link.group_id, os, referer_host: refererHost });
}

export async function match(input: unknown) {
  const body = object(input), ip = text(body.ipHash, 64), os = text(body.os, 16), device = text(body.deviceId, 64);
  if (!/^[0-9a-f]{64}$/.test(ip) || !['ios', 'android', 'other'].includes(os)) fail(400, 'INVALID_FINGERPRINT');
  const instance = body.appInstanceId == null ? null : text(body.appInstanceId, 64);
  let replay = false;
  const result = await withTransaction(async tx => {
    if (body.migrationId != null) {
      const id = text(body.migrationId, 100);
      await openRun(tx, id);
      if (!Array.isArray(body.frozenCandidates) || body.frozenCandidates.length > 500) fail(400, 'INVALID_COMPAT_CANDIDATES');
      await importClicks(tx, id, body.frozenCandidates);
    } else {
      await requireDirectWrites(tx);
    }
    await lock(tx, `match-device:${device}`);
    const cutoff = new Date(Date.now() - matchWindowHours() * 3600000);
    const prior = await tx.query<LinkRow>(`SELECT l.* FROM link_clicks c JOIN links l ON l.id=c.link_id
      WHERE c.matched=true AND c.matched_device_id=$1 AND c.matched_at>$2 ORDER BY c.matched_at DESC LIMIT 1`, [device, cutoff]);
    if (prior.rowCount && live(prior.rows[0]!)) { replay = true; return matchResult(prior.rows[0]); }
    const candidate = await tx.query<LinkRow & { click_id: string }>(`SELECT l.*,c.id AS click_id FROM link_clicks c JOIN links l ON l.id=c.link_id
      WHERE c.ip_hash=$1 AND c.os=$2 AND c.matched=false AND c.clicked_at>$3
      ORDER BY c.clicked_at DESC LIMIT 1 FOR UPDATE OF c SKIP LOCKED`, [ip, os, cutoff]);
    const row = candidate.rows[0];
    if (!row) return matchResult();
    // 후보 «클릭» 만 잠그면 폐기·탈퇴·그룹 종료와 직렬화되지 않는다 — 조인으로 함께 읽은 links 는
    // 그 시점의 사본이라, 소진 직전에 커밋된 폐기를 못 보고 죽은 링크를 살아있다고 돌려준다.
    // 원장 공통 순서(group → membership)를 그대로 따라 잠그고, 링크를 다시 읽어 판정한다.
    // revoke 는 group 락을 안 잡고 withdraw 는 둘 다 안 잡으므로 links 행 공유 락까지 있어야 닫힌다.
    await lock(tx, `group:${row.group_id}`);
    await membership(tx, row.group_id, row.inviter_id);
    const fresh = (await tx.query<LinkRow>('SELECT * FROM links WHERE id=$1 FOR SHARE', [row.id])).rows[0];
    // 판정이 뒤집혀도 소진 자체는 그대로 둔다 — 죽은 후보가 남으면 같은 IP·OS 의 이후 클릭을 계속 가린다.
    await tx.query('UPDATE link_clicks SET matched=true,matched_at=now(),matched_device_id=$2,app_instance_id=$3 WHERE id=$1', [row.click_id, fresh && live(fresh) ? device : null, instance]);
    await auditTransition(tx, row.click_id);
    return matchResult(fresh);
  });
  if (!replay) await analytics(instance ? 'app' : 'web', instance ?? device, 'invite_match_resolved', {
    matched: result.matched, matched_by: 'ip_os_window', slug: result.slug, group_id: result.groupId,
  });
  return result;
}

export async function claim(slug: string, userId: string, key: string) {
  const result = await idempotent(`claim:${userId}`, key, { slug, userId }, async tx => {
    await requireDirectWrites(tx);
    const link = (await tx.query<LinkRow>('SELECT * FROM links WHERE slug=$1', [slug])).rows[0];
    if (!link) fail(404, 'SLUG_NOT_FOUND');
    await activeUsers(tx, userId, link.inviter_id);
    await lock(tx, `group:${link.group_id}`);
    await membership(tx, link.group_id, link.inviter_id);
    const current = (await tx.query<LinkRow>('SELECT * FROM links WHERE id=$1', [link.id])).rows[0];
    if (!current || !live(current) || userId === link.inviter_id) return { claimId: null, capability: null, groupId: link.group_id };
    // 이관된 LEGACY 귀속도 여기서 잡힌다 — 원장 행이 없으면 아래 후보 조회가 (claimed_user_id 가 찍힌)
    // 구 클릭을 걸러내 같은 사용자가 capability 없이 끝난다.
    const prior = (await tx.query('SELECT id,status FROM link_claims WHERE link_id=$1 AND claimed_user_id=$2', [link.id, userId])).rows[0];
    if (prior) return { claimId: prior.id, capability: capability(link), groupId: link.group_id };
    const click = (await tx.query(`SELECT id FROM link_clicks WHERE link_id=$1 AND matched=true AND claimed_user_id IS NULL
      AND claim_id IS NULL AND claimed_at IS NULL ORDER BY matched_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED`, [link.id])).rows[0];
    if (!click) return { claimId: null, capability: null, groupId: link.group_id };
    const created = (await tx.query(`INSERT INTO link_claims(link_id,slug,group_id,inviter_id,claimed_user_id,click_id,membership_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [link.id, slug, link.group_id, link.inviter_id, userId, click.id, link.link_version])).rows[0];
    await tx.query('UPDATE link_clicks SET claimed_user_id=$2,claimed_at=now(),claim_id=$3 WHERE id=$1', [click.id, userId, created.id]);
    await auditTransition(tx, click.id);
    return { claimId: created.id, capability: capability(link), groupId: link.group_id };
  });
  if (!result.claimId) return result;
  // 같은 claim의 내구 결과는 유지하되 재개 시 만료된 capability를 계속 재생하지 않는다.
  // Data가 현재 멤버십/사용자 상태를 다시 검사하므로 이 갱신이 과거 권한을 되살리지는 않는다.
  const link = await findLink(slug);
  if (!link || !live(link)) return { claimId: null, capability: null, groupId: result.groupId };
  return { ...result, capability: capability(link) };
}

export async function confirm(claimId: string, input: unknown, key: string, envelope?: unknown) {
  const body = object(input), group = uuid(body.groupId), inviter = uuid(body.inviterId);
  const seq = version(body.transitionSeq), epoch = version(body.membershipEpoch);
  const proof = object(body.proof);
  // 탈퇴 익명화와 별개로 남는 근거에는 사용자 식별자를 복제하지 않는다.
  const immutable = { confirmationId: uuid(proof.confirmationId), transitionSeq: seq,
    committedAt: text(proof.committedAt, 40), membershipEpoch: epoch };
  if (!Number.isFinite(Date.parse(immutable.committedAt))) fail(400, 'INVALID_CONFIRMATION');
  return idempotent(`confirm:${claimId}`, key, body, async tx => {
    await requireDirectWrites(tx);
    const current = await membership(tx, group, inviter);
    const row = (await tx.query('SELECT * FROM link_claims WHERE id=$1 FOR UPDATE', [claimId])).rows[0];
    if (!row || row.group_id !== group || row.inviter_id !== inviter || row.membership_epoch !== epoch) fail(409, 'CLAIM_MISMATCH');
    if (row.confirm_proof) {
      if (row.confirm_proof.confirmationId !== immutable.confirmationId || row.confirm_transition_seq !== seq) fail(409, 'CONFIRMATION_IMMUTABLE');
      return { applied: row.status === 'CONFIRMED' };
    }
    // LEGACY 는 구 운영이 가입 검증 없이 남긴 귀속이다. 아래 epoch·transitionSeq 대조를 통과한
    // «진짜» Data 확정 명령에만 CONFIRMED 로 올라간다 — 이관 자체가 확정을 만들지는 않는다.
    if ((row.status !== 'PENDING' && row.status !== 'LEGACY')
      || (current && (BigInt(current.transition_seq) > BigInt(seq) || BigInt(current.epoch) > BigInt(epoch)))) return { applied: false };
    await tx.query('UPDATE membership_epochs SET transition_seq=$3,updated_at=now() WHERE group_id=$1 AND inviter_id=$2', [group, inviter, seq]);
    await tx.query(`UPDATE link_claims SET status='CONFIRMED',confirm_proof=$2,confirmed_at=$3,confirm_transition_seq=$4 WHERE id=$1`,
      [claimId, JSON.stringify(immutable), immutable.committedAt, seq]);
    return { applied: true };
  }, envelope);
}

export async function withdraw(userId: string, input: unknown, key: string, envelope?: unknown) {
  const body = object(input), seq = version(body.transitionSeq);
  return idempotent(`withdraw:${userId}`, key, body, async tx => {
    await requireDirectWrites(tx);
    await lock(tx, `user:${userId}`);
    await tx.query(`INSERT INTO user_tombstones(user_id,transition_seq) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET transition_seq=GREATEST(user_tombstones.transition_seq,EXCLUDED.transition_seq)`, [userId, seq]);
    const claims = await tx.query("UPDATE link_claims SET claimed_user_id=NULL,status='ANONYMIZED',anonymized_at=now() WHERE claimed_user_id=$1", [userId]);
    const clicks = await tx.query('UPDATE link_clicks SET claimed_user_id=NULL WHERE claimed_user_id=$1 RETURNING id', [userId]);
    await auditTransitions(tx, clicks.rows.map(click => click.id));
    await tx.query('UPDATE joined_events SET user_id=NULL,anonymized_at=now() WHERE user_id=$1', [userId]);
    await tx.query('UPDATE user_tombstones SET anonymized_claims=anonymized_claims+$2,anonymized_clicks=anonymized_clicks+$3 WHERE user_id=$1',
      [userId, claims.rowCount, clicks.rowCount]);
    await tx.query(`UPDATE links SET inviter_name=NULL,status='REVOKED',revoked_at=COALESCE(revoked_at,now()),revoke_reason='USER_WITHDRAWN'
      WHERE inviter_id=$1`, [userId]);
    await tx.query("UPDATE link_claims SET status='REVOKED',revoked_at=now() WHERE inviter_id=$1 AND status IN ('PENDING','LEGACY')", [userId]);
    return { applied: true };
  }, envelope);
}

// 동결 DTO는 membership 표시 version만 제공한다. 서로 다른 aggregate version을 추정해
// 그룹·사용자 전체를 덮으면 지연 명령이 이관한 이름을 되돌린다. 이관 대상은 events 경로를 쓴다.
async function requireAggregateSnapshotVersion(tx: PoolClient, column: 'group_id' | 'inviter_id', id: string) {
  const imported = await tx.query(`SELECT 1 FROM migration_links m JOIN links l ON l.id=m.link_id
    WHERE l.${column}=$1 LIMIT 1`, [id]);
  if (imported.rowCount) fail(409, 'AGGREGATE_SNAPSHOT_VERSION_UNAVAILABLE');
}

export async function updateSnapshot(kind: 'groups' | 'users', id: string, input: unknown, key: string, closed = false, envelope?: unknown) {
  const body = object(input), incoming = version(body.version);
  return idempotent(`snapshot:${kind}:${id}`, key, { ...body, closed }, async tx => {
    await requireDirectWrites(tx);
    if (kind === 'groups') {
      await lock(tx, `group:${id}`);
      if (!closed) await requireAggregateSnapshotVersion(tx, 'group_id', id);
      const previous = (await tx.query('SELECT * FROM group_snapshots WHERE group_id=$1', [id])).rows[0];
      if (!closed && previous && BigInt(previous.version) >= BigInt(incoming)) return { applied: false };
      const existingName = closed && !previous ? (await tx.query('SELECT group_name FROM links WHERE group_id=$1 LIMIT 1', [id])).rows[0]?.group_name : undefined;
      const name = closed ? previous?.name ?? existingName ?? '' : text(body.groupName);
      const permanentlyClosed = closed || !!previous?.closed;
      await tx.query(`INSERT INTO group_snapshots(group_id,name,version,closed) VALUES($1,$2,$3,$4)
        ON CONFLICT(group_id) DO UPDATE SET name=EXCLUDED.name,version=GREATEST(group_snapshots.version,EXCLUDED.version),closed=EXCLUDED.closed`, [id, name, incoming, permanentlyClosed]);
      await tx.query('UPDATE links SET group_name=CASE WHEN $4 THEN group_name ELSE $2 END,group_closed=$3,group_closed_at=CASE WHEN $3 THEN COALESCE(group_closed_at,now()) ELSE NULL END WHERE group_id=$1',
        [id, name, permanentlyClosed, closed]);
    } else {
      await activeUsers(tx, id);
      await requireAggregateSnapshotVersion(tx, 'inviter_id', id);
      const previous = (await tx.query('SELECT version FROM user_snapshots WHERE user_id=$1', [id])).rows[0];
      if (previous && BigInt(previous.version) >= BigInt(incoming)) return { applied: false };
      const name = body.displayName == null ? null : text(body.displayName);
      await tx.query(`INSERT INTO user_snapshots(user_id,display_name,version) VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,version=EXCLUDED.version`, [id, name, incoming]);
      await tx.query('UPDATE links SET inviter_name=$2 WHERE inviter_id=$1', [id, name]);
    }
    return { applied: true };
  }, envelope);
}

export async function joined(slug: string, input: unknown, key: string, envelope?: unknown) {
  const body = object(input), user = uuid(body.userId), event = text(body.eventId);
  return idempotent(`joined:${event}`, key, body, async tx => {
    await requireDirectWrites(tx);
    await activeUsers(tx, user);
    const link = (await tx.query<LinkRow>('SELECT * FROM links WHERE slug=$1', [slug])).rows[0];
    if (!link) fail(404, 'SLUG_NOT_FOUND');
    await tx.query('INSERT INTO joined_events(event_id,link_id,user_id,occurred_at) VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING',
      [event, link.id, user, text(body.occurredAt, 40)]);
    return { applied: true };
  }, envelope);
}

// undefined는 이번 사건에서 해당 필드가 바뀌지 않았음을 뜻하고 null은 명시적인 닉네임 삭제다.
async function displaySnapshot(tx: PoolClient, group: string, inviter: string, incoming: string,
  groupName?: string, inviterName?: string | null) {
  await tx.query(`INSERT INTO link_display_snapshots(group_id,inviter_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [group, inviter]);
  const previous = (await tx.query('SELECT * FROM link_display_snapshots WHERE group_id=$1 AND inviter_id=$2 FOR UPDATE', [group, inviter])).rows[0];
  if (groupName !== undefined && BigInt(incoming) >= BigInt(previous.group_name_version)) {
    await tx.query('UPDATE link_display_snapshots SET group_name=$3,group_name_version=$4 WHERE group_id=$1 AND inviter_id=$2', [group, inviter, groupName, incoming]);
    previous.group_name = groupName;
  }
  if (inviterName !== undefined && BigInt(incoming) >= BigInt(previous.inviter_name_version)) {
    await tx.query('UPDATE link_display_snapshots SET inviter_name=$3,inviter_name_version=$4 WHERE group_id=$1 AND inviter_id=$2', [group, inviter, inviterName, incoming]);
    previous.inviter_name = inviterName;
  }
  return previous;
}

export async function updateMembershipDisplay(input: unknown, key: string, kind: 'group' | 'inviter', envelope?: unknown) {
  const body = object(input), group = uuid(body.groupId), inviter = uuid(body.inviterId);
  const incoming = version(body.snapshotVersion);
  return idempotent(`display:${group}:${inviter}:${kind}`, key, body, async tx => {
    await requireDirectWrites(tx);
    await activeUsers(tx, inviter);
    await lock(tx, `group:${group}`);
    await membership(tx, group, inviter);
    const names = await displaySnapshot(tx, group, inviter, incoming,
      kind === 'group' ? text(body.groupName) : undefined,
      kind === 'inviter' ? (body.inviterDisplayName == null ? null : text(body.inviterDisplayName)) : undefined);
    // 한 필드만 도착했으면 다른 필드의 기존값은 유지한다.
    if (kind === 'group') await tx.query('UPDATE links SET group_name=$3 WHERE group_id=$1 AND inviter_id=$2', [group, inviter, names.group_name]);
    else await tx.query('UPDATE links SET inviter_name=$3 WHERE group_id=$1 AND inviter_id=$2', [group, inviter, names.inviter_name]);
    return { applied: true };
  }, envelope);
}
