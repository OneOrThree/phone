// 다시 찍은 캡처를 최종 폴더로 옮긴다: <폴더>/NNN-<화면 id>.png → shots/final/<화면 id>.png
//   사용: node promote.cjs <묶음 이름 또는 폴더 경로> [--dry]
// - 실패한 장(-FAILED)과 화면 id 가 아닌 보조 장면은 건너뛴다.
// - 시뮬레이터로 찍어 둔 화면(report 의 via: "simulator")은 웹 캡처로 덮어쓰지 않는다.
const fs = require('fs');
const path = require('path');
const { ROOT, loadMerged } = require('./sections.cjs');
const arg = process.argv[2], dry = process.argv.includes('--dry');
if (!arg) { console.error('묶음 이름(예: hall) 또는 폴더 경로를 주세요.'); process.exit(1); }
const src = fs.existsSync(arg) ? path.resolve(arg) : path.join(ROOT, 'shots', arg);
const finalDir = path.join(ROOT, 'shots', 'final');
const known = new Set(loadMerged().nodes.map((n) => n.id));
const keep = new Set();
for (const f of fs.readdirSync(path.join(ROOT, 'shots')).filter((x) => /^report-.*\.json$/.test(x)))
  for (const r of JSON.parse(fs.readFileSync(path.join(ROOT, 'shots', f), 'utf8'))) if (r.via === 'simulator') keep.add(r.id);
const tutorialDir = path.basename(src) === 'tutorial';
let copied = 0;
const skipped = [];
for (const f of fs.readdirSync(src).filter((x) => /^\d+-.*\.png$/.test(x)).sort()) {
  if (f.includes('-FAILED')) { skipped.push(`${f} (실패한 장)`); continue; }
  let id = f.replace(/^\d+-/, '').replace(/\.png$/, '');
  if (tutorialDir) id = /^s\d\d$/.test(id) ? `tutorial.${id}` : id === 'hallGuide' ? 'home.hallGuide' : id;
  if (keep.has(id)) { skipped.push(`${f} (시뮬레이터 캡처가 있어 그대로 둠)`); continue; }
  if (!known.has(id) && !/^tutorial\.s\d\d$/.test(id)) { skipped.push(`${f} (화면 id 아님)`); continue; }
  if (!dry) fs.copyFileSync(path.join(src, f), path.join(finalDir, `${id}.png`));
  copied++;
}
console.log(`${dry ? '(시험) ' : ''}옮김 ${copied}장 → ${finalDir}`);
if (skipped.length) console.log('건너뜀:\n  ' + skipped.join('\n  '));
