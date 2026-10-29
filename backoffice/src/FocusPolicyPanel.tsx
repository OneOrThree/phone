import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from './api';
import type { Session } from './types';

interface Policy {
  secondsPerFish: number; dailyCapFish: number; personalSharePercent: number;
  goldenFishReward: number; goldenMaxMembers: number; goldenChancePpm: number[];
}
interface Current { revision: number; policy: Policy; publishedAt: string | null }
interface Published { publicationId: string | null; revision: number; previousRevision: number | null;
  actor: string | null; approvedBy: string | null; approvedDigest: string | null; publishedAt: string; policy: Policy }
interface Catalog { current: Current; history: Published[]; local?: boolean }
type Status = 'draft' | 'review' | 'approved' | 'publishing' | 'published' | 'failed' | 'uncertain' | 'cancelled';
interface Draft { id: string; revision: number; expectedRevision: number; policy: Policy; status: Status;
  approvedBy?: string; approvedDigest?: string; dispatchActor?: string; publicationId?: string;
  receipt?: Published & { local?: boolean }; error?: string; updatedAt: string;
  audit: { at: string; actor: string; action: string; revision: number }[] }
interface Snapshot { revision: number; policy: Policy; digest: string }
const STATUS: Record<Status, string> = { draft: '작성 중', review: '검토 대기', approved: '승인됨',
  publishing: '적용 중', published: '적용 완료', failed: '적용 실패', uncertain: '결과 확인 필요', cancelled: '철회됨' };
const FIELDS: { key: keyof Omit<Policy, 'goldenChancePpm'>; label: string; hint: string }[] = [
  { key: 'secondsPerFish', label: '물고기 1마리당 집중 시간(초)', hint: '새로 시작하는 집중 세션부터 적용' },
  { key: 'dailyCapFish', label: '하루 물고기 상한', hint: '사용자·섬별 하루 상한' },
  { key: 'personalSharePercent', label: '개인 지갑 몫(%)', hint: '현재 정책은 0으로 고정' },
  { key: 'goldenFishReward', label: '황금 물고기 보상량', hint: '당첨 시 섬에 적립할 물고기 수' },
  { key: 'goldenMaxMembers', label: '황금 물고기 확률 인원 상한', hint: '2명부터 이 인원까지의 확률을 지정' },
];
const LIMITS = { secondsPerFish: [30, 86400], dailyCapFish: [0, 960], personalSharePercent: [0, 0],
  goldenFishReward: [0, 1000], goldenMaxMembers: [2, 15] } as const;
const date = (value?: string | null) => value ? new Date(value).toLocaleString('ko-KR') : '—';
const copy = (policy: Policy): Policy => ({ ...policy, goldenChancePpm: [...policy.goldenChancePpm] });
function validate(policy: Policy) {
  for (const field of FIELDS) {
    const [min, max] = LIMITS[field.key];
    if (!Number.isInteger(policy[field.key]) || policy[field.key] < min || policy[field.key] > max)
      throw new Error(`${field.label}은 ${min}~${max} 정수여야 합니다.`);
  }
  if (policy.goldenChancePpm.length !== policy.goldenMaxMembers - 1
    || policy.goldenChancePpm.some(value => !Number.isInteger(value) || value < 0 || value > 1_000_000))
    throw new Error('2명부터 인원 상한까지의 확률을 0~1000000 ppm 정수로 입력하세요.');
}
function PolicyValues({ policy }: { policy: Policy }) {
  return <dl className="policy-values">
    {FIELDS.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{policy[field.key].toLocaleString('ko-KR')}</dd></div>)}
    <div><dt>황금 물고기 당첨 확률</dt><dd>{policy.goldenChancePpm.map((ppm, index) => `${index + 2}명 ${ppm.toLocaleString('ko-KR')} ppm (${(ppm / 10000).toLocaleString('ko-KR')}%)`).join(' · ')}</dd></div>
  </dl>;
}
export function FocusPolicyPanel({ session, onDirtyChange, onUnauthorized }: {
  session: Session; onDirtyChange: (dirty: boolean) => void; onUnauthorized: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [items, setItems] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  async function refresh() {
    const [current, drafts] = await Promise.all([
      request<Catalog>('/api/policies/focus'),
      request<{ items: Draft[] }>('/api/policies/focus/drafts'),
    ]);
    setCatalog(current); setItems(drafts.items);
    if (selected) {
      const latest = drafts.items.find(item => item.id === selected.id);
      if (latest && !dirty) select(latest);
    }
  }
  function report(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) { onUnauthorized(); return; }
    setError(cause instanceof Error ? cause.message : '정책을 불러오지 못했습니다.');
  }
  useEffect(() => { void refresh().catch(report); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function run(name: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(name); setError('');
    try { await work(); } catch (cause) { report(cause); }
    finally { setBusy(''); }
  }
  function canLeave() { return !dirty || window.confirm('저장하지 않은 정책 변경이 있습니다. 버릴까요?'); }
  function select(item: Draft) {
    if (!canLeave()) return;
    setSelected(item); setPolicy(copy(item.policy)); setExpectedRevision(item.expectedRevision); setDirty(false);
    void request<{ items: Snapshot[] }>(`/api/policies/focus/drafts/${item.id}/versions`)
      .then(value => setVersions(value.items)).catch(cause => { setVersions([]); report(cause); });
  }
  function newDraft() {
    if (!catalog || !canLeave()) return;
    setSelected(null); setVersions([]); setExpectedRevision(catalog.current.revision);
    setPolicy(copy(catalog.current.policy)); setDirty(false);
  }
  function change(key: keyof Policy, value: number | number[]) {
    setPolicy(previous => previous ? { ...previous, [key]: value } : previous); setDirty(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!policy) return;
    await run('save', async () => {
      validate(policy);
      const item = await request<Draft>(selected
        ? `/api/policies/focus/drafts/${selected.id}` : '/api/policies/focus/drafts', {
        method: selected ? 'PATCH' : 'POST', csrfToken: session.csrfToken,
        body: { policy, expectedRevision, ...(selected ? { revision: selected.revision } : {}) },
      });
      setItems(previous => [item, ...previous.filter(value => value.id !== item.id)]);
      setSelected(item); setPolicy(copy(item.policy)); setDirty(false);
      setVersions((await request<{ items: Snapshot[] }>(`/api/policies/focus/drafts/${item.id}/versions`)).items);
    });
  }
  async function transition(action: 'review' | 'approve' | 'publish' | 'cancel') {
    if (!selected || dirty) return;
    if (action === 'publish' && !window.confirm(`승인된 정책을 ${session.environment} 환경에 적용할까요?`)) return;
    if (action === 'cancel' && !window.confirm('변경안을 철회할까요? 승인된 변경안은 Data 승인 기록도 취소됩니다.')) return;
    await run(action, async () => {
      const item = await request<Draft>(`/api/policies/focus/drafts/${selected.id}/${action}`, {
        method: 'POST', csrfToken: session.csrfToken, body: { revision: selected.revision },
      });
      setSelected(item); setPolicy(copy(item.policy)); setItems(previous => [item, ...previous.filter(value => value.id !== item.id)]);
      if (action === 'publish') {
        const latest = await request<Catalog>('/api/policies/focus');
        setCatalog(latest);
        if (item.status === 'failed' && latest.current.revision !== item.expectedRevision) {
          setExpectedRevision(latest.current.revision);
          setDirty(true);
        }
      }
    });
  }
  const editable = !selected || ['draft', 'review', 'approved', 'failed'].includes(selected.status);
  const canPublish = selected && (selected.status === 'approved' || selected.status === 'uncertain')
    && selected.approvedBy !== session.actor && (!selected.dispatchActor || selected.dispatchActor === session.actor);
  return <div className="policy-workspace">
    <header className="workspace-header"><div><h1>집중·황금 물고기 정책</h1><p>현재 적용값을 확인하고 변경안을 검토·승인한 뒤 적용합니다.</p></div>
      <button className="button primary" disabled={!!busy || !catalog} onClick={newDraft}>현재값으로 변경안 작성</button></header>
    <div className="local-banner"><strong>{session.environment === 'local' ? '로컬 모의 정책' : session.environment === 'dev' ? '개발 환경 · dev' : '운영 환경 · prod'}</strong>
      <span>집중 보상은 새 세션부터, 황금 물고기 확률은 다음 추첨부터 적용됩니다. 기존 세션에는 소급하지 않습니다.</span></div>
    {error && <div className="error-banner" role="alert">{error}<button className="text-button" onClick={() => setError('')}>닫기</button></div>}
    <section className="policy-card"><div className="section-heading"><h2>현재 적용 정책</h2><button className="text-button" disabled={!!busy} onClick={() => void run('refresh', refresh)}>새로고침</button></div>
      {catalog ? <><p>revision {catalog.current.revision} · 적용 {date(catalog.current.publishedAt)}{catalog.local ? ' · 로컬 모의 값' : ''}</p><PolicyValues policy={catalog.current.policy} /></> : <p>정책을 불러오는 중입니다.</p>}</section>
    <div className="policy-grid"><section className="policy-card"><h2>변경안</h2>
      {items.length ? <ul className="item-list">{items.map(item => <li key={item.id}><button className={`item-row ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => select(item)} disabled={!!busy}>
        <strong>{STATUS[item.status]}</strong><span>현재 revision {item.expectedRevision} 기준 · 수정본 {item.revision}</span><time>{date(item.updatedAt)}</time></button></li>)}</ul> : <p>작성한 변경안이 없습니다.</p>}</section>
      <section className="policy-card"><h2>{selected ? `변경안 · ${STATUS[selected.status]}` : '새 변경안'}</h2>
        {policy ? <><form id="policy-form" onSubmit={save}><fieldset disabled={!!busy || !editable}>
          {FIELDS.map(field => <label className="field" key={field.key}><span className="field-label">{field.label}</span><input type="number" step="1" min={LIMITS[field.key][0]}
            max={LIMITS[field.key][1]} value={policy[field.key]} disabled={field.key === 'personalSharePercent'}
            onChange={event => change(field.key, Number(event.target.value))} /><span className="field-hint">{field.hint}</span></label>)}
          <label className="field"><span className="field-label">황금 물고기 확률표 (ppm)</span><textarea className="mono-input" rows={3}
            value={policy.goldenChancePpm.join(', ')} onChange={event => change('goldenChancePpm', event.target.value.split(',').map(value => Number(value.trim())))} />
            <span className="field-hint">2명부터 인원 상한까지 쉼표로 구분합니다. 10000 ppm = 1%.</span></label>
          <label className="field"><span className="field-label">현재 정책 revision</span><input type="number" min="1" step="1" value={expectedRevision}
            onChange={event => { setExpectedRevision(Number(event.target.value)); setDirty(true); }} />
            <span className="field-hint">그 사이 다른 변경이 적용되면 서버가 충돌로 거부합니다.</span></label>
          {catalog && expectedRevision !== catalog.current.revision && <button type="button" className="button secondary" onClick={() => { setExpectedRevision(catalog.current.revision); setDirty(true); }}>현재 revision {catalog.current.revision}으로 바꾸기</button>}
        </fieldset></form><div className="action-buttons">
          {editable && <button className="button secondary" type="submit" form="policy-form" disabled={!!busy || (!!selected && !dirty && selected.status !== 'failed')}>변경안 저장</button>}
          {selected?.status === 'draft' && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('review')}>검토 요청</button>}
          {selected?.status === 'review' && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('approve')}>승인하기</button>}
          {canPublish && <button className="button primary" disabled={!!busy || dirty} onClick={() => void transition('publish')}>{selected?.status === 'uncertain' ? '같은 요청 재시도' : '정책 적용'}</button>}
          {selected && ['draft', 'review', 'approved', 'failed'].includes(selected.status) && <button className="button secondary" disabled={!!busy || dirty} onClick={() => void transition('cancel')}>변경안 철회</button>}
        </div>{selected?.status === 'approved' && selected.approvedBy === session.actor && <p className="callout">승인자와 다른 운영자가 로그인해 적용해야 합니다.</p>}
        {selected?.status === 'uncertain' && <p className="callout">결과를 단정할 수 없습니다. 최초 적용자가 같은 요청으로 재시도해 확인하세요.</p>}
        {selected?.error && <p className="error-message" role="alert">{selected.error}</p>}
        {selected?.receipt && <p className="callout">{selected.receipt.local ? '로컬 모의 적용' : '적용 완료'} · revision {selected.receipt.revision}</p>}
        {selected && <><h3>수정본 이력</h3><ol className="history-list">{versions.map(version => <li key={version.revision}><details><summary>수정본 {version.revision} · digest {version.digest.slice(0, 12)}…</summary><PolicyValues policy={version.policy} /></details></li>)}</ol>
          <h3>검토·승인 기록</h3><ol className="audit-list">{selected.audit.map((event, index) => <li key={`${event.at}-${index}`}>{event.actor} · {event.action} · 수정본 {event.revision} · {date(event.at)}</li>)}</ol></>}</> : <p>현재값을 불러온 뒤 변경안을 작성하세요.</p>}</section></div>
    <section className="policy-card"><h2>{catalog?.local ? '로컬 모의 발행 이력' : '실제 발행 이력'}</h2>{catalog?.history?.length ? <ol className="history-list">{catalog.history.map(entry => <li key={entry.publicationId ?? `legacy-${entry.revision}`}><details><summary>revision {entry.revision} · {date(entry.publishedAt)} · {entry.actor ? `승인 ${entry.approvedBy} / 적용 ${entry.actor}` : '기존 정책 · 발행 원장 도입 전'}</summary><PolicyValues policy={entry.policy} />{entry.approvedDigest && <p>승인 digest {entry.approvedDigest}</p>}</details></li>)}</ol> : <p>표시할 발행 이력이 없습니다.</p>}</section>
  </div>;
}
