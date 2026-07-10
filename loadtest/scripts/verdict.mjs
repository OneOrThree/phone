#!/usr/bin/env node
// make verdict — run 판정 (PRD §6-3). 외부 의존성 0.
//
// 평가 순서(명세): ① INVALID(선점·부하기 CPU>80%·메타 불일치) 를 가장 먼저 — 참이면
// threshold/회귀를 건너뛴다(부하기 원인 고지연의 회귀 오판정 방지). ② threshold(k6 summary 의
// metrics[*].thresholds). ③ baseline 회귀(전체 p95 +10%·에러율·dropped — per-endpoint diff 는
// per-endpoint threshold 도입(Phase 1)과 함께 확장).
//
// 사용:
//   node verdict.mjs <reportDir>              # 판정 → verdict.json, exit: PASS=0 FAIL=1 INVALID=2
//   node verdict.mjs --promote <reportDir>    # baseline 승격 파일 생성 (사람 승인 PR 로 커밋)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_DIR = join(LT_DIR, 'reports', 'baseline');

const promote = process.argv[2] === '--promote';
const reportDir = process.argv[promote ? 3 : 2];
if (!reportDir) {
  console.error('사용법: verdict.mjs [--promote] <reportDir>');
  process.exit(64);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const meta = readJson(join(reportDir, 'meta.json'));
const summaryPath = join(reportDir, 'summary.json');
const summary = existsSync(summaryPath) ? readJson(summaryPath) : null;

const baselineKey = `${meta.profile}__${meta.target.replaceAll('/', '_')}.json`;
const baselinePath = join(BASELINE_DIR, baselineKey);

// ── baseline 승격 모드 — run 리포트를 기준으로 저장 (커밋·PR 은 사람 소관) ──
if (promote) {
  if (!summary) {
    console.error('[promote] summary.json 없는 run 은 baseline 이 될 수 없음');
    process.exit(1);
  }
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(baselinePath, JSON.stringify({ meta, summary }, null, 2));
  console.log(`[promote] baseline 갱신 → ${baselinePath} (커밋·PR 승인은 사람이)`);
  process.exit(0);
}

const reasons = [];
let verdict = 'PASS';

// ── ① INVALID — 가장 먼저 평가 ──────────────────────────────
if (meta.preempted) reasons.push('INVALID: spot 선점으로 run 중단');
if (meta.loadgenMaxCpu > 80) reasons.push(`INVALID: 부하기 CPU ${meta.loadgenMaxCpu}% > 80% — 측정 불신`);
if (!summary) reasons.push('INVALID: summary.json 없음 (비정상 종료)');

const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
if (baseline) {
  // 비교 가능 조건: sha 만 다르고 나머지 메타 동일 (PRD §6-2)
  for (const k of ['seedVersion', 'sut', 'db', 'loadgen', 'k6OptionsHash', 'mixVersion']) {
    if (baseline.meta[k] !== meta[k]) {
      reasons.push(`INVALID: 메타 불일치(${k}: baseline=${baseline.meta[k]} vs run=${meta[k]}) — diff 거부`);
    }
  }
}

if (reasons.length > 0) verdict = 'INVALID';

// ── ② threshold (k6 1차 판정 회수) ──────────────────────────
const failedThresholds = {};
if (verdict !== 'INVALID' && summary) {
  for (const [name, m] of Object.entries(summary.metrics)) {
    if (!m.thresholds) continue;
    for (const [expr, t] of Object.entries(m.thresholds)) {
      if (!t.ok) {
        failedThresholds[`${name} :: ${expr}`] = false;
        reasons.push(`FAIL(threshold): ${name} — ${expr}`);
      }
    }
  }
  if (Object.keys(failedThresholds).length > 0) verdict = 'FAIL';
}

// ── ③ baseline 회귀 diff ────────────────────────────────────
const pct = (cur, base) => (base > 0 ? Math.round(((cur - base) / base) * 1000) / 10 : null);
let diff = null;
if (verdict !== 'INVALID' && summary && baseline) {
  const key = 'http_req_duration{phase:main}';
  const cur = summary.metrics[key]?.values ?? {};
  const base = baseline.summary.metrics[key]?.values ?? {};
  const curErr = summary.metrics['http_req_failed{phase:main}']?.values?.rate ?? 0;
  const baseErr = baseline.summary.metrics['http_req_failed{phase:main}']?.values?.rate ?? 0;
  const curDropped = summary.metrics.dropped_iterations?.values?.count ?? 0;

  diff = {
    p95: { base: base['p(95)'], cur: cur['p(95)'], pct: pct(cur['p(95)'], base['p(95)']) },
    p99: { base: base['p(99)'], cur: cur['p(99)'], pct: pct(cur['p(99)'], base['p(99)']) },
    errRate: { base: baseErr, cur: curErr },
    dropped: curDropped,
  };
  if (diff.p95.pct !== null && diff.p95.pct >= 10) {
    verdict = 'FAIL';
    reasons.push(`FAIL(회귀): p95 ${diff.p95.base}→${diff.p95.cur}ms (+${diff.p95.pct}%) ≥ +10%`);
  }
  if (curDropped > 0) {
    verdict = 'FAIL';
    reasons.push(`FAIL(회귀): dropped_iterations ${curDropped} > 0 (같은 rps 에서 포화)`);
  }
}

const out = {
  verdict,
  reasons,
  baseline: baseline ? baselineKey : null,
  diff,
  meta: { sha: meta.sha, profile: meta.profile, target: meta.target, startedAt: meta.startedAt },
};
writeFileSync(join(reportDir, 'verdict.json'), JSON.stringify(out, null, 2));
console.log(`[verdict] ${verdict}${reasons.length ? '\n  - ' + reasons.join('\n  - ') : ''}`);

process.exit(verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2);
