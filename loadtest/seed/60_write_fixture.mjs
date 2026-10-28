#!/usr/bin/env node
// 쓰기 시나리오(island_switch·join_approval·letter_exchange·telescope_pin)용 slot fixture 를 공개 API 로 만든다.
// slot = 계정 2(actor·partner) + 섬 3(actor 의 islandId · partner 의 hubIslandId·gateIslandId[승인제]). VU 하나가 slot 하나를 독점한다.
// 2단계다 — accounts: 계정·islandId·hubIslandId 생성 → (SQL: 회원 전환·친구·전망대, 60_write_fixture.sql) → join: gate 생성·actor 의 hub 가입.
// 전망대가 열리기 전에는 두 번째 섬 생성·이동이 막힐 수 있어(construction.facility-gates.enforce=true) 사이에 SQL 이 낀다.
// 사용: node 60_write_fixture.mjs --phase accounts|join --url http://localhost:18088 --out <PARAMS_DIR> [--slots 50] [--concurrency 4]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((v, i, a) => (v.startsWith('--') ? [v.slice(2), a[i + 1]] : null)).filter(Boolean));
const base = args.url, out = resolve(args.out || 'loadtest/.local/params'), phase = args.phase;
const count = Number(args.slots || 50), concurrency = Number(args.concurrency || 4);
if (!base || !['accounts', 'join'].includes(phase)) throw new Error('--url 과 --phase accounts|join 필요');
if (!Number.isInteger(count) || count < 2) throw new Error('--slots 는 2 이상 정수(telescope pin 대상이 다른 slot 의 섬)');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency 1~16 필요');
mkdirSync(out, { recursive: true, mode: 0o700 });
const file = `${out}/write_fixture.json`, stamp = Date.now().toString(36);

async function api(method, path, body, token, device) {
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (device) headers['X-Device-Id'] = device;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.error?.code || json.code || 'UNKNOWN'}`);
  return json.data ?? json;
}
async function account(label) {
  const auth = await api('POST', '/auth/sessions/guest', undefined, undefined, randomUUID());
  if (!auth.accessToken || !auth.userId) throw new Error('게스트 응답 계약 불일치');
  await api('PATCH', '/me', { name: `쓰${stamp.slice(-4)}${label}`, catColor: 'ginger' }, auth.accessToken);
  return { userId: auth.userId, token: auth.accessToken };
}
const pool = async (n, fn) => {
  let next = 0;
  const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => { while (next < n) await fn(next++); }));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
};

const slots = phase === 'accounts' ? [] : JSON.parse(readFileSync(file));
if (phase === 'join' && slots.length !== count) throw new Error(`accounts 단계 slot ${slots.length}개 ≠ --slots ${count}`);

await pool(count, async (k) => {
  if (phase === 'accounts') {
    const actor = await account(`a${k}`), partner = await account(`b${k}`);
    const home = await api('POST', '/islands', { name: `쓰기섬${stamp}${k}`, approvalRequired: false, maxMembers: 15 }, actor.token);
    const hub = await api('POST', '/islands', { name: `쓰기허브${stamp}${k}`, approvalRequired: false, maxMembers: 15 }, partner.token);
    slots[k] = { slot: k, actor, partner, islandId: home.id, hubIslandId: hub.id };
  } else {
    const s = slots[k];
    const gate = await api('POST', '/islands', { name: `쓰기승인${stamp}${k}`, approvalRequired: true, maxMembers: 15 }, s.partner.token);
    s.gateIslandId = gate.id;
    await api('POST', `/islands/${s.hubIslandId}/memberships`, {}, s.actor.token); // 즉시 가입 → 현재 섬이 hub 로 이동
    await api('PUT', '/me/current-island', { islandId: s.islandId }, s.actor.token); // 원래 섬으로 복귀 (hub 도착 기록은 남는다)
    s.pinTargetId = slots[(k + 1) % count].islandId;
  }
});
writeFileSync(file, JSON.stringify(slots), { mode: 0o600 });
if (phase === 'join') writeFileSync(`${out}/write-fixture-meta.json`, JSON.stringify({ createdAt: new Date().toISOString(), slots: count }, null, 2) + '\n');
console.log(`[write-fixture] ${phase} 완료: ${slots.length} slot → ${file}`);
