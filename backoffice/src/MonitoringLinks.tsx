import { MONITORING_GROUPS } from './monitoringLinkList';

export function MonitoringLinks() {
  return <div className="policy-workspace">
    <header className="workspace-header"><div><h1>모니터링 링크</h1><p>운영 로그, 알림, 대시보드를 새 탭에서 엽니다. 각 서비스 로그인이 필요합니다.</p></div></header>
    {MONITORING_GROUPS.map(group => <section className="monitoring-group" key={group.title}>
      <h2>{group.title}</h2>
      {group.hint && <p className="field-hint">{group.hint}</p>}
      {group.command && <pre className="monitoring-command"><code>{group.command}</code></pre>}
      <ul className="monitoring-links">{group.links.map(link => <li key={link.name}><a href={link.url} target="_blank" rel="noreferrer">{link.name}{link.note && <small>{link.note}</small>}</a></li>)}</ul>
    </section>)}
  </div>;
}
