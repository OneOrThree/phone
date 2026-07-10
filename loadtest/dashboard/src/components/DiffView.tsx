import type { Verdict } from '../api/github';

const fmt = (v: number | null | undefined, unit = '') =>
  v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10}${unit}`;

// baseline diff 표 — 악화(+)는 붉게, 개선(−)은 푸르게 (PRD §6-4 기능 4)
export function DiffView({ verdict }: { verdict: Verdict }) {
  const d = verdict.diff;
  return (
    <div className="diff">
      {verdict.reasons.length > 0 && (
        <ul className="reasons">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {d ? (
        <table>
          <thead>
            <tr>
              <th>지표</th>
              <th>baseline</th>
              <th>이번 run</th>
              <th>변화</th>
            </tr>
          </thead>
          <tbody>
            {(['p95', 'p99'] as const).map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{fmt(d[k].base, 'ms')}</td>
                <td>{fmt(d[k].cur, 'ms')}</td>
                <td className={d[k].pct !== null && d[k].pct! >= 10 ? 'worse' : d[k].pct !== null && d[k].pct! < 0 ? 'better' : ''}>
                  {d[k].pct === null ? '—' : `${d[k].pct! > 0 ? '+' : ''}${d[k].pct}%`}
                </td>
              </tr>
            ))}
            <tr>
              <td>에러율</td>
              <td>{fmt(d.errRate.base * 100, '%')}</td>
              <td>{fmt(d.errRate.cur * 100, '%')}</td>
              <td />
            </tr>
            <tr>
              <td>dropped</td>
              <td>—</td>
              <td className={d.dropped > 0 ? 'worse' : ''}>{d.dropped}</td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted">
          baseline 없음 — 첫 PASS run 을 <code>make baseline-promote</code> 또는 워크플로우의
          update_baseline 로 승격하면 이후 run 부터 diff 가 표시됩니다.
        </p>
      )}
      <p className="muted">
        {verdict.meta.profile} × {verdict.meta.target} · sha {verdict.meta.sha}
        {verdict.baseline ? ` · baseline: ${verdict.baseline}` : ''}
      </p>
    </div>
  );
}
