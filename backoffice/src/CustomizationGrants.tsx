import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from './api';
import { Thumb, date, kindLabel, rarityLabel, type AuditEvent, type ItemsResponse } from './CustomizationShared';
import type { Session } from './types';

type Status = 'draft' | 'review' | 'approving' | 'approval_uncertain' | 'approved' | 'executing' | 'completed' | 'failed' | 'uncertain' | 'cancelled';
interface Preview { productId: string; productTitle: string; mode: 'ALL' | 'USERS'; targets: { nickname: string; userId: string }[];
  unknownNicknames: string[]; targetCount: number; alreadyOwnedCount: number; newCount: number; digest: string | null; previewedAt: string }
interface Counts { targetCount: number; grantedCount: number; alreadyOwnedCount: number; skippedCount: number }
interface Grant { id: string; revision: number; productId: string; mode: 'ALL' | 'USERS'; nicknamesText: string; reason: string;
  preview?: Preview; status: Status; approvalActor?: string; approvedBy?: string; dispatchActor?: string; grantId?: string;
  progress?: Counts; receipt?: Counts & { completedAt: string | null; local?: boolean }; error?: string; updatedAt: string; audit: AuditEvent[] }
interface Form { productId: string; mode: 'ALL' | 'USERS'; nicknamesText: string; reason: string }
const STATUS: Record<Status, string> = { draft: '작성 중', review: '검토 대기', approving: '승인 중', approval_uncertain: '승인 결과 확인 필요',
  approved: '승인됨', executing: '실행 중 · 이어서 실행 필요', completed: '지급 완료', failed: '실행 실패', uncertain: '결과 확인 필요', cancelled: '철회됨' };
const EDITABLE: Status[] = ['draft', 'review', 'approved', 'failed', 'approval_uncertain'];
const EMPTY: Form = { productId: '', mode: 'USERS', nicknamesText: '', reason: '' };
const formOf = (item: Grant): Form => ({ productId: item.productId, mode: item.mode, nicknamesText: item.nicknamesText, reason: item.reason });

function CountsView({ value, label }: { value: Counts; label: string }) {
  return <dl className="policy-values"><div><dt>대상</dt><dd>{value.targetCount.toLocaleString('ko-KR')}명</dd></div>
    <div><dt>{label}</dt><dd>새로 받음 {value.grantedCount.toLocaleString('ko-KR')} · 이미 보유 {value.alreadyOwnedCount.toLocaleString('ko-KR')} · 건너뜀 {value.skippedCount.toLocaleString('ko-KR')}</dd></div></dl>;
}

export function CustomizationGrants({ session, onDirtyChange, onUnauthorized }: {
  session: Session; onDirtyChange: (dirty: boolean) => void; onUnauthorized: () => void }) {
  const [catalog, setCatalog] = useState<ItemsResponse | null>(null);
  const [items, setItems] = useState<Grant[]>([]);
  const [selected, setSelected] = useState<Grant | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function report(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) { onUnauthorized(); return; }
    setError(cause instanceof Error ? cause.message : '지급 정보를 불러오지 못했습니다.');
  }
  async function load() {
    const [products, list] = await Promise.all([
      request<ItemsResponse>('/api/customization/items'),
      request<{ items: Grant[] }>('/api/customization/grants'),
    ]);
    setCatalog(products); setItems(list.items);
    if (selected) {
      const latest = list.items.find(item => item.id === selected.id);
      if (latest && !dirty) { setSelected(latest); setForm(formOf(latest)); }
    }
  }
  useEffect(() => { void load().catch(report); }, []);
  async function run(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError('');
    try { await work(); } catch (cause) { report(cause); }
    finally { setBusy(''); }
  }
  const canLeave = () => !dirty || window.confirm('저장하지 않은 지급 변경이 있습니다. 버릴까요?');
  function select(item: Grant) {
    if (!canLeave()) return;
    setSelected(item); setForm(formOf(item)); setDirty(false);
  }
  function newDraft() {
    if (!canLeave()) return;
    setSelected(null); setForm({ ...EMPTY }); setDirty(false);
  }
  function change(patch: Partial<Form>) {
    setForm(previous => previous ? { ...previous, ...patch } : previous); setDirty(true);
  }
  function apply(item: Grant) {
    setSelected(item); setForm(formOf(item));
    setItems(previous => [item, ...previous.filter(value => value.id !== item.id)]);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    await run('save', async () => {
      const item = await request<Grant>(selected ? `/api/customization/grants/${selected.id}` : '/api/customization/grants', {
        method: selected ? 'PATCH' : 'POST', csrfToken: session.csrfToken,
        body: { ...form, nicknamesText: form.mode === 'ALL' ? '' : form.nicknamesText, ...(selected ? { revision: selected.revision } : {}) } });
      apply(item); setDirty(false);
    });
  }
  async function transition(action: 'preview' | 'review' | 'approve' | 'execute' | 'cancel') {
    if (!selected || dirty) return;
    const title = catalog?.items.find(value => value.productId === selected.productId)?.title ?? selected.productId;
    if (action === 'execute') {
      const count = selected.preview?.targetCount ?? 0;
      const message = selected.mode === 'ALL'
        ? `「${title}」을 실행 시점의 모든 가입자·게스트(지금 ${count.toLocaleString('ko-KR')}명 기준)에게 지급할까요? 지급은 되돌릴 수 없습니다.`
        : `「${title}」을 ${count.toLocaleString('ko-KR')}명에게 지급할까요? 지급은 되돌릴 수 없습니다.`;
      if (!window.confirm(message)) return;
    }
    if (action === 'cancel' && !window.confirm('지급을 철회할까요? 승인된 지급은 Data 승인 기록도 취소됩니다.')) return;
    await run(action, async () => {
      apply(await request<Grant>(`/api/customization/grants/${selected.id}/${action}`, {
        method: 'POST', csrfToken: session.csrfToken, body: { revision: selected.revision } }));
    });
  }
  const grantable = (catalog?.items ?? []).filter(value => value.displayable && !value.retiredAt);
  const editable = !selected || EDITABLE.includes(selected.status);
  const preview = selected?.preview;
  const canExecute = selected && ['approved', 'uncertain', 'executing'].includes(selected.status)
    && selected.approvedBy !== session.actor && (!selected.dispatchActor || selected.dispatchActor === session.actor);
  const pickedItem = catalog?.items.find(value => value.productId === (selected?.productId ?? form?.productId));
  return <div className="policy-workspace">
    <header className="workspace-header"><div><h1>꾸미기 지급</h1><p>아이템을 고르고 대상을 미리 계산한 뒤, 한 운영자가 승인하고 다른 운영자가 실행합니다.</p></div>
      <button className="button primary" disabled={!!busy || !catalog} onClick={newDraft}>새 지급 작성</button></header>
    <div className="local-banner"><strong>{session.environment === 'local' ? '로컬 모의 데이터' : session.environment === 'dev' ? '개발 환경 · dev' : '운영 환경 · prod'}</strong>
      <span>지급은 되돌릴 수 없습니다. 전체 지급은 실행하는 순간의 가입자·게스트가 대상입니다. 이미 가진 사용자는 건너뜁니다.</span></div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>닫기</button></div>}
    <div className="policy-grid"><section className="policy-card"><div className="section-heading"><h2>지급 목록</h2>
      <button className="text-button" disabled={!!busy} onClick={() => void run('refresh', load)}>새로고침</button></div>
      {items.length ? <ul className="item-list">{items.map(item => <li key={item.id}><button className={`item-row ${selected?.id === item.id ? 'selected' : ''}`}
        onClick={() => select(item)} disabled={!!busy}><strong>{STATUS[item.status]}</strong>
        <span>{catalog?.items.find(value => value.productId === item.productId)?.title ?? item.productId} · {item.mode === 'ALL' ? '전체' : '닉네임 지정'}</span>
        <time>{date(item.updatedAt)}</time></button></li>)}</ul> : <p>작성한 지급이 없습니다.</p>}</section>
      <section className="policy-card"><h2>{selected ? `지급 · ${STATUS[selected.status]}` : '새 지급'}</h2>
        {form ? <><form id="grant-form" onSubmit={save}><fieldset disabled={!!busy || !editable}>
          <label className="field"><span className="field-label">아이템</span>
            <select value={form.productId} onChange={event => change({ productId: event.target.value })} required>
              <option value="">아이템을 고르세요</option>
              {grantable.map(value => <option key={value.productId} value={value.productId}>{value.title} · {kindLabel(value.category ?? value.kind)} · {rarityLabel(value.rarity)}</option>)}
            </select>
            {pickedItem && <span className="cust-name"><Thumb item={pickedItem} staticOrigin={catalog?.staticOrigin ?? null} /><span className="field-hint">{pickedItem.productId} · 보유자 {pickedItem.ownerCount.toLocaleString('ko-KR')}명</span></span>}</label>
          <fieldset className="field cust-mode"><legend className="field-label">지급 대상</legend>
            <label><input type="radio" name="mode" checked={form.mode === 'USERS'} onChange={() => change({ mode: 'USERS' })} /> 닉네임 지정</label>
            <label><input type="radio" name="mode" checked={form.mode === 'ALL'} onChange={() => change({ mode: 'ALL' })} /> 전체(실행 시점 가입자·게스트 포함)</label></fieldset>
          {form.mode === 'USERS' && <label className="field"><span className="field-label">닉네임(한 줄에 하나)</span>
            <textarea rows={5} value={form.nicknamesText} onChange={event => change({ nicknamesText: event.target.value })} />
            <span className="field-hint">대소문자를 무시하고 정확히 일치하는 닉네임만 찾습니다. 최대 500개.</span></label>}
          <label className="field"><span className="field-label">사유(1~200자)</span>
            <input value={form.reason} maxLength={200} onChange={event => change({ reason: event.target.value })} required />
            <span className="field-hint">감사 기록에 남습니다. 줄바꿈은 쓸 수 없습니다.</span></label>
        </fieldset></form>
        <div className="action-buttons">
          {editable && <button className="button secondary" type="submit" form="grant-form" disabled={!!busy || (!!selected && !dirty)}>{selected ? '지급 저장' : '초안 저장'}</button>}
          {selected?.status === 'draft' && <button className="button secondary" disabled={!!busy || dirty} onClick={() => void transition('preview')}>미리 계산</button>}
          {selected?.status === 'draft' && <button className="button primary" disabled={!!busy || dirty || !preview || !preview.digest || preview.unknownNicknames.length > 0}
            onClick={() => void transition('review')}>검토 요청</button>}
          {selected && (selected.status === 'review' || (selected.status === 'approval_uncertain' && selected.approvalActor === session.actor))
            && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('approve')}>{selected.status === 'approval_uncertain' ? '같은 승인 요청 재시도' : '승인하기'}</button>}
          {canExecute && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('execute')}>
            {selected.status === 'executing' ? '이어서 실행' : selected.status === 'uncertain' ? '같은 요청 재시도' : '지급 실행'}</button>}
          {selected && EDITABLE.includes(selected.status) && <button className="button secondary" disabled={!!busy || dirty} onClick={() => void transition('cancel')}>지급 철회</button>}
        </div>
        {selected && ['approved', 'uncertain', 'executing'].includes(selected.status) && selected.approvedBy === session.actor
          && <p className="callout">승인자와 다른 운영자가 실행해야 합니다.</p>}
        {selected?.status === 'approval_uncertain' && <p className="callout">승인 결과를 확인하지 못했습니다. 최초 승인자가 같은 승인 요청을 재시도하거나 철회하세요.</p>}
        {selected?.status === 'uncertain' && <p className="callout">결과를 단정할 수 없습니다. 최초 실행자가 같은 요청으로 재시도해야 합니다. 이미 지급된 사용자는 다시 받지 않습니다.</p>}
        {selected?.status === 'executing' && <p className="callout">Data 에서 지급이 계속 처리되고 있습니다. 최초 실행자가 「이어서 실행」을 눌러 이어 가세요. 연결이 끊겼더라도 실패가 아닙니다. 새로고침해 상태를 확인하세요.</p>}
        {selected?.error && <p className="error-message" role="alert">{selected.error}</p>}
        {selected?.progress && selected.status !== 'completed' && <CountsView value={selected.progress} label="진행" />}
        {selected?.receipt && <><p className="callout">{selected.receipt.local ? '로컬 모의 지급 완료' : '지급 완료'} · {date(selected.receipt.completedAt)}</p><CountsView value={selected.receipt} label="결과" /></>}
        {selected && !preview && editable && selected.status === 'draft' && <p className="callout">「미리 계산」으로 대상을 확인해야 검토 요청을 할 수 있습니다.</p>}
        {preview && <div className="cust-preview"><h3>미리 계산 결과 · {date(preview.previewedAt)}</h3>
          <dl className="policy-values"><div><dt>대상 수</dt><dd>{preview.targetCount.toLocaleString('ko-KR')}명{selected?.mode === 'ALL' ? ' (실행 시점에 다시 정해집니다)' : ''}</dd></div>
            <div><dt>이미 보유 / 새로 받음</dt><dd>{preview.alreadyOwnedCount.toLocaleString('ko-KR')}명 / {preview.newCount.toLocaleString('ko-KR')}명</dd></div></dl>
          {preview.unknownNicknames.length > 0 && <p className="error-message" role="alert">찾지 못한 닉네임: {preview.unknownNicknames.join(', ')} — 고친 뒤 다시 계산하세요.</p>}
          {preview.targets.length > 0 && <table className="cust-table"><thead><tr><th scope="col">닉네임</th><th scope="col">사용자 UUID</th></tr></thead>
            <tbody>{preview.targets.map(target => <tr key={target.userId}><td>{target.nickname}</td><td><code>{target.userId}</code></td></tr>)}</tbody></table>}</div>}
        {selected && <><h3>검토·승인 기록</h3><ol className="audit-list">{selected.audit.map((event, index) => <li key={`${event.at}-${index}`}>{event.actor} · {event.action} · 수정본 {event.revision} · {date(event.at)}</li>)}</ol></>}</>
          : <p>「새 지급 작성」을 누르거나 목록에서 지급을 고르세요.</p>}</section></div>
  </div>;
}
