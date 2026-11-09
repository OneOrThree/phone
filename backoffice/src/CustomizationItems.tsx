import { useEffect, useState } from 'react';
import { ApiError, request } from './api';
import { Thumb, date, kindLabel, rarityLabel, type AuditEvent, type ItemsResponse } from './CustomizationShared';
import type { Session } from './types';

interface PoolCurrent { revision: number; productIds: string[]; publishedAt: string | null }
interface PoolPublication { publicationId: string; revision: number; previousRevision: number; productIds: string[];
  previousProductIds: string[]; actor: string; approvedBy: string; approvedDigest: string; publishedAt: string }
interface PoolCatalog { current: PoolCurrent; history: PoolPublication[]; local?: boolean }
type Status = 'draft' | 'review' | 'approving' | 'approval_uncertain' | 'approved' | 'publishing' | 'published' | 'failed' | 'uncertain' | 'cancelled';
interface Draft { id: string; revision: number; expectedRevision: number; productIds: string[]; status: Status;
  approvalActor?: string; approvedBy?: string; approvedDigest?: string; dispatchActor?: string;
  receipt?: { revision: number; local?: boolean }; error?: string; updatedAt: string; audit: AuditEvent[] }
const STATUS: Record<Status, string> = { draft: '작성 중', review: '검토 대기', approving: '승인 중', approval_uncertain: '승인 결과 확인 필요',
  approved: '승인됨', publishing: '발행 중', published: '발행 완료', failed: '발행 실패', uncertain: '결과 확인 필요', cancelled: '철회됨' };
const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export function CustomizationItems({ session, onDirtyChange, onUnauthorized }: {
  session: Session; onDirtyChange: (dirty: boolean) => void; onUnauthorized: () => void }) {
  const [catalog, setCatalog] = useState<ItemsResponse | null>(null);
  const [pool, setPool] = useState<PoolCatalog | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  // null 이면 편성 중이 아니다(현황만 본다).
  const [picked, setPicked] = useState<string[] | null>(null);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const baseline = selected ? selected.productIds : pool?.current.productIds ?? [];
  const dirty = picked !== null && (!selected || selected.status === 'draft' || EDITABLE.includes(selected.status))
    && (!same([...picked].sort(), [...baseline].sort()) || (selected !== null && expectedRevision !== selected.expectedRevision));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function report(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) { onUnauthorized(); return; }
    setError(cause instanceof Error ? cause.message : '아이템 현황을 불러오지 못했습니다.');
    // 다른 변경이 먼저 들어간 경우에는 최신값을 다시 읽어 와 화면과 서버를 맞춘다.
    if (cause instanceof ApiError && cause.status === 409) {
      setNotice('다른 변경이 먼저 반영됐을 수 있어 최신값을 다시 불러왔습니다. 내용을 확인한 뒤 다시 시도하세요.');
      void load().catch(() => undefined);
    }
  }
  async function load() {
    const [items, current, list] = await Promise.all([
      request<ItemsResponse>('/api/customization/items'),
      request<PoolCatalog>('/api/customization/pool'),
      request<{ items: Draft[] }>('/api/customization/pool/drafts'),
    ]);
    setCatalog(items); setPool(current); setDrafts(list.items);
    if (selected) {
      const latest = list.items.find(item => item.id === selected.id);
      if (latest) { setSelected(latest); if (!dirty) setPicked([...latest.productIds]); }
    }
  }
  useEffect(() => { void load().catch(report); }, []);
  async function run(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try { await work(); } catch (cause) { report(cause); }
    finally { setBusy(''); }
  }
  const canLeave = () => !dirty || window.confirm('저장하지 않은 추첨 풀 변경이 있습니다. 버릴까요?');
  function select(item: Draft) {
    if (!canLeave()) return;
    setSelected(item); setPicked([...item.productIds]); setExpectedRevision(item.expectedRevision);
  }
  function startDraft() {
    if (!pool || !canLeave()) return;
    setSelected(null); setPicked([...pool.current.productIds]); setExpectedRevision(pool.current.revision);
  }
  function toggle(productId: string) {
    setPicked(previous => previous === null ? previous
      : previous.includes(productId) ? previous.filter(id => id !== productId) : [...previous, productId]);
  }
  async function save() {
    if (!picked) return;
    await run('save', async () => {
      const productIds = [...picked].sort();
      const item = await request<Draft>(selected ? `/api/customization/pool/drafts/${selected.id}` : '/api/customization/pool/drafts', {
        method: selected ? 'PATCH' : 'POST', csrfToken: session.csrfToken,
        body: { productIds, expectedRevision, ...(selected ? { revision: selected.revision } : {}) } });
      setDrafts(previous => [item, ...previous.filter(value => value.id !== item.id)]);
      setSelected(item); setPicked([...item.productIds]); setExpectedRevision(item.expectedRevision);
    });
  }
  async function transition(action: 'review' | 'approve' | 'publish' | 'cancel') {
    if (!selected || dirty) return;
    if (action === 'publish' && !window.confirm(`승인된 추첨 풀(${selected.productIds.length}개)을 ${session.environment} 환경에 발행할까요? 다음 추첨부터 적용됩니다.`)) return;
    if (action === 'cancel' && !window.confirm('변경안을 철회할까요? 승인된 변경안은 Data 승인 기록도 취소됩니다.')) return;
    await run(action, async () => {
      const item = await request<Draft>(`/api/customization/pool/drafts/${selected.id}/${action}`, {
        method: 'POST', csrfToken: session.csrfToken, body: { revision: selected.revision } });
      setSelected(item); setPicked([...item.productIds]);
      setDrafts(previous => [item, ...previous.filter(value => value.id !== item.id)]);
      if (action === 'publish') await load();
    });
  }
  const editable = !selected || EDITABLE.includes(selected.status);
  const canPublish = selected && (selected.status === 'approved' || selected.status === 'uncertain')
    && selected.approvedBy !== session.actor && (!selected.dispatchActor || selected.dispatchActor === session.actor);
  const staticOrigin = catalog?.staticOrigin ?? null;
  const editing = picked !== null && editable;
  return <div className="policy-workspace">
    <header className="workspace-header"><div><h1>꾸미기 아이템</h1><p>아이템 현황을 보고, 추첨에 나오는 풀을 검토·승인한 뒤 발행합니다.</p></div>
      <button className="button primary" disabled={!!busy || !pool} onClick={startDraft}>현재 풀로 변경안 작성</button></header>
    <div className="local-banner"><strong>{session.environment === 'local' ? '로컬 모의 데이터' : session.environment === 'dev' ? '개발 환경 · dev' : '운영 환경 · prod'}</strong>
      <span>풀에서 빠진 아이템도 이미 가진 사용자에게는 계속 보입니다. 발행한 풀은 다음 추첨부터 적용됩니다.</span></div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>닫기</button></div>}
    {notice && <p className="callout" role="status">{notice}</p>}
    <section className="policy-card"><div className="section-heading"><h2>아이템 현황</h2>
      <button className="text-button" disabled={!!busy} onClick={() => void run('refresh', load)}>새로고침</button></div>
      {catalog && pool ? <><p>추첨 풀 revision {pool.current.revision} · {pool.current.productIds.length}개 · 발행 {date(pool.current.publishedAt)}</p>
        {picked !== null && <p className="callout">{selected ? `변경안 · ${STATUS[selected.status]}` : '새 변경안'} — 체크한 {picked.length}개가 풀이 됩니다.{!editable && ' (이 상태에서는 수정할 수 없습니다)'}</p>}
        <div className="cust-table-wrap"><table className="cust-table"><thead><tr>
          {picked !== null && <th scope="col">풀</th>}<th scope="col">아이템</th><th scope="col">부위</th><th scope="col">희귀도</th><th scope="col">추첨 포함</th><th scope="col">보유자</th></tr></thead>
          <tbody>{catalog.items.map(item => {
            const eligible = ['head', 'neck'].includes(item.category ?? '') && item.rarity !== null;
            return <tr key={item.productId} className={item.retiredAt ? 'cust-retired' : undefined}>
              {picked !== null && <td><input type="checkbox" aria-label={`${item.title} 추첨 풀 포함`} checked={picked.includes(item.productId)}
                disabled={!!busy || !editing || !eligible} onChange={() => toggle(item.productId)} /></td>}
              <td><div className="cust-name"><Thumb item={item} staticOrigin={staticOrigin} /><span><strong>{item.title}</strong><small>{item.productId}{item.retiredAt ? ' · 판매 종료' : ''}{!item.displayable ? ' · 앱에 안 보임' : ''}</small></span></div></td>
              <td>{kindLabel(item.category ?? item.kind)}</td><td>{rarityLabel(item.rarity)}</td>
              <td>{item.inPool ? '포함' : '제외'}</td><td>{item.ownerCount.toLocaleString('ko-KR')}명</td></tr>;
          })}</tbody></table></div></> : <p>아이템을 불러오는 중입니다.</p>}</section>
    <div className="policy-grid"><section className="policy-card"><h2>풀 변경안</h2>
      {drafts.length ? <ul className="item-list">{drafts.map(item => <li key={item.id}><button className={`item-row ${selected?.id === item.id ? 'selected' : ''}`}
        onClick={() => select(item)} disabled={!!busy}><strong>{STATUS[item.status]}</strong>
        <span>revision {item.expectedRevision} 기준 · {item.productIds.length}개</span><time>{date(item.updatedAt)}</time></button></li>)}</ul> : <p>작성한 변경안이 없습니다.</p>}</section>
      <section className="policy-card"><h2>{selected ? `변경안 · ${STATUS[selected.status]}` : '검토·승인'}</h2>
        {picked === null ? <p>「현재 풀로 변경안 작성」을 누르거나 변경안을 고르세요.</p> : <>
          <div className="action-buttons">
            {editable && <button className="button secondary" disabled={!!busy || (!!selected && !dirty)} onClick={() => void save()}>변경안 저장</button>}
            {selected?.status === 'draft' && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('review')}>검토 요청</button>}
            {selected && (selected.status === 'review' || (selected.status === 'approval_uncertain' && selected.approvalActor === session.actor))
              && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('approve')}>{selected.status === 'approval_uncertain' ? '같은 승인 요청 재시도' : '승인하기'}</button>}
            {canPublish && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('publish')}>{selected?.status === 'uncertain' ? '같은 요청 재시도' : '추첨 풀 발행'}</button>}
            {selected && EDITABLE.includes(selected.status) && <button className="button secondary" disabled={!!busy || dirty} onClick={() => void transition('cancel')}>변경안 철회</button>}
          </div>
          {pool && expectedRevision !== pool.current.revision && editable && <button type="button" className="button secondary" disabled={!!busy}
            onClick={() => setExpectedRevision(pool.current.revision)}>현재 revision {pool.current.revision}으로 바꾸기</button>}
          {selected?.status === 'approved' && selected.approvedBy === session.actor && <p className="callout">승인자와 다른 운영자가 로그인해 발행해야 합니다.</p>}
          {selected?.status === 'approval_uncertain' && <p className="callout">승인 결과를 확인하지 못했습니다. 최초 승인자가 같은 승인 요청을 재시도하거나 철회하세요.</p>}
          {selected?.status === 'uncertain' && <p className="callout">결과를 단정할 수 없습니다. 최초 발행자가 같은 요청으로 재시도해야 합니다.</p>}
          {selected?.error && <p className="error-message" role="alert">{selected.error}</p>}
          {selected?.receipt && <p className="callout">{selected.receipt.local ? '로컬 모의 발행' : '발행 완료'} · revision {selected.receipt.revision}</p>}
          {selected && <><h3>검토·승인 기록</h3><ol className="audit-list">{selected.audit.map((event, index) => <li key={`${event.at}-${index}`}>{event.actor} · {event.action} · 수정본 {event.revision} · {date(event.at)}</li>)}</ol></>}</>}</section></div>
    <section className="policy-card"><h2>발행 이력</h2>{pool?.history?.length ? <ol className="history-list">{pool.history.map(entry => <li key={entry.publicationId}>
      <details><summary>revision {entry.revision} · {date(entry.publishedAt)} · 승인 {entry.approvedBy} / 발행 {entry.actor}</summary>
        <p>{entry.previousProductIds.length}개 → {entry.productIds.length}개 · 승인 digest {entry.approvedDigest}</p>
        <p>{entry.productIds.join(', ')}</p></details></li>)}</ol> : <p>표시할 발행 이력이 없습니다.</p>}</section>
  </div>;
}
const EDITABLE: Status[] = ['draft', 'review', 'approved', 'failed', 'approval_uncertain'];
