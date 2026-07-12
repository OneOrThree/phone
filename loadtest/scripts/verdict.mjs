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

// INVALID 사유 수집(promote 가드와 판정에서 공유) — loadgenMaxCpu<0 은 조회 실패(수집 불가)라
// "안전"이 아니라 신뢰 불가로 INVALID 취급 (#183 리뷰)
const invalidReasons = [];
if (meta.preempted) invalidReasons.push('INVALID: spot 선점으로 run 중단');
if (meta.loadgenMaxCpu > 80) invalidReasons.push(`INVALID: 부하기 CPU ${meta.loadgenMaxCpu}% > 80% — 측정 불신`);
if (meta.loadgenMaxCpu < 0) invalidReasons.push('INVALID: 부하기 CPU 조회 실패 — 측정 신뢰도 확인 불가');
// 현재 run 의 SUT 지연 조회 실패(collect 가 -1)는 baseline 부재(pct=null skip)와 달리 실제 장애 → INVALID (#211 리뷰).
if (meta.sutP95 < 0 || meta.sutP99 < 0) invalidReasons.push('INVALID: SUT 지연 p95/p99 조회 실패 — 판정 지표 확인 불가');
// summary 부분 수거(N-1)는 dropped·에러율 과소집계 → INVALID. preempted 는 별도 사유라 중복 제외 (#211 리뷰).
if (!meta.preempted && meta.spots != null && meta.summariesCollected != null && meta.summariesCollected !== meta.spots)
  invalidReasons.push(`INVALID: summary 수거 ${meta.summariesCollected}/${meta.spots} — 부분 병합(과소집계)`);
if (!summary) invalidReasons.push('INVALID: summary.json 없음 (비정상 종료)');

// ── baseline 승격 모드 — run 리포트를 기준으로 저장 (커밋·PR 은 사람 소관) ──
if (promote) {
  // 선점·부하기 과부하·조회 실패 run 을 baseline 으로 승격하면 이후 모든 회귀 비교가 오염된다 (#183 리뷰)
  if (invalidReasons.length > 0) {
    console.error(`[promote] INVALID run 은 baseline 이 될 수 없음:\n  - ${invalidReasons.join('\n  - ')}`);
    process.exit(1);
  }
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(baselinePath, JSON.stringify({ meta, summary }, null, 2));
  console.log(`[promote] baseline 갱신 → ${baselinePath} (커밋·PR 승인은 사람이)`);
  process.exit(0);
}

const reasons = [...invalidReasons];
let verdict = 'PASS';

// ── ① INVALID — 가장 먼저 평가 (invalidReasons 는 위에서 수집) ──
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
  const curErr = summary.metrics['http_req_failed{phase:main}']?.values?.rate ?? 0;
  const baseErr = baseline.summary.metrics['http_req_failed{phase:main}']?.values?.rate ?? 0;
  const curDropped = summary.metrics.dropped_iterations?.values?.count ?? 0;
  // GROMO-763: p95/p99 는 SUT micrometer 히스토그램(meta.sutP95/sutP99 — 참 글로벌·부하기 대수 무관).
  // k6 summary 의 http_req_duration 은 per-VM 이라 N대에선 병합 불가 → 회귀 소스에서 제외.
  // 기존(pre-763) baseline 은 meta.sutP95 부재 → pct=null 로 회귀 게이트 일시 skip(N대 baseline 재승격이 게이트).
  const curP95 = meta.sutP95, curP99 = meta.sutP99;
  const baseP95 = baseline.meta.sutP95 ?? null, baseP99 = baseline.meta.sutP99 ?? null;

  diff = {
    p95: { base: baseP95, cur: curP95, pct: (curP95 > 0 && baseP95 > 0) ? pct(curP95, baseP95) : null },
    p99: { base: baseP99, cur: curP99, pct: (curP99 > 0 && baseP99 > 0) ? pct(curP99, baseP99) : null },
    errRate: { base: baseErr, cur: curErr },
    dropped: curDropped,
  };
  if (diff.p95.pct !== null && diff.p95.pct >= 10) {
    verdict = 'FAIL';
    reasons.push(`FAIL(회귀): SUT p95 ${diff.p95.base}→${diff.p95.cur}ms (+${diff.p95.pct}%) ≥ +10%`);
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
