#!/usr/bin/env node
// 차원 테이블 CSV 생성 (랩탑에서 실행) — 현실적인 한글 문자열이 필요한 테이블만. (post-V7 스키마)
// 팩트 테이블은 20_facts.sql(generate_series)이 담당한다.
//
// 결정론 원칙: UUID = md5('<prefix>-'||n) — SQL(20_facts)과 같은 공식을 공유해
// 팩트 생성 시 조인 없이 차원 id 를 유도할 수 있다. 난수는 mulberry32(고정 시드).
// 공유 공식: 그룹 멤버 memberIdx(g,i) = (g*17 + i*53) % N_USERS + 1, i=1 이 OWNER = groups.host_id.
//
// 사용: node 10_dimensions.mjs --scale 1 --out /tmp/csv
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []),
);
const SCALE = Number(args.scale ?? 1);
const OUT = args.out ?? '/tmp/loadtest-csv';
mkdirSync(OUT, { recursive: true });

const N_USERS = Math.max(100, Math.round(100_000 * SCALE));
const N_GROUPS = Math.max(20, Math.round(50_000 * SCALE));
const N_ITEMS = 500; // 마스터성 — 스케일 무관
const N_DEFAULT_TAGS = 40;
const BASE_DATE = Date.parse('2026-07-01T00:00:00Z'); // 재현성 — Date.now() 금지
const DAYS = 180;

// mulberry32 — 고정 시드 PRNG (실행 간 동일 산출)
let s = 0x548c0ffe;
const rnd = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const uuid = (key) => {
  const h = createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const iso = (ms) => new Date(ms).toISOString();
const csv = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
const write = (file, header, rows) => {
  writeFileSync(join(OUT, file), header + '\n' + rows.map((r) => r.map(csv).join(',')).join('\n') + '\n');
  console.log(`[dims] ${file}: ${rows.length}행`);
};

// ── occupations (마스터 19종 — users.occupation CHECK 도메인과 일치) ──
const OCC = ['LABOR_ATTORNEY','PATENT_ATTORNEY','TAX_ACCOUNTANT','CPA','APPRAISER','CIVIL_SERVANT','POLICE_FIRE',
  'ADMIN_EXAM','CERTIFICATION','MIDDLE_SCHOOL','HIGH_SCHOOL','CSAT','UNIVERSITY','JOB_PREP','ENGLISH_TEST',
  'CODING','SELF_DEVELOPMENT','FOCUS_BUILDING','ETC'];
write('occupations.csv', 'code,display_name,created_at',
  OCC.map((c) => [c, `직군-${c}`, iso(BASE_DATE - DAYS * 864e5)]));

// ── default_tags (V4 글로벌 태그 마스터, name UNIQUE) — id=md5('dtag-'||idx) ──
const TAG_BASE = ['이론 공부','문제 풀이','오답 정리','모의고사','인강 수강','암기','실습','프로젝트',
  '독서','리서치','과제','복습','예습','스터디','노트 정리','코딩 테스트','면접 준비','포트폴리오','회화','청취'];
const TAG_NAMES = [...TAG_BASE, ...TAG_BASE.map((t) => `${t} 심화`)]; // 40개, 전부 유일
write('default_tags.csv', 'id,name,created_at',
  TAG_NAMES.map((name, idx) => [uuid(`dtag-${idx}`), name, iso(BASE_DATE - DAYS * 864e5)]));

// ── occupation_default_tags (V4: name→default_tag_id FK, UNIQUE(occupation, default_tag_id)) ──
write('occupation_default_tags.csv', 'id,occupation,sort_order,created_at,default_tag_id',
  OCC.flatMap((c, ci) => [0, 1, 2, 3].map((i) => [
    uuid(`odt-${c}-${i}`), c, i, iso(BASE_DATE - DAYS * 864e5), uuid(`dtag-${(ci * 4 + i) % N_DEFAULT_TAGS}`),
  ])));

// ── league_tier_configs (5티어) ──
write('league_tier_configs.csv', 'tier_level,arena_size,badge_id,promote_count,relegate_count,relegate_warning_count,created_at',
  [1, 2, 3, 4, 5].map((t) => [t, 30, `badge-${t}`, 5, 5, 5, iso(BASE_DATE - DAYS * 864e5)]));

// ── users (한글 닉네임 — pg_trgm 한글 검증용. 혼합 기수로 유일성 보장) ──
const SUR = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진지엄'.split('');
const A = '민서지현수예도하은주승윤시아준영채원소연태건우진해리다온세인유나라'.split('');
const B = '준혁우빈서연아영훈민석희수현진호원영찬규림솔율든결빛찬별하람윤슬기쁨'.split('');
const userRows = [];
for (let n = 1; n <= N_USERS; n++) {
  const isGuest = rnd() < 0.1;
  const k = n - 1;
  const name = SUR[k % SUR.length] + A[Math.floor(k / SUR.length) % A.length] + B[Math.floor(k / (SUR.length * A.length)) % B.length];
  const nickname = isGuest ? `게스트${n}` : (n <= SUR.length * A.length * B.length ? name : `${name}${n}`);
  const created = BASE_DATE - Math.floor(rnd() * DAYS) * 864e5;
  userRows.push([
    uuid(`user-${n}`), isGuest, nickname, 'KR',
    rnd() < 0.1 ? null : pick(OCC),                       // occupation 10% null
    rnd() < 0.2 ? 'PUBLIC' : 'FRIENDS',                   // stat_visibility
    null, null,                                           // device_token, refresh_token
    iso(created), iso(created), rnd() < 0.02,             // created, updated, is_deleted 2%
    iso(BASE_DATE - Math.floor(rnd() * 7) * 864e5),       // last_active_at (NOT NULL)
  ]);
}
write('users.csv',
  'id,is_guest,nickname,country_code,occupation,stat_visibility,device_token,refresh_token,created_at,updated_at,is_deleted,last_active_at',
  userRows);

// ── groups (한글 그룹명 — Phase 3 groups/search 표적) ──
// post-V7: V3 로 code 없음, V5 로 미션(mission_*/window_*/duration) 없음, V7 로
// host_id·bet_type·notice_permission·started_at·ended_at 없음 — 방장은 group_members.role=OWNER
// (memberIdx 공식 i=1)가 단일 원천, 생명주기는 챌린지 소유.
const ADJ = '열공하는,갓생,새벽,불타는,조용한,꾸준한,독한,성실한,집중,몰입,미라클,의지의,캠스터디,오늘도,합격,루틴'.split(',');
const NOUN = '수학,영어,코딩,공시,자격증,수능,토익,회계,전공,독서,러닝,기상,스터디,챌린지,모각공,다이어트'.split(',');
const groupRows = [];
for (let n = 1; n <= N_GROUPS; n++) {
  const r = rnd();
  const status = r < 0.6 ? 'ACTIVE' : r < 0.8 ? 'WAITING' : 'ENDED'; // V2 도메인 — CLOSED 없음
  const created = BASE_DATE - Math.floor(rnd() * DAYS) * 864e5;
  groupRows.push([
    uuid(`group-${n}`),
    `${pick(ADJ)}${pick(NOUN)}${n % 97 === 0 ? '' : n % 1000}`, // 한글 프리픽스 + 유일성 접미
    rnd() < 0.5 ? '같이 집중해요' : null,
    null,                                                       // password
    20 + Math.floor(rnd() * 30),
    status, true, null, 'ALL_MEMBERS',
    iso(created), null, 0,
  ]);
}
write('groups.csv',
  'id,name,description,password,max_members,status,is_chat_enabled,chat_limit_per_person,invite_permission,created_at,deleted_at,version',
  groupRows);

// ── items (500 고정 — idx<400 EQUIPPABLE(슬롯=idx%4 → HAIR/TOP/BOTTOM/SHOES), 나머지 DECORATIVE) ──
const SLOTS = ['HAIR', 'TOP', 'BOTTOM', 'SHOES'];
write('items.csv',
  'id,name,item_type,grade,slot_type,payment_type,currency_price,premium_price,asset_url,is_active,created_at',
  Array.from({ length: N_ITEMS }, (_, idx) => [
    uuid(`item-${idx}`), `아이템${idx}`,
    idx < 400 ? 'EQUIPPABLE' : 'DECORATIVE',
    ['COMMON', 'RARE', 'EPIC'][idx % 3],
    idx < 400 ? SLOTS[idx % 4] : null,
    'CURRENCY', 100 + (idx % 50) * 10, null,
    `https://cdn.example.com/items/${idx}.png`, true, iso(BASE_DATE - DAYS * 864e5),
  ]));

console.log(`[dims] 완료 — users=${N_USERS}, groups=${N_GROUPS}, default_tags=${N_DEFAULT_TAGS} (SCALE=${SCALE}, out=${OUT})`);
