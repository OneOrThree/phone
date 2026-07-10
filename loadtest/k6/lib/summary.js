// handleSummary — k6 집계 전체를 JSON 으로 남긴다. collect.sh 가 수거해 리포트의 summary.json 이 되고,
// verdict.mjs 가 metrics[*].thresholds 로 1차 판정을 읽는다.
export function summarize(data) {
  const out = {};
  out[__ENV.SUMMARY_PATH || 'summary.json'] = JSON.stringify(data);

  // 콘솔 한 줄 요약 — 러너/로컬 로그 가독용
  const failed = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds && Object.values(m.thresholds).some((t) => !t.ok))
    .map(([k]) => k);
  out.stdout = `\n[k6] thresholds ${failed.length === 0 ? 'PASS' : `FAIL: ${failed.join(', ')}`}\n`;
  return out;
}
