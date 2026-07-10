import { useState } from 'react';
import { dispatchRun } from '../api/github';

// soak 은 Phase 4 까지 workflow_dispatch 선택지에서 제외 — 목록을 workflow(loadtest.yml)와 일치시켜
// 서버가 거부할 값을 애초에 못 고르게 한다 (#184 리뷰: soak vs 90분 timeout)
const PROFILES = ['smoke', 'load', 'stress', 'spike'];
const TARGETS = [
  'scenarios/daily_mix.js',
  'matrix/focus-session-list.js',
  'matrix/focus-session-create.js',
  'matrix/stats-today.js',
];

// 딸깍 버튼 — workflow_dispatch 호출 (run 은 concurrency 로 직렬화됨)
export function RunForm({ onDispatched }: { onDispatched: () => void }) {
  const [profile, setProfile] = useState('smoke');
  const [target, setTarget] = useState(TARGETS[0]);
  const [updateBaseline, setUpdateBaseline] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [err, setErr] = useState('');

  const run = async () => {
    setState('busy');
    try {
      await dispatchRun(profile, target, updateBaseline);
      setState('ok');
      setTimeout(onDispatched, 3000); // dispatch 후 run 이 API 에 잡히기까지 지연
    } catch (e) {
      setErr(String(e));
      setState('err');
    }
  };

  return (
    <section className="card">
      <h2>run 트리거</h2>
      <div className="form-row">
        <label>
          프로파일
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {PROFILES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          타겟
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {TARGETS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={updateBaseline}
            onChange={(e) => setUpdateBaseline(e.target.checked)}
          />
          PASS 시 baseline 승격 PR
        </label>
        <button onClick={run} disabled={state === 'busy'}>
          {state === 'busy' ? '요청 중…' : '실행 ▶'}
        </button>
      </div>
      {state === 'ok' && <p className="ok">디스패치 완료 — 잠시 후 히스토리에 나타납니다.</p>}
      {state === 'err' && <p className="err">실패: {err} (PAT 권한: actions rw 필요)</p>}
    </section>
  );
}
