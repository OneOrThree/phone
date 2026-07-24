#!/usr/bin/env node
// JWT 사전 대량 발급 + params 포맷 변환 — 랩탑/러너에서 실행. 외부 의존성 0 (node 내장 crypto).
//
// 입력: 40_params_export.sql 이 만든 *.jsonl (COPY 친화 — 줄당 JSON 1개)
// 출력: k6 SharedArray 용 *.json (JSON 배열). users_* 파일에는 token 필드 병합.
//
// 토큰은 JwtProvider(HS256, {sub,iat,exp}) 계약의 재구현 — 로그인은 측정 대상이 아니므로
// 사전 발급하되, 필터는 그대로 타서 파싱 비용은 측정에 포함(prod 동일 경로). 계약 검증은
// 별도 테스트가 아니라 smoke run 자체 — SUT 가 토큰을 거부하면 스모크가 401 로 죽는다.
//
// 사용: JWT_SECRET=... node 50_mint_jwt.mjs <params_dir>
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const EXP_DAYS = Number(process.env.JWT_EXP_DAYS ?? 30); // 만료 임박 시 make mint 재실행

const secret = process.env.JWT_SECRET;
const paramsDir = process.argv[2];
if (!secret || !paramsDir) {
  console.error('[mint] 사용법: JWT_SECRET=... node 50_mint_jwt.mjs <params_dir>');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + EXP_DAYS * 86400;
const b64u = (s) => Buffer.from(s).toString('base64url');
const HEADER = b64u(JSON.stringify({ alg: 'HS256' }));

// JwtProvider.buildToken 과 동일 클레임: sub=userId, type, iat, exp (그 외 없음).
// type 은 필수 — GROMO-714 이후 JwtFilter 가 access 타입만 통과시키고, 클레임이 없으면(null)
// fail-closed 로 401 이다. 부하 토큰은 API 호출용이므로 JwtProvider.TYPE_ACCESS 와 같은 "access".
// 서명 키 계약: Keys.hmacShaKeyFor(secret.getBytes(UTF_8)) = HMAC-SHA256(secret 원문 바이트)
const mint = (userId) => {
  const data = `${HEADER}.${b64u(JSON.stringify({ sub: userId, type: 'access', iat: now, exp }))}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
};

const readJsonl = (path) =>
  readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

const signUsers = (rows, label) => {
  const cache = new Map(); // zipf 파일은 핫유저가 가중치만큼 중복 수록 — 토큰은 유저당 1회만 서명
  for (const r of rows) {
    if (!cache.has(r.userId)) cache.set(r.userId, mint(r.userId));
    r.token = cache.get(r.userId);
  }
  console.log(`[mint] ${label}: 항목 ${rows.length}, 고유 유저 ${cache.size}, exp=+${EXP_DAYS}d`);
};

// ① 최초 경로: 40_params_export 산출물(.jsonl) → 서명 + JSON 배열 변환
const converted = new Set();
for (const file of readdirSync(paramsDir).filter((f) => f.endsWith('.jsonl'))) {
  const path = join(paramsDir, file);
  const rows = readJsonl(path);

  if (file.startsWith('users_')) signUsers(rows, file);
  else console.log(`[mint] ${file}: 항목 ${rows.length} (변환만)`);

  const out = basename(file, '.jsonl') + '.json';
  writeFileSync(join(paramsDir, out), JSON.stringify(rows));
  converted.add(out);
  rmSync(path); // GCS 에는 .json 만 올린다
}

// ② 재발급 경로(make mint): 이미 변환된 users_*.json 의 토큰을 새 exp 로 재서명
for (const file of readdirSync(paramsDir)
  .filter((f) => f.startsWith('users_') && f.endsWith('.json') && !converted.has(f))) {
  const path = join(paramsDir, file);
  const rows = JSON.parse(readFileSync(path, 'utf8'));
  signUsers(rows, `${file} (재발급)`);
  writeFileSync(path, JSON.stringify(rows));
}
