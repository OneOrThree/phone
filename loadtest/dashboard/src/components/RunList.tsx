import { Fragment, useEffect, useRef, useState } from 'react';
import { listRuns, getVerdict, type WorkflowRun, type Verdict } from '../api/github';
import { VerdictBadge } from './VerdictBadge';
import { RunDetail } from './RunDetail';

const dur = (r: WorkflowRun) => {
  const ms = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime();
  return r.status === 'completed' ? `${Math.round(ms / 60000)}분` : '—';
};

// run 히스토리 — 10초 폴링. verdict 는 완료 run 만 조회(요청 절약), 클릭 시 diff 펼침.
export function RunList({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  // 캐시는 useRef 로 — state 로 두면 폴링 클로저가 초기값만 캡처해 가드가 항상 참이 되고
  // 완료 run 의 verdict 를 매 폴링마다 재조회한다 (#185 리뷰). ref 는 최신값을 읽는다.
  const verdictsRef = useRef<Record<number, Verdict | null>>({});
  const [, bump] = useState(0); // 캐시 채워지면 리렌더 트리거
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rs = await listRuns();
        if (!alive) return;
        setRuns(rs);
        setError('');
        for (const r of rs.filter((r) => r.status === 'completed').slice(0, 10)) {
          if (verdictsRef.current[r.run_number] === undefined) {
            const v = await getVerdict(r.run_number);
            if (!alive) return;
            verdictsRef.current[r.run_number] = v;
            bump((n) => n + 1);
          }
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <section className="card">
      <h2>run 히스토리</h2>
      {error && <p className="err">조회 실패: {error} (PAT 권한: actions r + contents r)</p>}
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>run</th>
            <th>상태</th>
            <th>판정</th>
            <th>소요</th>
            <th>시각</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const v = verdictsRef.current[r.run_number] ?? null;
            return (
              <Fragment key={r.id}>
                <tr>
                  <td>{r.run_number}</td>
                  <td>{r.display_title}</td>
                  <td>{r.status === 'completed' ? (r.conclusion ?? '') : r.status}</td>
                  <td>
                    <VerdictBadge verdict={v} running={r.status !== 'completed'} />
                  </td>
                  <td>{dur(r)}</td>
                  <td>{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                  <td>
                    <a href={r.html_url} target="_blank" rel="noreferrer">
                      로그
                    </a>
                    {v && (
                      <button className="link" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? '접기' : '상세'}
                      </button>
                    )}
                  </td>
                </tr>
                {open === r.id && v && (
                  <tr>
                    <td colSpan={7}>
                      <RunDetail runNumber={r.run_number} verdict={v} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {runs.length === 0 && !error && <p className="muted">아직 run 이 없습니다 — 위에서 실행 ▶</p>}
    </section>
  );
}
