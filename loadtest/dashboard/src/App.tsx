import { useState } from 'react';
import { getToken } from './api/github';
import { RunForm } from './components/RunForm';
import { RunList } from './components/RunList';
import { PatModal } from './components/PatModal';

export default function App() {
  const [hasToken, setHasToken] = useState(!!getToken());
  const [refreshKey, setRefreshKey] = useState(0);

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
          <RunForm onDispatched={() => setRefreshKey((k) => k + 1)} />
          <RunList refreshKey={refreshKey} />
        </>
      )}
    </div>
  );
}
