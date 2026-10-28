// hot/<묶음>/NNN-<id>.hotspots.json + 캡처 설정 → hotspots.json
// { 출발 화면 id: { 도착 화면 id: {x,y,w,h} } }  — 출발 화면에서 그 이동을 일으키는 버튼의 자리
const fs = require('fs');
const path = require('path');
const { ROOT, loadMerged } = require('./sections.cjs');
const S = ROOT;

// 1) 화면별 버튼 자리
const hot = new Map();
for (const g of fs.existsSync(path.join(S, 'hot')) ? fs.readdirSync(path.join(S, 'hot')) : []) {
  const dir = path.join(S, 'hot', g);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.hotspots.json'))) {
    let id = f.replace(/^\d+-/, '').replace(/\.hotspots\.json$/, '').replace(/-FAILED$/, '');
    // 튜토리얼은 한 번에 따라가며 찍어서 파일 이름이 단계 번호다
    if (g === 'tutorial') id = /^s\d\d$/.test(id) ? `tutorial.${id}` : id === 'hallGuide' ? 'home.hallGuide' : `tutorial-extra.${id}`;
    if (f.includes('-FAILED')) continue;
    hot.set(id, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
}

// 2) 캡처 설정에서 "그 화면을 열려고 마지막에 누른 것"
const cfgOf = new Map();
for (const f of fs.readdirSync(path.join(S, 'capture')).filter((x) => /^cfg-.*\.cjs$/.test(x))) {
  let list;
  try { list = require(path.join(S, 'capture', f)); } catch (e) { console.log('설정 읽기 실패', f, e.message); continue; }
  for (const c of Array.isArray(list) ? list : []) { const k = c.name_ || c.target; if (k && !cfgOf.has(k)) cfgOf.set(k, c); }
}
const lastPress = (c) => {
  if (!c) return [];
  const out = [];
  const steps = (c.steps || []).filter((s) => s.click || s.label || s.tap);
  const last = steps[steps.length - 1];
  if (last && (last.click || last.label)) out.push(last.click || last.label);
  if (!last && c.confirm) out.push(c.confirm);
  if (!last && c.tab) out.push(c.tab);
  return out;
};

// 3) 간선마다 버튼 찾기
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const quoted = (s) => [...String(s).matchAll(/['"‘’“”「」『』]([^'"‘’“”「」『』]{1,40})['"‘’“”「」『』]/g)].map((m) => m[1]);
const cleaned = (s) => String(s).replace(/\([^)]*\)/g, '').replace(/(버튼|누르기|누름|탭|행|카드|선택|스포트라이트)/g, '').replace(/^자동.*$/, '').trim();
function find(list, tokens) {
  let best = null;
  tokens.forEach((raw, ti) => {
    const t = norm(raw);
    if (t.length < 1) return;
    for (const h of list) {
      const ht = norm(h.text), hl = norm(h.label);
      let sc = 0;
      if (ht === t || hl === t) sc = 100;
      else if (t.length >= 2 && ht.includes(t)) sc = 78 - Math.min(30, ht.length - t.length);
      else if (t.length >= 2 && hl.includes(t)) sc = 72 - Math.min(30, hl.length - t.length);
      // 단서 글 안에 버튼 글자가 들어 있는 경우는 짧은 글자(예: '공지')가 엉뚱하게 걸리기 쉬워서
      // 버튼 글자가 3자 이상이거나 단서의 60% 이상을 차지할 때만 인정한다
      else if (ht.length >= 2 && t.includes(ht) && (ht.length >= 3 || ht.length / t.length >= 0.6)) sc = 55;
      else if (hl.length >= 2 && t.includes(hl) && (hl.length >= 3 || hl.length / t.length >= 0.6)) sc = 52;
      if (!sc) continue;
      sc -= ti * 4; // 앞쪽 단서일수록 믿을 만하다
      const area = h.w * h.h;
      if (area > 402 * 874 * 0.45) continue;
      if (!best || sc > best.sc || (sc === best.sc && area < best.area)) best = { sc, area, h, token: raw };
    }
  });
  return best && best.sc >= 48 ? best : null;
}

const merged = loadMerged();
const edges = merged.edges.map((e) => ({ from: e.from, to: e.to, trigger: e.trigger }));
const tutFile = path.join(S, 'shots', 'tutorial-steps.json');
if (fs.existsSync(tutFile)) {
  const t = JSON.parse(fs.readFileSync(tutFile, 'utf8'));
  for (let i = 0; i < t.steps.length - 1; i++) edges.push({ from: t.steps[i].id, to: t.steps[i + 1].id, trigger: t.steps[i].next || '다음' });
  if (t.after && t.steps.length) edges.push({ from: t.steps[t.steps.length - 1].id, to: 'home.hallGuide', trigger: t.steps[t.steps.length - 1].next || '' });
}

const out = {};
let tried = 0, found = 0;
const misses = [];
for (const e of edges) {
  if (/^자동/.test(e.trigger)) continue;
  const list = hot.get(e.from);
  if (!list) continue;
  tried++;
  const tokens = [...lastPress(cfgOf.get(e.to)), ...quoted(e.trigger), cleaned(e.trigger)].filter(Boolean);
  const m = find(list, tokens);
  if (m) {
    found++;
    (out[e.from] = out[e.from] || {})[e.to] = { x: m.h.x, y: m.h.y, w: m.h.w, h: m.h.h, by: m.token, text: m.h.text.slice(0, 30) || m.h.label, sc: m.sc };
  } else misses.push(`${e.from} → ${e.to} | ${e.trigger}`);
}
fs.writeFileSync(path.join(S, 'hotspots.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(S, 'hotspots-misses.txt'), misses.join('\n'));
// 느슨하게 맞은 것(70점 미만)은 엉뚱한 버튼일 수 있으니 따로 적는다
const low = [];
for (const [from, m] of Object.entries(out)) for (const [to, r] of Object.entries(m)) if (r.sc < 70) low.push(`${r.sc} | ${from} → ${to} | 단서: ${r.by} | 잡힌 버튼: ${r.text}`);
low.sort();
fs.writeFileSync(path.join(S, 'hotspots-low.txt'), low.join('\n'));
console.log(`버튼 자리가 있는 화면 ${hot.size} · 시도 ${tried} · 찾음 ${found} · 못 찾음 ${misses.length} · 느슨한 맞춤 ${low.length}개(hotspots-low.txt)`);
