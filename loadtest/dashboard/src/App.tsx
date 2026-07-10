import { useState } from 'react';
import { getToken } from './api/github';
import { RunForm } from './components/RunForm';
import { RunList } from './components/RunList';
import { PatModal } from './components/PatModal';
import { SingleApiMode } from './components/SingleApiMode';
import { TARGETS } from './catalog';

type Mode = 'single' | 'scenario';

export default function App() {
  const [hasToken, setHasToken] = useState(!!getToken());
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<Mode>('single');
  const [target, setTarget] = useState(TARGETS[0].value); // 시나리오 모드 타겟
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="app">
      <header>
        <h1>gromo 부하테스트 대시보드</h1>
        <p className="muted">
          트리거·히스토리·판정·baseline diff. 시계열 심층분석은 Grafana(관측 VM :3000).
        </p>
        <button className="link" onClick={() => setHasToken(false)}>
          PAT 변경
        </button>
      </header>

      {!hasToken && <PatModal onSaved={() => setHasToken(true)} />}

      {hasToken && (
        <>
          <div className="tabs">
            <button className={`tab${mode === 'single' ? ' active' : ''}`} onClick={() => setMode('single')}>
              단일 API 부하
            </button>
            <button
              className={`tab${mode === 'scenario' ? ' active' : ''}`}
              onClick={() => setMode('scenario')}
            >
              유저 시나리오 부하
            </button>
          </div>

          {mode === 'single' ? (
            <SingleApiMode onDispatched={refresh} />
          ) : (
            <RunForm target={target} onTargetChange={setTarget} onDispatched={refresh} />
          )}
          <RunList refreshKey={refreshKey} />
        </>
      )}
    </div>
  );
}
