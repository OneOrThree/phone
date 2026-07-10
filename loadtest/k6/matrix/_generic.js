// 제네릭 단일-엔드포인트 러너 (GROMO-750) — recipe(입력 전략)를 받아 임의 API 에 부하.
// __ENV.RECIPE = k6/recipes/<name>.json 의 name. 유저/JWT 변동은 usersZipf/uniform + authParams
// 재사용(단일 유저로 치면 버퍼캐시 과대평가 — 매 iteration 유저를 바꾼다).
// recipe 는 recipes/gen-recipes.mjs 가 openapi.json 에서 생성. gap(=path ID 미조달) recipe 는
// runnable:false 라 대시보드가 디스패치하지 않는다.
import http from 'k6/http';
import { BASE_URL, THRESHOLDS, pick, randInt } from '../lib/config.js';
import { usersZipf, usersUniform, groupIds, searchTerms } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { followCursor } from '../lib/cursor.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const RECIPE_NAME = __ENV.RECIPE || '';
if (!RECIPE_NAME) throw new Error('RECIPE 환경변수 필요 (예: -e RECIPE=focus_getFocusSessions)');
const recipe = JSON.parse(open(`../recipes/${RECIPE_NAME}.json`)); // init context 전용

// 쓰기는 uniform(유저당 1 VU 로 락 경합 배제), 읽기는 zipf(핫유저 편중 = 현실 트래픽)
const users = recipe.userPool === 'uniform' ? usersUniform() : usersZipf();
const groups = groupIds();
const terms = searchTerms();

export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: THRESHOLDS,
};

const isoDate = (offsetDays, dateOnly) => {
  const d = new Date(Date.now() + (offsetDays || 0) * 864e5);
  return dateOnly ? d.toISOString().slice(0, 10) : d.toISOString();
};

// gen 스펙 → 값 (u = 현재 유저)
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
      return null; // gap 은 runnable recipe 엔 없음
  }
}

function buildPath(u) {
  let path = recipe.path;
  for (const [name, g] of Object.entries(recipe.pathParams || {})) {
    path = path.replace(`{${name}}`, encodeURIComponent(genValue(g, u)));
  }
  return path;
}

function buildQuery(u) {
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
  const u = pick(users);
  const url = `${BASE_URL}${buildPath(u)}${buildQuery(u)}`;
  const params = authParams(u, recipe.endpoint);
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
