import { useState } from 'react';
import { getToken } from './api/github';
import { RunForm } from './components/RunForm';
import { RunList } from './components/RunList';
import { PatModal } from './components/PatModal';
import { TargetCatalog } from './components/TargetCatalog';
import { TARGETS } from './catalog';

export default function App() {
  const [hasToken, setHasToken] = useState(!!getToken());
  const [refreshKey, setRefreshKey] = useState(0);
  // 타겟 선택은 App 이 소유 — 트리거(RunForm)와 카탈로그(TargetCatalog)가 공유
  const [target, setTarget] = useState(TARGETS[0].value);

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
          <RunForm
            target={target}
            onTargetChange={setTarget}
            onDispatched={() => setRefreshKey((k) => k + 1)}
          />
          <TargetCatalog selected={target} onPick={setTarget} />
          <RunList refreshKey={refreshKey} />
        </>
      )}
    </div>
  );
}
