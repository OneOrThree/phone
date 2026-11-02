import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, request } from './api';
import { kst, verdictText, type ReleaseStatusResponse, type ReleaseUnit, type StoreVersion } from './releaseText';
import type { SystemVersions } from './versions';

const NONE = '확인 불가';
const storeText = (store: StoreVersion | null | undefined) =>
  store?.status === 'ok' && store.version ? store.version : store?.status === 'local' ? '로컬 모드' : store?.status === 'unpublished' ? '미공개' : NONE;

function UnitCell({ unit }: { unit: ReleaseUnit | null | undefined }) {
  if (!unit) return <>{NONE}</>;
  const time = kst(unit.deployedAt);
  return <>
    {unit.tag ?? '태그 없음'} · <code title={unit.commit}>{unit.commit.slice(0, 7)}</code>
    {time && <small>{time}</small>}
    {unit.runUrl && <small><a href={unit.runUrl} target="_blank" rel="noreferrer">배포 실행 보기</a></small>}
  </>;
}

export function ReleaseStatus({ versions, onUnauthorized }: { versions: SystemVersions | null; onUnauthorized: () => void }) {
  const [status, setStatus] = useState<ReleaseStatusResponse | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'failed'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    request<ReleaseStatusResponse>('/api/system/release-status', { signal: controller.signal })
      .then(value => { setStatus(value); setState('done'); })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
        setState('failed');
      });
    return () => controller.abort();
  }, []);
  const verdict = verdictText(state === 'done' ? status?.verdict : null);
  const units = status?.units;
  const rows: [string, ReactNode][] = [
    ['운영 서버', <UnitCell unit={units?.server} />],
    ['백오피스', <UnitCell unit={units?.backoffice} />],
    ['Kafka', <UnitCell unit={units?.kafka} />],
    ['Redis', <UnitCell unit={units?.redis} />],
    ['iOS App Store', storeText(versions?.iosStore)],
    ['Android Play', storeText(status?.androidStore)],
    ['Data DB', versions?.data?.schemaVersion ? `V${versions.data.schemaVersion}` : NONE],
    ['Notification DB', versions?.notification?.schemaVersion ? `V${versions.notification.schemaVersion}` : NONE],
  ];
  return <div className="policy-workspace">
    <header className="workspace-header"><div><h1>출시 현황</h1><p>앱을 내기 전에 운영 서버에 없는 서버 변경이 main에 있는지 확인합니다.</p></div></header>
    {state === 'loading' ? <p role="status" aria-busy="true">출시 현황을 불러오는 중…</p>
      : status?.local ? <p className="callout" role="status">로컬 모드에서는 GitHub와 스토어를 조회하지 않습니다.</p>
      : <>
        <section className={`callout release-verdict ${verdict.tone}`} role="status">
          <h2>{verdict.title}</h2>
          {verdict.detail && <p>{verdict.detail}</p>}
          {status?.verdict?.status === 'server-first' && <p><a href={status.verdict.compareUrl} target="_blank" rel="noreferrer">변경 비교 보기</a></p>}
        </section>
        <div className="policy-table-wrap"><table className="policy-table"><thead><tr><th>대상</th><th>운영 값</th></tr></thead>
          <tbody>{rows.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td></tr>)}</tbody></table></div>
      </>}
  </div>;
}
