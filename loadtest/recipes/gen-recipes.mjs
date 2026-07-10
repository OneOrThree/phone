#!/usr/bin/env node
// openapi.json → k6 recipes (엔드포인트별 입력 전략) — GROMO-750 "전체 API 부하" 자동화.
// 유저/JWT 변동은 제네릭 러너가 usersZipf/uniform + authParams 로 처리하므로, 여기서는
// path/query/body "입력"만 openapi 스키마 + 시드 풀 규칙으로 생성한다. 조달 불가한 path ID 는
// gap 으로 표시(제네릭 러너가 '리스트 조회 후 id 사용' 스텝으로 채우거나, 수동 recipe 로 보완).
//
// 사용: node loadtest/recipes/gen-recipes.mjs   → loadtest/k6/recipes/*.json + _manifest.json
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = join(HERE, '../dashboard/public/openapi.json');
const OUT = join(HERE, '../k6/recipes');

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
const schemas = spec.components?.schemas ?? {};
const deref = (s) => (s && s.$ref ? schemas[s.$ref.split('/').pop()] ?? {} : s ?? {});
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// path 변수 → 시드 풀에서 조달할 소스 키 (없으면 gap)
const PATH_SOURCE = {
  groupId: 'groupId',
  userId: 'userId',
  targetUserId: 'userId',
  friendUserId: 'userId',
};

// 쿼리/필드 이름 → 생성 전략
function paramGen(name, schema) {
  const enums = schema?.enum ?? deref(schema)?.enum;
  if (enums) return { gen: 'enum', values: enums };
  const n = name.toLowerCase();
  if (n === 'from') return { gen: 'date', offsetDays: -90 };
  if (n === 'to') return { gen: 'date', offsetDays: 0 };
  if (n === 'date') return { gen: 'date', offsetDays: 0, dateOnly: true };
  if (n === 'size' || n === 'limit') return { gen: 'const', value: 20 };
  if (n === 'cursor') return { gen: 'skip' };
  if (n === 'query' || n === 'q' || n === 'keyword') return { gen: 'searchTerm' };
  const t = (schema?.type) || deref(schema)?.type;
  if (t === 'integer' || t === 'number') return { gen: 'int', max: 100 };
  if (t === 'boolean') return { gen: 'bool' };
  if (name.endsWith('Id') || name.endsWith('id')) return { gen: 'gap', reason: `id:${name}` };
  if (t === 'string') return { gen: 'string' };
  return { gen: 'gap', reason: `unknown:${name}` };
}

// body 스키마(1~2 depth) → 값 생성 템플릿. gap 이면 reason 수집.
function bodyTemplate(schema, gaps, depth = 0) {
  const s = deref(schema);
  if (!s || depth > 3) return null;
  if (s.enum) return { gen: 'enum', values: s.enum };
  if (s.type === 'object' || s.properties) {
    const req = new Set(s.required ?? []);
    const props = s.properties ?? {};
    const obj = {};
    for (const [k, v] of Object.entries(props)) {
      // 필수 아닌 필드는 스킵(최소 바디) — 필수만 채워 400 회피
      if (!req.has(k)) continue;
      const g = fieldGen(k, v, gaps, depth);
      if (g) obj[k] = g;
    }
    return { gen: 'object', props: obj };
  }
  return fieldGen('', s, gaps, depth);
}

function fieldGen(name, schema, gaps, depth) {
  const s = deref(schema);
  if (s.enum) return { gen: 'enum', values: s.enum };
  const fmt = s.format;
  if (fmt === 'date-time') return { gen: 'datetime' };
  if (fmt === 'date') return { gen: 'date', offsetDays: 0, dateOnly: true };
  if (s.type === 'array') {
    const item = bodyTemplate(s.items, gaps, depth + 1);
    return item ? { gen: 'array', item, len: 1 } : { gen: 'const', value: [] };
  }
  if (s.type === 'object' || s.properties) return bodyTemplate(s, gaps, depth + 1);
  const n = name.toLowerCase();
  if (name.endsWith('Id') || n === 'id') {
    if (n.includes('group')) return { gen: 'pool', source: 'groupId' };
    if (n.includes('user') || n.includes('friend') || n.includes('target')) return { gen: 'pool', source: 'userId' };
    gaps.push(`body.${name}`);
    return { gen: 'gap', reason: `body-id:${name}` };
  }
  if (s.type === 'integer' || s.type === 'number') return { gen: 'int', max: 3600 };
  if (s.type === 'boolean') return { gen: 'bool' };
  if (s.type === 'string') return { gen: 'string' };
  return { gen: 'string' };
}

function buildRecipe(tag, method, path, op) {
  const gaps = [];
  const params = op.parameters ?? [];
  const pathParams = {};
  for (const v of (path.match(/\{([^}]+)\}/g) || []).map((x) => x.slice(1, -1))) {
    const p = params.find((x) => x.name === v && x.in === 'path');
    const enums = p?.schema?.enum ?? deref(p?.schema)?.enum;
    if (enums) pathParams[v] = { gen: 'enum', values: enums };
    else if (PATH_SOURCE[v]) pathParams[v] = { gen: 'pool', source: PATH_SOURCE[v] };
    else {
      pathParams[v] = { gen: 'gap', reason: `path-id:${v}` };
      gaps.push(`path.${v}`);
    }
  }
  const query = [];
  for (const p of params.filter((x) => x.in === 'query')) {
    if (!p.required && p.name !== 'size') continue; // 필수 위주(+size), 나머지 옵션은 생략
    const g = paramGen(p.name, p.schema);
    if (g.gen === 'skip') continue;
    if (g.gen === 'gap') gaps.push(`query.${p.name}`);
    query.push({ name: p.name, ...g });
  }
  let body = null;
  if (op.requestBody) {
    const sch = op.requestBody.content?.['application/json']?.schema;
    body = bodyTemplate(sch, gaps);
  }
  const isWrite = method !== 'get';
  return {
    endpoint: `${tag}_${op.operationId || `${method}_${path.replace(/\W+/g, '_')}`}`,
    method: method.toUpperCase(),
    path,
    tag,
    summary: op.summary || '',
    userPool: isWrite ? 'uniform' : 'zipf',
    pathParams,
    query,
    body,
    paginate: query.some((q) => q.name === 'cursor') || params.some((p) => p.name === 'cursor')
      ? { cursorField: 'nextCursor', pages: 2 }
      : null,
    gaps,
    runnable: gaps.length === 0,
  };
}

// ── 생성 ──────────────────────────────────────────────
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;
    const tag = (op.tags || ['etc'])[0];
    const r = buildRecipe(tag, method, path, op);
    const file = `${r.endpoint}.json`;
    writeFileSync(join(OUT, file), JSON.stringify(r, null, 2));
    manifest.push({ endpoint: r.endpoint, method: r.method, path: r.path, tag: r.tag, runnable: r.runnable, gaps: r.gaps, file });
  }
}
const runnable = manifest.filter((m) => m.runnable).length;
writeFileSync(join(OUT, '_manifest.json'), JSON.stringify({ total: manifest.length, runnable, gapped: manifest.length - runnable, recipes: manifest }, null, 2));

console.log(`[gen-recipes] 총 ${manifest.length} 엔드포인트 → runnable ${runnable} · gap ${manifest.length - runnable}`);
const gapReasons = {};
for (const m of manifest) for (const g of m.gaps) { const k = g.split(':')[0]; gapReasons[k] = (gapReasons[k] || 0) + 1; }
console.log('[gen-recipes] gap 사유:', JSON.stringify(gapReasons));
