// 도메인별 nav-*.json 을 하나로 합치고, 흐름도에 그릴 노드/간선만 남긴다.
// 사용: node merge.cjs  → merged.json 과 요약 출력
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sections.cjs');
const dir = ROOT;

const files = fs.readdirSync(dir).filter((f) => /^nav-.*\.json$/.test(f)).sort();
const nodes = new Map();
const edges = [];
const unsure = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const n of j.nodes) {
    if (nodes.has(n.id)) console.log(`중복 id: ${n.id} (${f})`);
    else nodes.set(n.id, { ...n, domain: j.domain });
  }
  for (const e of j.edges) edges.push({ ...e, domain: j.domain });
  for (const u of j.unsure || []) unsure.push({ domain: j.domain, text: u });
}

// 같은 화면을 도메인마다 다른 id 로 적은 것 통일
const alias = {
  'app.memberConversionSheet': 'product.memberConversion',
  // 홈 도메인이 대표로 적은 공용 가드 팝업도 같은 것으로 합친다
  'home.noIslandPopup': 'guard.noIsland',
  'home.visitorOnlyPopup': 'guard.residentsOnly',
  'home.lockedBuildingPopup': 'guard.notBuilt',
};
// 코드에는 있지만 들어가는 길이 없는 route (각 도메인 조사에서 미사용으로 확인)
const unusedRoutes = new Set(['members', 'stats', 'friendSearch']);
// 여러 건물에 똑같이 걸리는 공용 가드 팝업은 대표 하나로 합친다
const guardAlias = (id) => {
  if (/\.noIsland$/.test(id)) return 'guard.noIsland';
  if (/\.(residentsOnly|visitorOnly|memberOnlyPopup)$/.test(id)) return 'guard.residentsOnly';
  if (/\.(notBuilt|locked)$/.test(id) && !/^diary\./.test(id)) return 'guard.notBuilt';
  return null;
};
const canon = (id) => alias[id] || guardAlias(id) || id;

// 흐름도에 프레임으로 그리지 않는 것: 불러오는 중·오류(서버 전용 상태), 토스트
const isTransient = (n) =>
  /\.(loading|error|listError|forbidden|sendFailed)$/i.test(n.id) ||
  /^diary\.locked$/.test(n.id) ||
  /불러오는 중|불러오기 실패/.test(n.title);
const isToast = (n) => n.kind === 'toast';

const kept = new Map();
const dropped = { transient: [], toast: [], merged: [] };
for (const n of nodes.values()) {
  const id = canon(n.id);
  if (isTransient(n)) { dropped.transient.push(n.id); continue; }
  if (unusedRoutes.has(n.id)) { dropped.transient.push(n.id); continue; }
  if (isToast(n)) { dropped.toast.push(n.id); continue; }
  if (id !== n.id) dropped.merged.push(`${n.id} → ${id}`);
  if (!kept.has(id)) {
    const guardTitle = { 'guard.noIsland': '가입한 섬 없음 안내 (공용)', 'guard.residentsOnly': '주민만 이용 가능 안내 (공용)', 'guard.notBuilt': '건물 미완공 잠금 안내 (공용)' }[id];
    kept.set(id, { ...n, id, title: guardTitle || n.title, route: guardTitle ? 'guard' : n.route });
  }
}

// 간선: 토스트로 가는 것은 출발 노드의 메모로, 버려진 노드와 얽힌 것은 제거
const toastNotes = new Map();
const outEdges = [];
const dangling = [];
const seen = new Set();
for (const e of edges) {
  const from = canon(e.from), to = canon(e.to);
  const toNode = nodes.get(e.to);
  if (toNode && isToast(toNode)) {
    if (kept.has(from)) {
      if (!toastNotes.has(from)) toastNotes.set(from, []);
      toastNotes.get(from).push(`${e.trigger} → 토스트: ${toNode.title}`);
    }
    continue;
  }
  if (!kept.has(from)) continue;
  if (!kept.has(to)) {
    if (!nodes.has(e.to)) dangling.push(`${e.from} → ${e.to} (${e.domain})`);
    continue;
  }
  if (from === to) continue;
  const key = `${from}|${to}|${e.trigger}`;
  if (seen.has(key)) continue;
  seen.add(key);
  outEdges.push({ ...e, from, to });
}

const inbound = new Map();
for (const e of outEdges) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
const orphans = [...kept.values()].filter((n) => !inbound.get(n.id) && n.id !== 'login').map((n) => `${n.id} (${n.kind}) ${n.title}`);

const byKind = {}, byDomain = {};
for (const n of kept.values()) {
  byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  byDomain[n.domain] = (byDomain[n.domain] || 0) + 1;
}
fs.writeFileSync(
  path.join(dir, 'merged.json'),
  JSON.stringify({ nodes: [...kept.values()].map((n) => ({ ...n, toastNotes: toastNotes.get(n.id) || [] })), edges: outEdges, unsure }, null, 1),
);
console.log(JSON.stringify({
  files, rawNodes: nodes.size, rawEdges: edges.length,
  keptNodes: kept.size, keptEdges: outEdges.length, byKind, byDomain,
  dropped: { transient: dropped.transient.length, toast: dropped.toast.length, merged: dropped.merged.length },
  danglingCount: dangling.length, dangling: dangling.slice(0, 40),
  orphanCount: orphans.length, orphans,
}, null, 1));
