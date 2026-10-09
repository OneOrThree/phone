// merged.json → 묶음별 SVG(svg/NN-key.svg) + manifest.json
// 배치: 왼쪽→오른쪽 트리. 화면마다 들어오는 화살표는 하나(가장 먼저 닿는 길),
// 나머지 이동은 화면 아래 글로 적는다. 화면 이미지는 나중에 shot:<id> 사각형에 채운다.
const fs = require('fs');
const path = require('path');
const { ROOT, SECTIONS, TUTORIAL_IDS, sectionOf, loadMerged } = require('./sections.cjs');
const TODAY = process.env.WF_DATE || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜

const W = 402, H = 874, GAPX = 400, PAD = 110, HEADER = 250, CAPTION_TOP = 18;
// 자식이 하나면 오른쪽으로 잇고, 여럿이면 아래로 펼친다(폰 화면이 세로로 길어서 옆으로 늘어놓는 편이 덜 길다)
const FANGAP = 170, BUS = 48, LABEL_BAND = 124, SPINE = 36, ROOT_GAP = 260, SHELF_W = 13000, SHELF_GAP = 200;
const EMBED = process.env.EMBED === '1';
const PASTEL = ['#EBF2FF', '#FFF2E3', '#EBFAEB', '#F5EBFF'];
const KIND = { screen: '화면', state: '상태', popup: '팝업', confirm: '확인창', sheet: '바텀시트', cutscene: '전환 장면' };
const STROKE = { popup: ['#F2994A', 3], confirm: ['#F2994A', 3], sheet: ['#F2994A', 3], cutscene: ['#9B6BDF', 3] };

// ── 글자 폭 어림(Noto Sans KR) ──
const cw = (ch, size) => {
  const c = ch.codePointAt(0);
  if (ch === ' ') return size * 0.28;
  if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0xd7ff) || (c >= 0xf900 && c <= 0xffef)) return size * 0.97;
  if ((c >= 0x2190 && c <= 0x21ff) || (c >= 0x2460 && c <= 0x24ff) || (c >= 0x25a0 && c <= 0x27bf) || c === 0x2014 || c === 0x2026 || c === 0x203b) return size * 0.97;
  if (/[A-Z]/.test(ch)) return size * 0.66;
  if (/[0-9]/.test(ch)) return size * 0.58;
  if (/[a-z]/.test(ch)) return size * 0.56;
  return size * 0.42;
};
const textW = (s, size) => [...s].reduce((a, ch) => a + cw(ch, size), 0);
function wrap(text, size, maxW, maxLines = 99) {
  const lines = [];
  let cur = '', curW = 0, lastSpace = -1;
  const lim = maxW * 0.95;
  for (const ch of [...String(text).replace(/\s+/g, ' ').trim()]) {
    const w = cw(ch, size);
    if (curW + w > lim && cur) {
      if (lastSpace > cur.length * 0.45) {
        lines.push(cur.slice(0, lastSpace));
        cur = cur.slice(lastSpace + 1) + ch;
      } else {
        lines.push(cur);
        cur = ch === ' ' ? '' : ch;
      }
      curW = textW(cur, size);
      lastSpace = cur.lastIndexOf(' ');
      continue;
    }
    if (ch === ' ') lastSpace = cur.length;
    cur += ch;
    curW += w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.{1,2}$/, '') + '…';
    return cut;
  }
  return lines;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ── 데이터 준비 ──
const merged = loadMerged();
let nodes = merged.nodes.map((n) => ({ ...n }));
let edges = merged.edges.map((e) => ({ ...e }));

// 캡처 보고(있으면): id → {status, note}
const status = new Map();
const shotsDir = path.join(ROOT, 'shots');
if (fs.existsSync(shotsDir)) {
  for (const f of fs.readdirSync(shotsDir).filter((x) => /^report-.*\.json$/.test(x))) {
    for (const r of JSON.parse(fs.readFileSync(path.join(shotsDir, f), 'utf8'))) status.set(r.id, r);
  }
}

// 튜토리얼: 단계별 캡처 결과가 있으면 묶인 노드를 단계별 노드로 바꾼다
const tutFile = path.join(shotsDir, 'tutorial-steps.json');
const tutorialChain = []; // [{from,to,trigger}]
let tutorialExits = '';
if (fs.existsSync(tutFile)) {
  const t = JSON.parse(fs.readFileSync(tutFile, 'utf8'));
  const stepId = (n) => `tutorial.s${String(n).padStart(2, '0')}`;
  const oldToNew = {
    guide: 0, 'guide.line2': 1, 'guide.line3': 2, 'guide.line4': 3, 'home.tutorialFocusStart': 4,
    'fishingArrival.tutorial': 5, 'focusSetup.tutorial': 7, 'focus.tutorialIntro': 9, 'focus.tutorialFirstFish': 11,
    'focus.tutorialPause': 14, 'rest.tutorial': 15, 'focus.tutorialEnd': 16, 'focus.tutorialEndConfirm': 18, 'focusResult.tutorial': 19,
  };
  const have = new Set(t.steps.map((s) => s.step));
  const remap = (id) => {
    if (!(id in oldToNew)) return id;
    let n = oldToNew[id];
    while (!have.has(n) && n < 22) n++;
    return stepId(n);
  };
  nodes = nodes.filter((n) => !(n.id in oldToNew));
  for (const s of t.steps) {
    nodes.push({ id: s.id, route: s.route, kind: 'state', title: `${s.step}단계 · ${s.title}`, condition: s.line ? `몽돌: “${s.line}”` : '', toastNotes: [], domain: 'tutorial' });
    status.set(s.id, { id: s.id, status: s.status || 'ok', note: s.note || '' });
  }
  const hall = nodes.find((n) => n.id === 'home.hallGuide');
  if (hall && t.after) {
    if (t.after.line) hall.condition = `몽돌: “${t.after.line}”`;
    if (t.after.status) status.set('home.hallGuide', { id: 'home.hallGuide', status: t.after.status, note: t.after.note || '' });
  }
  // 바깥 묶음에서 튜토리얼로 들어오는 간선만 남기고, 튜토리얼 안쪽은 단계 사슬로 대체
  edges = edges.filter((e) => !(e.from in oldToNew) && e.from !== 'home.hallGuide' ? true : e.from === 'home.hallGuide').map((e) => ({ ...e, to: remap(e.to) }));
  edges = edges.filter((e) => !(e.to === 'home.hallGuide' && e.from === 'home'));
  for (let i = 0; i < t.steps.length - 1; i++) tutorialChain.push({ from: t.steps[i].id, to: t.steps[i + 1].id, trigger: t.steps[i].next || '다음' });
  // 마지막 화살표의 글씨는 실제로 누르는 버튼만: next 의 "버튼 → 그 뒤 연출 → …" 에서 첫 토막. after.enteredBy 는 도달 조건 설명이라 라벨로 쓰지 않는다
  if (t.after && t.steps.length) tutorialChain.push({ from: t.steps[t.steps.length - 1].id, to: 'home.hallGuide', trigger: (t.steps[t.steps.length - 1].next || '섬으로 돌아가기').split(' → ')[0] });
  tutorialExits = t.exits || '';
} else {
  // 단계별 결과가 없을 때: 조사된 묶음 노드를 정해진 순서로 잇는다
  const order = ['guide', 'guide.line2', 'guide.line3', 'guide.line4', 'home.tutorialFocusStart', 'fishingArrival.tutorial', 'focusSetup.tutorial', 'focus.tutorialIntro', 'focus.tutorialFirstFish', 'focus.tutorialPause', 'rest.tutorial', 'focus.tutorialEnd', 'focus.tutorialEndConfirm', 'focusResult.tutorial', 'home.hallGuide'];
  const have = new Set(nodes.map((n) => n.id));
  const present = order.filter((id) => have.has(id));
  for (let i = 0; i < present.length - 1; i++) {
    const real = edges.find((e) => e.from === present[i] && e.to === present[i + 1]);
    tutorialChain.push({ from: present[i], to: present[i + 1], trigger: real ? real.trigger : '다음 단계 (사이에 항해 연출)' });
  }
}
for (const c of tutorialChain) edges.push({ ...c, chain: true, condition: '' });

// 버튼 자리: hotspots.json = { 출발 화면 id: { 도착 화면 id: {x,y,w,h} } } (402×874 기준)
const hotFile = path.join(ROOT, 'hotspots.json');
const hotspots = fs.existsSync(hotFile) ? JSON.parse(fs.readFileSync(hotFile, 'utf8')) : {};

const byId = new Map(nodes.map((n) => [n.id, n]));
const secOf = new Map(nodes.map((n) => [n.id, sectionOf(n)]));
const secIndex = new Map(SECTIONS.map((s, i) => [s.key, i]));
const secLabel = (key) => `${String(secIndex.get(key) + 1).padStart(2, '0')} ${SECTIONS[secIndex.get(key)].title.split(' — ')[0]}`;

// ── 묶음 하나 배치 ──
function buildSection(sec, idx) {
  const mine = nodes.filter((n) => secOf.get(n.id) === sec.key);
  if (!mine.length) return null;
  const inSec = new Set(mine.map((n) => n.id));
  const intra = edges.filter((e) => inSec.has(e.from) && inSec.has(e.to) && (sec.key !== 'tutorial' || e.chain));
  const out = new Map();
  for (const e of intra) (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e);

  // 뿌리 후보 순서: route 순서 → 그 route 의 기본 화면 먼저 → 원래 순서
  const routeRank = (n) => { const i = sec.routes.indexOf(n.route); return i < 0 ? 99 : i; };
  const cand = mine.map((n, i) => ({ n, i })).sort((a, b) => routeRank(a.n) - routeRank(b.n) || (a.n.id === a.n.route ? -1 : 0) - (b.n.id === b.n.route ? -1 : 0) || a.i - b.i).map((x) => x.n);
  if (sec.key === 'onboarding') cand.sort((a, b) => (a.id === 'login.bootLoading' ? -1 : 0) - (b.id === 'login.bootLoading' ? -1 : 0));
  if (sec.key === 'tutorial' && tutorialChain.length) cand.sort((a, b) => (a.id === tutorialChain[0].from ? -1 : 0) - (b.id === tutorialChain[0].from ? -1 : 0));

  const parent = new Map(), children = new Map(), treeEdge = new Map(), roots = [];
  const seen = new Set();
  const bfs = (root) => {
    roots.push(root.id); seen.add(root.id);
    const q = [root.id];
    while (q.length) {
      const id = q.shift();
      for (const e of out.get(id) || []) {
        if (seen.has(e.to)) continue;
        seen.add(e.to); parent.set(e.to, id); treeEdge.set(e.to, e);
        (children.get(id) || children.set(id, []).get(id)).push(e.to);
        q.push(e.to);
      }
    }
  };
  // 1차: 기본 화면(id === route)만 뿌리로, 2차: 남은 것
  for (const n of cand) if (!seen.has(n.id) && (n.id === n.route || sec.key === 'tutorial' || n.id === 'login.bootLoading')) bfs(n);
  for (const n of cand) {
    if (seen.has(n.id)) continue;
    const base = n.route;
    if (seen.has(base) && inSec.has(base) && n.id !== base) {
      // 눌러서 가는 길이 없는 상태(조건에 따라 보이는 모습)는 기본 화면 아래에 점선으로 단다
      const e = { from: base, to: n.id, trigger: short(n.reach || n.condition || '조건에 따라 보임', 70), condition: '', variant: true };
      seen.add(n.id); parent.set(n.id, base); treeEdge.set(n.id, e);
      (children.get(base) || children.set(base, []).get(base)).push(n.id);
      roots.push('__skip__'); bfs(n); roots.splice(roots.indexOf('__skip__'), 2);
    } else bfs(n);
  }

  // 화면 아래 글
  const num = new Map();
  let counter = 0;
  const order = [];
  const dfs = (id) => { num.set(id, `${String(idx + 1).padStart(2, '0')}-${String(++counter).padStart(2, '0')}`); order.push(id); for (const c of children.get(id) || []) dfs(c); };
  roots.forEach(dfs);

  const caption = (n) => {
    const L = [];
    for (const t of wrap(`${num.get(n.id)} ${n.title}`, 18, W, 3)) L.push({ t, size: 18, color: '#1F1F1F', weight: 700, lh: 26 });
    const st = status.get(n.id);
    const meta = `${KIND[n.kind] || n.kind}${n.condition ? ' · ' + short(n.condition, 110) : ''}`;
    for (const t of wrap(meta, 13, W, 5)) L.push({ t, size: 13, color: '#6B6B6B', weight: 400, lh: 19 });
    if (st && st.status === 'uncaptured') for (const t of wrap(`※ 캡처 못 함: ${short(st.note || '웹 연습용 모드에서 도달 불가', 120)}`, 13, W, 4)) L.push({ t, size: 13, color: '#C0392B', weight: 400, lh: 19 });
    if (st && st.status === 'approx') for (const t of wrap(`※ 실제와 다를 수 있음: ${short(st.note || '', 120)}`, 13, W, 4)) L.push({ t, size: 13, color: '#B7791F', weight: 400, lh: 19 });
    if (st && st.via === 'simulator') L.push({ t: `※ 아이폰 시뮬레이터에서 찍은 실제 화면${st.date ? ` (${st.date})` : ''}`, size: 13, color: '#6B6B6B', weight: 400, lh: 19 });
    if (!parent.has(n.id)) {
      const inb = edges.filter((e) => e.to === n.id && secOf.get(e.from) !== sec.key && byId.has(e.from));
      inb.slice(0, 4).forEach((e) => { for (const t of wrap(`◀ ${byId.get(e.from).title}〔${secLabel(secOf.get(e.from))}〕에서: ${e.trigger}`, 13, W, 3)) L.push({ t, size: 13, color: '#8A5A00', weight: 400, lh: 19 }); });
      if (inb.length > 4) L.push({ t: `◀ 외 ${inb.length - 4}곳에서 들어옴`, size: 13, color: '#8A5A00', weight: 400, lh: 19 });
    }
    const moves = edges.filter((e) => e.from === n.id && byId.has(e.to) && treeEdge.get(e.to) !== e && !(sec.key === 'tutorial' && !e.chain && inSec.has(e.to)));
    const local = moves.filter((e) => inSec.has(e.to)), cross = moves.filter((e) => !inSec.has(e.to));
    const all = [...local, ...cross];
    all.slice(0, 16).forEach((e) => {
      const isCross = !inSec.has(e.to);
      const txt = `→ ${e.trigger} ⇒ ${byId.get(e.to).title}${isCross ? `〔${secLabel(secOf.get(e.to))}〕` : ` (${num.get(e.to)})`}`;
      for (const t of wrap(txt, 13, W, 3)) L.push({ t, size: 13, color: isCross ? '#2B5FD9' : '#333333', weight: 400, lh: 19 });
    });
    if (all.length > 16) L.push({ t: `→ 외 ${all.length - 16}개 이동`, size: 13, color: '#333333', weight: 400, lh: 19 });
    for (const note of (n.toastNotes || []).slice(0, 4)) for (const t of wrap(`· ${note}`, 13, W, 2)) L.push({ t, size: 13, color: '#6B6B6B', weight: 400, lh: 19 });
    return L;
  };
  const cap = new Map(mine.map((n) => [n.id, caption(n)]));
  const blockH = (id) => H + CAPTION_TOP + cap.get(id).reduce((a, l) => a + l.lh, 0);

  // ── 배치: 상자 크기 재기 → 자리 주기 ──
  const box = new Map(), pos = new Map();
  const measure = (id) => {
    const ch = children.get(id) || [], bh = blockH(id);
    let b;
    if (!ch.length) b = { w: W, h: bh };
    else if (ch.length === 1) { const c = measure(ch[0]); b = { w: W + GAPX + c.w, h: Math.max(bh, c.h) }; }
    else { const cs = ch.map(measure); b = { w: Math.max(W, cs.reduce((a, c) => a + c.w, 0) + FANGAP * (ch.length - 1)), h: bh + BUS + LABEL_BAND + Math.max(...cs.map((c) => c.h)) }; }
    box.set(id, b);
    return b;
  };
  const position = (id, x, y) => {
    pos.set(id, { x, y });
    const ch = children.get(id) || [];
    if (ch.length === 1) position(ch[0], x + W + GAPX, y);
    else if (ch.length > 1) { let cx = x; const cy = y + blockH(id) + BUS + LABEL_BAND; for (const c of ch) { position(c, cx, cy); cx += box.get(c).w + FANGAP; } }
  };
  roots.forEach(measure);
  // 뿌리 상자를 선반처럼 왼쪽부터 채우고, 너무 넓어지면 다음 줄로
  const rootRects = [];
  let sx = PAD, sy = HEADER, shelfH = 0, width = 0;
  for (const r of roots) {
    const b = box.get(r);
    if (sx > PAD && sx + b.w > SHELF_W) { sx = PAD; sy += shelfH + SHELF_GAP; shelfH = 0; }
    position(r, sx, sy);
    rootRects.push({ root: r, x: sx, y: sy, w: b.w, h: b.h });
    width = Math.max(width, sx + b.w);
    sx += b.w + ROOT_GAP; shelfH = Math.max(shelfH, b.h);
  }
  width += PAD;
  const height = sy + shelfH + PAD;
  const X = (id) => pos.get(id).x, Y = (id) => pos.get(id).y;

  // ── SVG ──
  const S = [], missing = [];
  S.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  S.push(`<rect id="bg" x="0" y="0" width="${width}" height="${height}" rx="28" fill="#FBFBFA"/>`);
  const secName = `${String(idx + 1).padStart(2, '0')} ${sec.title}`;
  S.push(`<text id="sec-title" x="${PAD - 30}" y="110" font-family="Noto Sans KR" font-weight="700" font-size="40" fill="#1F1F1F">${esc(secName)}</text>`);
  const metaLines = [
    `화면 ${mine.length}개 · ${TODAY} · 웹 연습용 모드 캡처(402×874)`,
    `빨간 화살표 = 누르면 가는 길(빨간 테두리가 누르는 버튼) · 회색 점선 = 조건에 따라 보이는 모습 · 화면 아래 → = 그 밖의 이동(파란 글씨는 다른 묶음)`,
    `주황 테두리 = 팝업·확인창·바텀시트 · 보라 테두리 = 전환 장면`,
  ];
  if (sec.key === 'tutorial' && tutorialExits) metaLines.push(short(`나가기: ${tutorialExits}`, 150));
  metaLines.forEach((t, i) => S.push(`<text id="sec-meta-${i}" x="${PAD - 30}" y="${148 + i * 25}" font-family="Noto Sans KR" font-size="16" fill="#6B6B6B">${esc(t)}</text>`));

  rootRects.forEach((rr, gi) => {
    S.push(`<rect id="group:${esc(rr.root)}" x="${rr.x - 60}" y="${rr.y - 50}" width="${rr.w + 120}" height="${rr.h + 90}" rx="20" fill="${PASTEL[gi % PASTEL.length]}"/>`);
  });

  // 화면 자리 + 글
  for (const id of order) {
    const n = byId.get(id), x = X(id), yy = Y(id);
    const [sc, sw] = STROKE[n.kind] || ['#C8C8C8', 1.5];
    const jpg = path.join(shotsDir, 'jpg', `${id}.jpg`);
    const st = status.get(id);
    // 보고가 uncaptured 면 지난 실행의 JPEG 가 남아 있어도 쓰지 않는다(옛 화면이 들어가는 것을 막는다)
    if (fs.existsSync(jpg) && !(st && st.status === 'uncaptured')) {
      // 캡처 그림을 SVG 안에 품는다(올릴 때) / 파일 경로로 건다(미리보기)
      const href = EMBED ? `data:image/jpeg;base64,${fs.readFileSync(jpg).toString('base64')}` : `file://${jpg}`;
      S.push(`<image id="img:${esc(id)}" x="${x}" y="${yy}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="${href}"/>`);
      S.push(`<rect id="shot:${esc(id)}" x="${x}" y="${yy}" width="${W}" height="${H}" rx="28" fill="none" stroke="${sc}" stroke-width="${sw}"/>`);
    } else {
      // 캡처가 없는 화면은 빈 자리 안에 이유를 적는다
      missing.push(id);
      S.push(`<rect id="shot:${esc(id)}" x="${x}" y="${yy}" width="${W}" height="${H}" rx="28" fill="#E9E9E9" stroke="${sc}" stroke-width="${sw}"/>`);
      const why = wrap(st && st.note ? st.note : '웹 연습용 모드에서는 이 화면을 띄울 수 없음', 14, W - 80, 8);
      S.push(`<text id="noshot-title:${esc(id)}" x="${x + 40}" y="${yy + 400}" font-family="Noto Sans KR" font-weight="700" font-size="22" fill="#8C8C8C">캡처 없음</text>`);
      why.forEach((t, i) => S.push(`<text id="noshot:${esc(id)}#${i}" x="${x + 40}" y="${yy + 436 + i * 21}" font-family="Noto Sans KR" font-size="14" fill="#8C8C8C">${esc(t)}</text>`));
    }
    let cy = yy + H + CAPTION_TOP;
    cap.get(id).forEach((l, i) => {
      S.push(`<text id="${l.weight === 700 ? 'title' : 'cap'}:${esc(id)}#${i}" x="${x}" y="${cy + l.size}" font-family="Noto Sans KR" font-weight="${l.weight}" font-size="${l.size}" fill="${l.color}">${esc(l.t)}</text>`);
      cy += l.lh;
    });
  }
  // 화살표 + 라벨 (화면 그림 위에 보이도록 화면 자리 뒤에 그린다)
  // 빨간 실선 = 누르면 가는 길. 누르는 버튼 자리를 알면 그 버튼에 빨간 테두리를 치고 거기서 출발한다.
  // 회색 점선 = 조건에 따라 보이는 모습(누르는 것이 아님).
  const RED = '#E5342E', GRAY = '#8C8C8C';
  const hotOf = (e) => {
    if (e.variant) return null;
    const h = (hotspots[e.from] || {})[e.to];
    if (!h || h.w * h.h > W * H * 0.45 || h.w < 6 || h.h < 6) return null;
    return h;
  };
  // 같은 화면에서 나가는 선이 겹치지 않게 출발 높이를 조금씩 벌린다
  const startY = new Map();
  for (const [pid, chs] of children) {
    const withHot = chs.map((to) => ({ to, h: hotOf(treeEdge.get(to)) })).filter((x) => x.h).sort((p1, p2) => p1.h.y + p1.h.h / 2 - (p2.h.y + p2.h.h / 2));
    let last = -1e9;
    for (const x of withHot) {
      let yy = x.h.y + x.h.h / 2;
      if (yy - last < 14) yy = last + 14;
      startY.set(`${pid}>${x.to}`, yy); last = yy;
    }
  }
  for (const [to, e] of treeEdge) {
    const p = e.from, sibs = children.get(p) || [];
    const color = e.variant ? GRAY : RED, sw = e.variant ? 3 : 5;
    const dash = e.variant ? ' stroke-dasharray="9 9"' : '';
    const cond = e.condition && e.condition.length <= 24 ? ` (${e.condition})` : '';
    const text = e.trigger + cond;
    const hot = hotOf(e);
    if (hot) S.push(`<rect id="hot:${esc(p)}&gt;${esc(to)}" x="${X(p) + hot.x - 3}" y="${Y(p) + hot.y - 3}" width="${hot.w + 6}" height="${hot.h + 6}" rx="${Math.min(14, (hot.h + 6) / 2)}" fill="${RED}" fill-opacity="0.14" stroke="${RED}" stroke-width="4"/>`);
    const hy = hot ? Y(p) + startY.get(`${p}>${to}`) : Y(p) + H / 2;
    if (sibs.length === 1) {
      const x1 = X(p) + W, x2 = X(to);
      // 화면 그림 안쪽 구간은 가늘고 옅게 — 그림을 덜 가리도록
      if (hot && X(p) + hot.x + hot.w + 3 < x1) S.push(`<path id="tail:${esc(p)}&gt;${esc(to)}" d="M${X(p) + hot.x + hot.w + 3} ${hy} H${x1}" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="0.7"/>`);
      S.push(`<path id="arrow:${esc(p)}&gt;${esc(to)}" d="M${x1} ${hy} H${x2 - 22}" fill="none" stroke="${color}" stroke-width="${sw}"${dash}/>`);
      S.push(`<path id="head:${esc(to)}" d="M${x2 - 24} ${hy - 12} L${x2 - 1} ${hy} L${x2 - 24} ${hy + 12} Z" fill="${color}"/>`);
      const lines = wrap(text, 15, GAPX - 60, 5);
      lines.forEach((t, i) => S.push(`<text id="lbl:${esc(to)}#${i}" x="${X(p) + W + 22}" y="${hy - 16 - (lines.length - 1 - i) * 21}" font-family="Noto Sans KR" font-weight="700" font-size="15" fill="#1F1F1F">${esc(t)}</text>`));
    } else {
      const right = hot && hot.x + hot.w / 2 > W / 2;
      const edge = right ? X(p) + W : X(p);
      const spine = right ? X(p) + W + SPINE : X(p) - SPINE;
      const busY = Y(p) + blockH(p) + BUS, cx = X(to) + W / 2, top = Y(to);
      if (hot) S.push(`<path id="tail:${esc(p)}&gt;${esc(to)}" d="M${right ? X(p) + hot.x + hot.w + 3 : X(p) + hot.x - 3} ${hy} H${edge}" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="0.7"/>`);
      S.push(`<path id="arrow:${esc(p)}&gt;${esc(to)}" d="M${edge} ${hy} H${spine} V${busY} H${cx} V${top - 22}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"${dash}/>`);
      S.push(`<path id="head:${esc(to)}" d="M${cx - 12} ${top - 24} L${cx} ${top - 1} L${cx + 12} ${top - 24} Z" fill="${color}"/>`);
      const lines = wrap(text, 15, 300, 4);
      lines.forEach((t, i) => S.push(`<text id="lbl:${esc(to)}#${i}" x="${cx + 20}" y="${top - 18 - (lines.length - 1 - i) * 21}" font-family="Noto Sans KR" font-weight="700" font-size="15" fill="#1F1F1F">${esc(t)}</text>`));
    }
  }

  S.push('</svg>');
  const file = `${String(idx + 1).padStart(2, '0')}-${sec.key}.svg`;
  fs.writeFileSync(path.join(ROOT, EMBED ? 'svg-embed' : 'svg', file), S.join('\n'));
  return { key: sec.key, name: secName, file, width, height, nodes: mine.length, roots: roots.length, arrows: treeEdge.size, hot: [...treeEdge.values()].filter((e) => hotOf(e)).length, shots: order.filter((id) => !missing.includes(id)), missing };
}

fs.mkdirSync(path.join(ROOT, EMBED ? 'svg-embed' : 'svg'), { recursive: true });
const manifest = SECTIONS.map(buildSection).filter(Boolean);
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 1));
for (const m of manifest) console.log(`${m.file.padEnd(20)} 화면 ${String(m.nodes).padStart(3)} · 뿌리 ${m.roots} · 화살표 ${m.arrows} · ${Math.round(m.width)}×${Math.round(m.height)}`);
console.log('캡처 없는 화면', manifest.reduce((a, m) => a + m.missing.length, 0));
console.log('합계 화면', manifest.reduce((a, m) => a + m.nodes, 0), '화살표', manifest.reduce((a, m) => a + m.arrows, 0));

// ── 안내판(00-index): 읽는 법 · 묶음 목록 · 알아둘 점 ──
{
  const total = manifest.reduce((a, m) => a + m.nodes, 0), arrows = manifest.reduce((a, m) => a + m.arrows, 0);
  const noShot = manifest.reduce((a, m) => a + m.missing.length, 0);
  const approx = [...status.values()].filter((r) => r.status === 'approx').length;
  const simCount = [...status.values()].filter((r) => r.via === 'simulator').length;
  const hotCount = manifest.reduce((a, m) => a + m.hot, 0);
  const IW = 2700, T = [];
  let y = 150;
  const text = (t, size, opt = {}) => { T.push(`<text id="idx-${T.length}" x="${opt.x || 120}" y="${y}" font-family="Noto Sans KR" font-weight="${opt.bold ? 700 : 400}" font-size="${size}" fill="${opt.color || '#1F1F1F'}">${esc(t)}</text>`); };
  text('GROMO 2.0 화면 워크플로우', 72, { bold: true }); y += 70;
  text(`${TODAY} · 앱 코드에서 뽑은 화면 이동 지도 · 화면 ${total}개 · 화살표 ${arrows}개 · 묶음 ${manifest.length}개`, 26, { color: '#6B6B6B' }); y += 110;

  text('읽는 법', 40, { bold: true }); y += 70;
  const legend = [
    ['arrow', '빨간 화살표 — 누르면 가는 길. 화살표 옆 굵은 글씨가 "무엇을 누르는지".'],
    ['hot', '빨간 테두리 — 그 화면에서 실제로 누르는 버튼. 화살표가 여기서 출발한다.'],
    ['dash', '회색 점선 — 누르는 것이 아니라 조건에 따라 보이는 모습 (비어 있을 때, 방장이 아닐 때 등).'],
    ['orange', '주황 테두리 화면 — 팝업 · 확인창 · 바텀시트.'],
    ['purple', '보라 테두리 화면 — 항해 같은 전환 장면.'],
    ['blue', '화면 아래 파란 글씨 — 다른 묶음으로 넘어가는 이동. 〔 〕 안이 도착 묶음.'],
    ['black', '화면 아래 검은 글씨 → — 같은 묶음 안의 그 밖의 이동. ( ) 안이 도착 화면 번호.'],
    ['brown', '화면 아래 갈색 글씨 ◀ — 다른 묶음에서 이 화면으로 들어오는 길.'],
  ];
  for (const [kind, label] of legend) {
    const cy = y - 12;
    if (kind === 'arrow') T.push(`<path id="lg-a" d="M120 ${cy} H250" fill="none" stroke="#E5342E" stroke-width="5"/><path id="lg-ah" d="M248 ${cy - 12} L272 ${cy} L248 ${cy + 12} Z" fill="#E5342E"/>`);
    if (kind === 'hot') T.push(`<rect id="lg-h" x="140" y="${cy - 20}" width="110" height="40" rx="14" fill="#E5342E" fill-opacity="0.14" stroke="#E5342E" stroke-width="4"/>`);
    if (kind === 'dash') T.push(`<path id="lg-d" d="M120 ${cy} H270" fill="none" stroke="#8C8C8C" stroke-width="3" stroke-dasharray="9 9"/>`);
    if (kind === 'orange') T.push(`<rect id="lg-o" x="170" y="${cy - 24}" width="48" height="48" rx="10" fill="#FBFBFA" stroke="#F2994A" stroke-width="3"/>`);
    if (kind === 'purple') T.push(`<rect id="lg-p" x="170" y="${cy - 24}" width="48" height="48" rx="10" fill="#FBFBFA" stroke="#9B6BDF" stroke-width="3"/>`);
    if (kind === 'blue') T.push(`<rect id="lg-b" x="170" y="${cy - 10}" width="48" height="20" rx="4" fill="#2B5FD9"/>`);
    if (kind === 'black') T.push(`<rect id="lg-k" x="170" y="${cy - 10}" width="48" height="20" rx="4" fill="#333333"/>`);
    if (kind === 'brown') T.push(`<rect id="lg-w" x="170" y="${cy - 10}" width="48" height="20" rx="4" fill="#8A5A00"/>`);
    text(label, 26, { x: 320 }); y += 62;
  }
  y += 50;
  text('묶음 목록', 40, { bold: true }); y += 70;
  for (const m of manifest) { text(`${m.name}`, 28, { bold: true }); text(`화면 ${m.nodes}개 · 화살표 ${m.arrows}개`, 24, { x: 1300, color: '#6B6B6B' }); y += 52; }
  y += 60;
  text('알아둘 점', 40, { bold: true }); y += 70;
  const notes = [
    `캡처는 웹에서 연습용 모드(서버 없이 가짜 데이터로 도는 모드)로 찍었다. 상태바·홈 바 자리는 빈 여백이고, 실제 폰과 조금 다를 수 있다.`,
    `서버에 연결돼야만 보이는 화면 ${approx}개는 조건을 풀거나 가짜 응답을 넣어 찍었다. 화면 아래에 "※ 실제와 다를 수 있음"이라고 적었다.`,
    `캡처가 없는 화면 ${noShot}개는 빈 틀에 이유를 적었다.${simCount ? ` 웹에서 안 뜨는 화면 ${simCount}장은 아이폰 시뮬레이터에서 찍었다.` : ''}`,
    `불러오는 중·오류 화면은 그리지 않았다. 토스트(잠깐 뜨는 한 줄 알림)는 화면 아래 글로만 적었다.`,
    `화살표 ${arrows}개 중 ${hotCount}개는 누르는 버튼에서 출발한다. 버튼을 자동으로 못 찾은 것(건물 그림, 아이콘, 자동 전환)은 화면 가장자리에서 출발한다.`,
    `코드에는 있지만 들어가는 길이 없는 화면(stats, members, friendSearch)과 개발용 화면은 뺐다.`,
    `몽돌 튜토리얼은 새 계정이 처음 섬을 가질 때만 자동으로 시작한다. 기존 계정은 설정의 "튜토리얼 다시보기"로 볼 수 있다.`,
  ];
  for (const n of notes) { for (const line of wrap(`· ${n}`, 26, IW - 260)) { text(line, 26); y += 40; } y += 14; }
  const IH = y + 80;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${IW}" height="${IH}" viewBox="0 0 ${IW} ${IH}">`, `<rect id="bg" x="0" y="0" width="${IW}" height="${IH}" rx="28" fill="#FFFDF5"/>`, ...T, '</svg>'].join('\n');
  fs.writeFileSync(path.join(ROOT, EMBED ? 'svg-embed' : 'svg', '00-index.svg'), svg);
  console.log(`00-index.svg ${IW}×${IH}`);
}
