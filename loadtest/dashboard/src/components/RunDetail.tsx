import { useEffect, useState } from 'react';
import { getRunDetail, type RunDetailData, type Verdict } from '../api/github';
import { DiffView } from './DiffView';

const GRAFANA = 'http://localhost:3000/d/loadtest-k6'; // make grafana (IAP 터널) 전제 — obs Grafana

const num = (v: number | null | undefined, unit = '', dash = '—') =>
  v === null || v === undefined || v === -1 ? dash : `${Math.round(v * 10) / 10}${unit}`;

// run 리포트 상세 — 슬림 리포트 4종(verdict/meta/summary/pg_top20)을 한 화면에 (GROMO-771).
// baseline 유무와 무관하게 실측 지표를 항상 보여준다 — artifact zip 을 열어보게 만들지 않는 것이 목적.
export function RunDetail({ runNumber, verdict }: { runNumber: number; verdict: Verdict }) {
  const [d, setD] = useState<RunDetailData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getRunDetail(runNumber)
      .then((r) => alive && setD(r))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [runNumber]);

  if (error) return <p className="err">상세 조회 실패: {error}</p>;
  if (!d) return <p className="muted">리포트 불러오는 중…</p>;

  const m = d.meta;
  const k6 = d.summary?.metrics ?? {};
  const dur = k6['http_req_duration{phase:main}']?.values;
  const errRate = k6['http_req_failed{phase:main}']?.values?.rate;
  const dropped = k6['dropped_iterations']?.values?.count;
  // threshold 결과(병합 OR) — 어느 shard 든 깨졌으면 fail 보존
  const thresholdFailed = Object.values(k6).some((mt) =>
    Object.values(mt.thresholds ?? {}).some((t) => !t.ok),
  );
  const multiShard = (m?.spots ?? 1) > 1;

  return (
    <div className="detail">
      {m && (
        <p className="kv">
          <b>신뢰도</b> 부하기 CPU {num(m.loadgenMaxCpu, '%')} <span className="muted">(가드 80%)</span>
          {m.loadgenCpuPlatforms ? ` · 세대 ${m.loadgenCpuPlatforms}` : ''}
          {` · 선점 ${m.preempted ? '⚠️ 있음' : '없음'}`}
          {` · k6 exit ${m.k6ExitCode}`}
          {multiShard ? ` · summary ${m.summariesCollected}/${m.spots}대` : ''}
          {thresholdFailed ? ' · ' : ''}
          {thresholdFailed && <span className="worse">threshold 초과</span>}
        </p>
      )}

      <table>
        <thead>
          <tr>
            <th>지표</th>
            <th>p95</th>
            <th>p99</th>
            <th>avg</th>
            <th>max</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              클라 지연 (k6{multiShard ? ' · shard-0 근사' : ''})
            </td>
            <td>{num(dur?.['p(95)'], 'ms')}</td>
            <td>{num(dur?.['p(99)'], 'ms')}</td>
            <td>{num(dur?.avg, 'ms')}</td>
            <td>{num(dur?.max, 'ms')}</td>
          </tr>
          <tr>
            <td>
              서버 지연 (micrometer<span className="muted"> · 대수 무관 참값</span>)
            </td>
            <td>{num(m?.sutP95, 'ms')}</td>
            <td>{num(m?.sutP99, 'ms')}</td>
            <td colSpan={2} className="muted">
              에러율 {errRate === undefined ? '—' : `${Math.round(errRate * 1000) / 10}%`} · dropped{' '}
              {dropped ?? '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {m && (
        <p className="kv muted">
          <b>환경</b> SUT {m.sut} · DB {m.db} · 부하 {m.loadgen} · seed {m.seedVersion} · k6opts{' '}
          {m.k6OptionsHash}
        </p>
      )}

      <DiffView verdict={verdict} />

      {d.pgTop.length > 0 && (
        <details className="pgtop">
          <summary>DB Top 쿼리 (total_ms 상위 {Math.min(d.pgTop.length, 8)}) — 느린 쿼리 붉게</summary>
          <table>
            <thead>
              <tr>
                <th>calls</th>
                <th>mean_ms</th>
                <th>total_ms</th>
                <th>hit%</th>
                <th>query</th>
              </tr>
            </thead>
            <tbody>
              {d.pgTop.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  <td>{r.calls}</td>
                  <td className={Number(r.mean_ms) >= 100 ? 'worse' : ''}>{r.mean_ms}</td>
                  <td>{r.total_ms}</td>
                  <td>{r.hit_pct || '—'}</td>
                  <td>
                    <code className="query">{r.query.replace(/\s+/g, ' ').slice(0, 110)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {m && m.startedAt !== 'unknown' && m.endedAt !== 'unknown' && (
        <p className="kv">
          <a
            href={`${GRAFANA}?orgId=1&from=${new Date(m.startedAt).getTime()}&to=${new Date(m.endedAt).getTime()}`}
            target="_blank"
            rel="noreferrer"
          >
            Grafana 이 run 시간창으로 ↗
          </a>{' '}
          <span className="muted">(make grafana 터널 필요)</span>
        </p>
      )}
    </div>
  );
}
