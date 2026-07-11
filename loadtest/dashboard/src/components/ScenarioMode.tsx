import { useEffect, useMemo, useState } from 'react';
import { dispatchRun } from '../api/github';

// 유저 시나리오 부하 모드 (GROMO-750) — 시나리오 def(내가 저작한 JSON)를 골라 여정·가중치·스텝을
// 상세 표시하고 실행. 한 run 에서 여정을 가중 혼합, 한 유저가 스텝을 순차 실행(세션).
interface Step {
  recipe: string;
  desc?: string;
}
interface Journey {
  name: string;
  weight: number;
  steps: Step[];
}
interface ScenarioDef {
  id: string;
  name: string;
  description?: string;
  journeys: Journey[];
}

const PROFILES = [
  { value: 'smoke', label: 'smoke — 빠른 검증', rps: 5, ramping: false },
  { value: 'load', label: 'load — 목표 부하', rps: 50, ramping: false },
  { value: 'stress', label: 'stress — 한계 탐색', rps: null, ramping: true },
  { value: 'spike', label: 'spike — 급증', rps: null, ramping: true },
];

export function ScenarioMode({ onDispatched }: { onDispatched: () => void }) {
  const [scenarios, setScenarios] = useState<ScenarioDef[] | null>(null);
  const [err, setErr] = useState('');
  const [id, setId] = useState('');
  const [profile, setProfile] = useState('load');
  const [rps, setRps] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/scenarios.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`scenarios.json ${r.status}`))))
      .then((s) => {
        if (!Array.isArray(s)) throw new Error('scenarios.json 형식 오류 — 배열이 아닙니다');
        const defs = s as ScenarioDef[];
        setScenarios(defs);
        if (defs[0]) setId(defs[0].id);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const sel = useMemo(() => scenarios?.find((s) => s.id === id), [scenarios, id]);
  const totalW = sel ? sel.journeys.reduce((a, j) => a + j.weight, 0) || 1 : 1;
  const prof = PROFILES.find((p) => p.value === profile) ?? PROFILES[1];

  const run = async () => {
    if (!sel || state === 'busy') return;
    const rpsVal = prof.ramping ? '' : rps.trim();
    if (rpsVal && !/^[1-9][0-9]*$/.test(rpsVal)) {
      setMsg('실패: rps 는 1 이상 정수여야 합니다.');
      setState('err');
      return;
    }
    setState('busy');
    try {
      await dispatchRun(profile, 'scenarios/_generic.js', false, {
        scenario: sel.id,
        rate: rpsVal || undefined,
      });
      setMsg(
        `디스패치 완료 — "${sel.name}" (${profile}${rpsVal ? `, ${rpsVal}rps` : ''}). 히스토리에 나타납니다.`,
      );
      setState('ok');
      setTimeout(onDispatched, 3000);
    } catch (e) {
      setMsg(`실패: ${String(e)} (PAT 권한: actions rw)`);
      setState('err');
    }
  };

  return (
    <section className="card">
      <h2>유저 시나리오 부하 — 여정 혼합</h2>
      {err && <p className="err">{err}</p>}
      {!scenarios && !err && <p className="muted">시나리오 로딩…</p>}
      {scenarios && (
        <>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <label>
              시나리오
              <select value={id} onChange={(e) => setId(e.target.value)} disabled={state === 'busy'}>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              프로파일
              <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={state === 'busy'}>
                {PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              총 rps {prof.ramping ? '(계단형 — 무시)' : '(빈값=기본)'}
              <input
                type="text"
                className="short"
                value={prof.ramping ? '' : rps}
                placeholder={prof.ramping ? '계단형' : `${prof.rps} (기본)`}
                inputMode="numeric"
                disabled={state === 'busy' || prof.ramping}
                onChange={(e) => setRps(e.target.value)}
              />
            </label>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 12px', lineHeight: 1.5 }}>
            <b>rps</b> = 초당 요청 수(총량, 여정에 분산). 비우면 프로파일 기본(load 50·smoke 5). 계단형(stress/spike)은
            프로파일이 정해 무시됩니다.
          </p>

          {sel && (
            <div className="summary">
              <h3 className="summary-title">{sel.name} — 여정 상세</h3>
              {sel.description && (
                <p className="muted" style={{ margin: '0 0 14px' }}>
                  {sel.description}
                </p>
              )}
              {sel.journeys.map((j, i) => (
                <div className="journey" key={i}>
                  <div className="journey-head">
                    <span className="journey-name">{j.name}</span>
                    <span className="journey-weight">{Math.round((j.weight / totalW) * 100)}%</span>
                  </div>
                  <div className="weight-bar">
                    <span style={{ width: `${(j.weight / totalW) * 100}%` }} />
                  </div>
                  <div className="steps">
                    {j.steps.map((s, k) => (
                      <span className="step" key={k}>
                        {s.desc || s.recipe}
                        <span className="step-recipe">{s.recipe}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="run-actions">
            <span className="muted">한 유저가 여정 스텝을 순차 실행(세션). 여정은 가중치대로 혼합.</span>
            <button onClick={run} disabled={state === 'busy' || !sel}>
              {state === 'busy' ? '요청 중…' : '실행 ▶'}
            </button>
          </div>
          {state === 'ok' && <p className="ok">{msg}</p>}
          {state === 'err' && <p className="err">{msg}</p>}
        </>
      )}
    </section>
  );
}
