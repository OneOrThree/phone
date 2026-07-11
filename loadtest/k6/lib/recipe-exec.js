// recipe(입력 전략) 1건 실행 — 단일 API(matrix/_generic.js)·시나리오(scenarios/_generic.js) 공용 (GROMO-750).
// user 는 호출자가 pool(zipf/uniform)에서 픽해서 넘긴다(유저 변동 = 캐시 과대평가 방지). pools={groups,terms}.
import http from 'k6/http';
import { BASE_URL, pick, randInt } from './config.js';
import { authParams } from './auth.js';
import { followCursor } from './cursor.js';

const isoDate = (off, dateOnly) => {
  const d = new Date(Date.now() + (off || 0) * 864e5);
  return dateOnly ? d.toISOString().slice(0, 10) : d.toISOString();
};

export function execRecipe(recipe, u, pools) {
  // runnable:false(파라미터 gap) 레시피는 실행 불가 — RECIPES 자유입력으로 UI 가드를 우회해 넣어도
  // 잘못된 요청이 조용히 나가 에러율·지연을 오염시키지 않도록 여기서 명시적으로 실패시킨다.
  if (recipe.runnable === false)
    throw new Error(`recipe ${recipe.endpoint || recipe.path} 는 runnable:false (파라미터 gap) — 실행 불가`);
  const gen = (g) => {
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
        return (pick(pools.terms) || {}).term || '검증';
      case 'int':
        return randInt(g.max || 100);
      case 'bool':
        return randInt(2) === 1;
      case 'string':
        return `k6-${randInt(1e6)}`;
      case 'pool':
        if (g.source === 'groupId') return (pick(pools.groups) || {}).groupId;
        if (g.source === 'userId') return u.userId;
        return null;
      default:
        return null;
    }
  };
  const build = (node) => {
    if (!node) return undefined;
    if (node.gen === 'object') {
      const o = {};
      for (const [k, c] of Object.entries(node.props || {})) o[k] = build(c);
      return o;
    }
    if (node.gen === 'array') return [build(node.item)];
    return gen(node);
  };

  let path = recipe.path;
  for (const [name, g] of Object.entries(recipe.pathParams || {})) {
    const val = gen(g);
    // null/undefined 를 그대로 encodeURIComponent 하면 'null'/'undefined' 리터럴이 경로에 박힌다
    // (예: /friends/requests/null/accept). query 루프와 달리 조용히 흘리지 않고 명시적으로 실패.
    if (val === null || val === undefined)
      throw new Error(`recipe ${recipe.path} pathParam '${name}' 생성 실패(gen=${g.gen})`);
    path = path.replace(`{${name}}`, encodeURIComponent(val));
  }
  const qs = [];
  for (const q of recipe.query || []) {
    const v = gen(q);
    if (v !== null && v !== undefined) qs.push(`${q.name}=${encodeURIComponent(v)}`);
  }
  const url = `${BASE_URL}${path}${qs.length ? `?${qs.join('&')}` : ''}`;
  const params = authParams(u, recipe.endpoint); // endpoint 태그 → per-endpoint 지표
  const m = recipe.method;

  if (m === 'GET') {
    if (recipe.paginate) followCursor(url, params, recipe.paginate.pages || 2, recipe.paginate.cursorField);
    else http.get(url, params);
    return;
  }
  if (m === 'DELETE') {
    http.del(url, null, params);
    return;
  }
  const body = JSON.stringify(build(recipe.body) || {});
  if (m === 'POST') http.post(url, body, params);
  else if (m === 'PUT') http.put(url, body, params);
  else if (m === 'PATCH') http.patch(url, body, params);
}
