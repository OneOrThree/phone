import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { issue, findLink, match, recordClick, revoke, claim, confirm, withdraw, updateSnapshot } from '../src/lib/links';
import { getPool } from '../src/lib/db/pool';
import { classifyOs, hashIp, isBot, landing } from '../src/lib/public-contract';
import { authorize, clientIp } from '../src/lib/auth';

async function fixture() {
  const body = { groupId: randomUUID(), inviterId: randomUUID(), groupName: '함께 집중', inviterDisplayName: '친구',
    membershipEpoch: 1, linkVersion: 1, transitionSeq: 1, snapshotVersion: 1 };
  const result = await issue(body, randomUUID());
  return { body, link: (await findLink(result.slug))! };
}

describe('기존 공개 계약', () => {
  it('기존 salt 해시, kakao 봇/실브라우저, iPad와 단일 패스 escaping을 보존한다', () => {
    expect(hashIp('203.0.113.1')).toBe(createHash('sha256').update('203.0.113.1fixture-existing-salt').digest('hex'));
    expect(isBot('KAKAOTALK iPhone')).toBe(false);
    expect(isBot('kakaotalk-scrap')).toBe(true);
    expect(isBot('')).toBe(true);
    expect(classifyOs('Macintosh Mobile Safari')).toBe('ios');
    const html = landing({ group_name: '<script>{{storeUrl}}</script>', inviter_name: '"<', group_id: randomUUID(), slug: 'abc12345' });
    expect(html).toContain('&lt;script&gt;{{storeUrl}}&lt;/script&gt;');
    expect(html).not.toContain('<script>{{storeUrl}}');
    expect(landing()).toContain('그로모 그룹');
  });

  it('서로 다른 두 기기는 한 클릭을 공유하지 않고 같은 기기 동시 재시도는 한 클릭만 쓴다', async () => {
    const { link } = await fixture(), ip = hashIp(randomUUID());
    await recordClick(link, ip, 'ios', 'iPhone');
    const results = await Promise.all([1, 2].map(() => match({ ipHash: ip, os: 'ios', deviceId: randomUUID() })));
    expect(results.filter(result => result.matched)).toHaveLength(1);
    await recordClick(link, ip, 'ios', 'iPhone');
    await recordClick(link, ip, 'ios', 'iPhone');
    const device = randomUUID();
    const retried = await Promise.all([1, 2].map(() => match({ ipHash: ip, os: 'ios', deviceId: device })));
    expect(retried[0]).toEqual(retried[1]);
    const count = await getPool().query('SELECT count(*) FROM link_clicks WHERE matched_device_id=$1', [device]);
    expect(count.rows[0].count).toBe('1');
  });

  it('3시간 밖 클릭은 미매치, 닫힌 그룹 재시도는 다른 클릭을 소진하지 않는다', async () => {
    const { link, body } = await fixture(), ip = hashIp(randomUUID()), device = randomUUID();
    await recordClick(link, ip, 'ios', 'iPhone');
    await getPool().query("UPDATE link_clicks SET clicked_at=now()-interval '3 hours 1 second' WHERE link_id=$1", [link.id]);
    expect(await match({ ipHash: ip, os: 'ios', deviceId: device })).toEqual({ matched: false });
    await recordClick(link, ip, 'ios', 'iPhone');
    expect((await match({ ipHash: ip, os: 'ios', deviceId: device })).matched).toBe(true);
    await updateSnapshot('groups', body.groupId, { version: 2 }, randomUUID(), true);
    expect((await findLink(link.slug))!.group_name).toBe(body.groupName);
    expect(await match({ ipHash: ip, os: 'ios', deviceId: device })).toEqual({ matched: false });
  });
});

describe('내구 명령과 멤버십 전이', () => {
  it('폐기 선도착 뒤 지연 발급을 거부하고 구 폐기는 재가입 링크를 지우지 않는다', async () => {
    const { link, body } = await fixture();
    await revoke({ ...body, membershipEpoch: 2, transitionSeq: 2 }, randomUUID());
    await expect(issue(body, randomUUID())).rejects.toMatchObject({ code: 'STALE_MEMBERSHIP' });
    const next = await issue({ ...body, membershipEpoch: 3, linkVersion: 3, transitionSeq: 3 }, randomUUID());
    expect(next.slug).not.toBe(link.slug);
    expect(await revoke({ ...body, membershipEpoch: 2, transitionSeq: 2 }, randomUUID())).toEqual({ applied: false });
    expect((await findLink(next.slug))!.status).toBe('ACTIVE');
  });

  it('같은 요청키는 재생하며 다른 본문이면 충돌한다', async () => {
    const { body } = await fixture(), key = randomUUID();
    const first = await issue(body, key);
    expect(await issue(body, key)).toEqual(first);
    await expect(issue({ ...body, groupName: '다른 값' }, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('폐기 선도착 뒤 confirm 재시도는 pending 귀속을 되살리지 않는다', async () => {
    const { body, link } = await fixture(), ip = hashIp(randomUUID()), user = randomUUID();
    await recordClick(link, ip, 'ios', 'iPhone');
    await match({ ipHash: ip, os: 'ios', deviceId: randomUUID() });
    const pending = await claim(link.slug, user, randomUUID());
    expect(pending.claimId).toBeTruthy();
    await revoke({ ...body, membershipEpoch: 2, transitionSeq: 3 }, randomUUID());
    expect(await confirm(pending.claimId!, { ...body, transitionSeq: 2, proof: {
      confirmationId: randomUUID(), committedAt: new Date().toISOString(),
    } }, randomUUID())).toEqual({ applied: false });
  });

  it('확정 근거는 탈퇴 때도 불변이고 지연 claim은 tombstone으로 차단된다', async () => {
    const { body, link } = await fixture(), ip = hashIp(randomUUID()), user = randomUUID();
    await recordClick(link, ip, 'ios', 'iPhone');
    await match({ ipHash: ip, os: 'ios', deviceId: randomUUID() });
    const pending = await claim(link.slug, user, randomUUID());
    const proof = { confirmationId: randomUUID(), committedAt: new Date().toISOString() };
    await confirm(pending.claimId!, { ...body, transitionSeq: 2, proof }, randomUUID());
    await withdraw(user, { transitionSeq: 3 }, randomUUID());
    const row = (await getPool().query('SELECT * FROM link_claims WHERE id=$1', [pending.claimId])).rows[0];
    expect(row.claimed_user_id).toBeNull();
    expect(row.confirm_proof.confirmationId).toBe(proof.confirmationId);
    await expect(claim(link.slug, user, randomUUID())).rejects.toMatchObject({ code: 'USER_WITHDRAWN' });
  });
});

describe('신뢰 경계', () => {
  it('프록시 원본 IP는 시크릿 인증 뒤 전용 헤더에서만 읽는다', () => {
    expect(clientIp(new Headers({ 'x-link-proxy-secret': 'fixture-proxy', 'x-link-client-ip': '203.0.113.4', 'x-forwarded-for': '198.51.100.2' }))).toBe('203.0.113.4');
    expect(() => clientIp(new Headers({ 'x-link-proxy-secret': 'wrong', 'x-link-client-ip': '203.0.113.4' }))).toThrow('INVALID_PROXY');
    expect(() => clientIp(new Headers({ 'x-forwarded-for': '203.0.113.4' }))).toThrow('TRUSTED_CLIENT_IP_REQUIRED');
  });

  it('Business 토큰으로 confirm·withdraw를 실행할 수 없다', () => {
    const request = new Request(`https://links.example.test/internal/users/${randomUUID()}/withdraw`, { method: 'POST', headers: { authorization: 'Bearer fixture-business' } });
    expect(() => authorize(request)).toThrow('SERVICE_ROUTE_FORBIDDEN');
  });
});

describe('Data HTTP 봉투 계약', () => {
  it('표시정보의 멤버십별 version을 비교하고 서로 다른 필드의 역순 갱신을 보존한다', async () => {
    const { ingestEvent } = await import('../src/lib/events');
    const { body, link } = await fixture();
    const event = (type: string, version: number, params: object) => ({
      eventId: randomUUID(), schemaVersion: 1, type, version, userId: body.inviterId,
      occurredAt: new Date().toISOString(), params: { ...body, ...params },
    });
    await ingestEvent(event('user.displayNameChanged', 5, { snapshotVersion: 4, inviterDisplayName: null }));
    await ingestEvent(event('group.renamed', 4, { snapshotVersion: 3, groupName: '새 그룹명' }));
    await issue({ ...body, snapshotVersion: 2, groupName: '늦은 이름', inviterDisplayName: '늦은 닉네임' }, randomUUID());
    expect(await findLink(link.slug)).toMatchObject({ group_name: '새 그룹명', inviter_name: null });
    await ingestEvent(event('group.renamed', 3, { snapshotVersion: 2, groupName: '더 늦은 이름' }));
    expect((await findLink(link.slug))!.group_name).toBe('새 그룹명');
  });

  it('봉투 스키마·서비스 호출 권한을 검사하며 그룹 종료가 늦게 도착해도 링크를 닫는다', async () => {
    const { ingestEvent } = await import('../src/lib/events');
    const { body, link } = await fixture();
    const event = { eventId: randomUUID(), schemaVersion: 1, type: 'group.closed', version: 2,
      userId: body.inviterId, occurredAt: new Date().toISOString(), params: body };
    expect(authorize(new Request('https://links.example.test/internal/events', { method: 'POST', headers: { authorization: 'Bearer fixture-data' } })).caller).toBe('data');
    expect(() => authorize(new Request('https://links.example.test/internal/events', { method: 'POST', headers: { authorization: 'Bearer fixture-business' } }))).toThrow('SERVICE_ROUTE_FORBIDDEN');
    await expect(ingestEvent({ ...event, schemaVersion: 2 })).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA_VERSION' });
    await updateSnapshot('groups', body.groupId, { version: 90, groupName: '보존할 그룹명' }, randomUUID());
    await ingestEvent(event);
    expect(await findLink(link.slug)).toMatchObject({ group_closed: true, group_name: '보존할 그룹명' });
    await expect(issue({ ...body, snapshotVersion: 9 }, randomUUID())).rejects.toMatchObject({ code: 'GROUP_CLOSED' });
  });
});

describe('소진과 폐기의 직렬화', () => {
  it('폐기가 소진 직전에 커밋되면 옛 ACTIVE 사본으로 매치를 성립시키지 않는다', async () => {
    const { link, body } = await fixture(), ip = hashIp(randomUUID()), device = randomUUID();
    await recordClick(link, ip, 'ios', 'iPhone');
    // 진행 중인 폐기를 흉내 낸다 — revoke 가 잡는 membership 락을 실제로 먼저 쥔다.
    const blocker = await getPool().connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`membership:${body.groupId}:${body.inviterId}`]);
      const pending = match({ ipHash: ip, os: 'ios', deviceId: device });
      // match 가 후보를 고른 «뒤» 락에서 대기하는 동안 폐기를 커밋한다.
      await new Promise(resolve => setTimeout(resolve, 300));
      await blocker.query("UPDATE links SET status='REVOKED',revoked_at=now(),revoke_reason='MEMBERSHIP_ENDED' WHERE id=$1", [link.id]);
      await blocker.query('COMMIT');
      // 잠그지 않으면 조인으로 함께 읽은 옛 ACTIVE 사본을 그대로 믿어 matched:true 를 돌려준다.
      expect(await pending).toEqual({ matched: false });
    } finally {
      blocker.release();
    }
    // 판정이 뒤집혀도 후보는 소진한다 — 죽은 클릭이 남아 이후 클릭을 가리면 안 된다.
    const click = (await getPool().query('SELECT matched,matched_device_id FROM link_clicks WHERE link_id=$1', [link.id])).rows[0];
    expect(click).toMatchObject({ matched: true, matched_device_id: device });
  });

  it('탈퇴가 소진 직전에 커밋돼도 폐기된 링크로 매치되지 않는다', async () => {
    const { link, body } = await fixture(), ip = hashIp(randomUUID()), device = randomUUID();
    await recordClick(link, ip, 'ios', 'iPhone');
    // withdraw 는 group·membership 락을 잡지 않는다 — links 행 공유 락만이 이 경합을 닫는다.
    const blocker = await getPool().connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("SELECT * FROM links WHERE id=$1 FOR UPDATE", [link.id]);
      const pending = match({ ipHash: ip, os: 'ios', deviceId: device });
      await new Promise(resolve => setTimeout(resolve, 300));
      await blocker.query(`UPDATE links SET inviter_name=NULL,status='REVOKED',revoked_at=now(),revoke_reason='USER_WITHDRAWN'
        WHERE inviter_id=$1`, [body.inviterId]);
      await blocker.query('COMMIT');
      expect(await pending).toEqual({ matched: false });
    } finally {
      blocker.release();
    }
  });
});
