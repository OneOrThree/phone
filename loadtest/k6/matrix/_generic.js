// 제네릭 러너 (GROMO-750) — 선택한 엔드포인트 목록(RECIPES)에 병렬 부하.
// __ENV.RECIPES = 콤마구분 recipe 이름 목록(단일도 목록 길이 1). __ENV.RATE = 총 arrival rate(rps).
// 모델 A: 하나의 arrival-rate 시나리오에서 매 iteration 랜덤 recipe 를 골라 실행 → 총 부하를 선택
// 엔드포인트에 분산(daily_mix 와 동일 모델). 동시 VU 가 서로 다른 엔드포인트를 때리므로 "병렬 부하".
// 유저/JWT 변동은 usersZipf/uniform + authParams 재사용(단일 유저는 버퍼캐시 과대평가). per-endpoint
// 지표는 authParams 의 endpoint 태그로 분리 유지(pg_stat 격리는 그 엔드포인트만 단독 선택 시).
import http from 'k6/http';
import { BASE_URL, THRESHOLDS, pick, randInt } from '../lib/config.js';
import { usersZipf, usersUniform, groupIds, searchTerms } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { followCursor } from '../lib/cursor.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const NAMES = (__ENV.RECIPES || __ENV.RECIPE || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!NAMES.length) throw new Error('RECIPES 환경변수 필요 (콤마구분 recipe 목록)');
const recipes = NAMES.map((name) => JSON.parse(open(`../recipes/${name}.json`))); // init context 전용

const usersZ = usersZipf();
const usersU = usersUniform();
const groups = groupIds();
const terms = searchTerms();

export const options = {
  scenarios: resolveProfile().scenarios('run'), // 총 arrival rate = __ENV.RATE || 프로파일 기본
  thresholds: THRESHOLDS,
};

const isoDate = (offsetDays, dateOnly) => {
  const d = new Date(Date.now() + (offsetDays || 0) * 864e5);
  return dateOnly ? d.toISOString().slice(0, 10) : d.toISOString();
};

function genValue(g, u) {
  switch (g.gen) {
    case 'date':
      return isoDate(g.offsetDays, g.dateOnly);
    case 'datetime':
      return isoDate(g.offsetDays || 0, false);
    case 'const':
      return g.value;
    case 'enum':
      return pick(g.values);
    case 'searchTerm':
      return (pick(terms) || {}).term || '검증';
    case 'int':
      return randInt(g.max || 100);
    case 'bool':
      return randInt(2) === 1;
    case 'string':
      return `k6-${randInt(1e6)}`;
    case 'pool':
      if (g.source === 'groupId') return (pick(groups) || {}).groupId;
      if (g.source === 'userId') return u.userId;
      return null;
    default:
      return null;
  }
}

function buildPath(recipe, u) {
  let path = recipe.path;
  for (const [name, g] of Object.entries(recipe.pathParams || {})) {
    path = path.replace(`{${name}}`, encodeURIComponent(genValue(g, u)));
  }
  return path;
}

function buildQuery(recipe, u) {
  const parts = [];
  for (const q of recipe.query || []) {
    const v = genValue(q, u);
    if (v !== null && v !== undefined) parts.push(`${q.name}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function buildBody(node, u) {
  if (!node) return undefined;
  if (node.gen === 'object') {
    const o = {};
    for (const [k, child] of Object.entries(node.props || {})) o[k] = buildBody(child, u);
    return o;
  }
  if (node.gen === 'array') return [buildBody(node.item, u)];
  return genValue(node, u);
}

export function run() {
  const recipe = pick(recipes); // 매 iteration 랜덤 픽 = 총 rate 를 선택분에 분산(모델 A)
  const users = recipe.userPool === 'uniform' ? usersU : usersZ;
  const u = pick(users);
  const url = `${BASE_URL}${buildPath(recipe, u)}${buildQuery(recipe, u)}`;
  const params = authParams(u, recipe.endpoint); // endpoint 태그 → per-endpoint 지표 분리
  const method = recipe.method;

  if (method === 'GET') {
    if (recipe.paginate) followCursor(url, params, recipe.paginate.pages || 2);
    else http.get(url, params);
    return;
  }
  if (method === 'DELETE') {
    http.del(url, null, params);
    return;
  }
  const body = JSON.stringify(buildBody(recipe.body, u) || {});
  if (method === 'POST') http.post(url, body, params);
  else if (method === 'PUT') http.put(url, body, params);
  else if (method === 'PATCH') http.patch(url, body, params);
}

export function handleSummary(data) {
  return summarize(data);
}
