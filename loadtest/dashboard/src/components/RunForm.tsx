import { useState } from 'react';
import { dispatchRun } from '../api/github';

// value=워크플로우가 받는 값(영어 고정), label=한글 설명. soak 은 Phase 4 까지 제외(#184 리뷰).
const PROFILES = [
  { value: 'smoke', label: 'smoke — 빠른 검증 (5 rps · 1분)' },
  { value: 'load', label: 'load — 목표 부하 (목표 rps 10분 유지)' },
  { value: 'stress', label: 'stress — 한계 탐색 (100→400 rps 계단)' },
  { value: 'spike', label: 'spike — 급증 부하 (순간 폭증)' },
];
const TARGETS = [
  { value: 'scenarios/daily_mix.js', label: '현실 믹스 — 6개 유저 여정 혼합' },
  { value: 'matrix/focus-session-list.js', label: '집중세션 조회 ⭐ — 커서 API (Phase 1 표적)' },
  { value: 'matrix/focus-session-create.js', label: '집중세션 생성 — 쓰기 경로' },
  { value: 'matrix/stats-today.js', label: '오늘 통계 — 인덱스 대조군' },
];

// 딸깍 버튼 — workflow_dispatch 호출 (run 은 concurrency 로 직렬화됨)
export function RunForm({ onDispatched }: { onDispatched: () => void }) {
  const [profile, setProfile] = useState('smoke');
  const [target, setTarget] = useState(TARGETS[0].value);
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
          프로파일 (부하 강도·시간)
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {PROFILES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          타겟 (무엇에 부하)
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
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
