import type { Verdict } from '../api/github';

// PASS/FAIL/INVALID 배지 — 리포트가 아직 없으면 워크플로우 상태를 폴백으로 표시
export function VerdictBadge({ verdict, running }: { verdict: Verdict | null; running: boolean }) {
  if (verdict) {
    const cls = { PASS: 'badge pass', FAIL: 'badge fail', INVALID: 'badge invalid' }[verdict.verdict];
    return <span className={cls}>{verdict.verdict}</span>;
  }
  return <span className="badge pending">{running ? '실행 중' : '리포트 없음'}</span>;
}
