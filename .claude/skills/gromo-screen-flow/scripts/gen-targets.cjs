// 캡처 담당별 대상 목록을 만든다: capture/targets-<담당>.json
const fs = require('fs');
const path = require('path');
const { ROOT, sectionOf, loadMerged } = require('./sections.cjs');

const GROUPS = {
  'onboarding-home': ['onboarding', 'home', 'common'],
  focus: ['focus', 'permission'],
  hall: ['hall'],
  'board-library': ['board', 'library'],
  'tower-mail': ['tower', 'mail'],
  'shop-boat': ['shop', 'boat'],
};
const merged = loadMerged();
const bySection = new Map();
for (const n of merged.nodes) {
  const s = sectionOf(n);
  if (!bySection.has(s)) bySection.set(s, []);
  bySection.get(s).push(n);
}
const out = {};
for (const [group, secs] of Object.entries(GROUPS)) {
  const nodes = secs.flatMap((s) => bySection.get(s) || []);
  const ids = new Set(nodes.map((n) => n.id));
  const targets = nodes.map((n) => ({
    id: n.id, section: sectionOf(n), route: n.route, kind: n.kind, title: n.title,
    reach: n.reach, condition: n.condition, uiText: n.uiText, source: n.source,
    // 이 화면으로 들어오는 길 — 캡처할 때 어떤 버튼을 눌러야 하는지 단서
    inbound: merged.edges.filter((e) => e.to === n.id).slice(0, 4).map((e) => `${e.from} —[${e.trigger}]`),
  }));
  fs.writeFileSync(path.join(ROOT, 'capture', `targets-${group}.json`), JSON.stringify(targets, null, 1));
  out[group] = targets.length;
}
out.tutorialSkipped = (bySection.get('tutorial') || []).length;
console.log(JSON.stringify(out));
