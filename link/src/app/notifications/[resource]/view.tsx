'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import './console.css';

const labels: Record<string, string> = { jobs: '예약 작업', templates: '알림 템플릿', deeplinks: '이동 경로', deliveries: '발송 이력' };
type Row = Record<string, unknown>;
type Session = { actor: string; sudo: boolean; csrfToken: string };

export default function Console({ resource }: { resource: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState('');
  const [environment, setEnvironment] = useState('dev');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [draft, setDraft] = useState('{}');
  const [notice, setNotice] = useState('');

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message ?? data.code ?? '요청을 처리하지 못했습니다.');
    return data;
  }, []);

  const fetchRows = useCallback(async (next?: string) => {
    const query = new URLSearchParams({ environment, limit: '50' });
    if (next) query.set('cursor', next);
    const data = await request(`/console/notification/${resource}?${query}`);
    const items: Row[] = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw new Error('목록 응답을 확인하지 못했습니다.');
    return { items, nextCursor: data.nextCursor ?? null };
  }, [environment, request, resource]);

  const load = useCallback(async (next?: string) => {
    const data = await fetchRows(next);
    setRows(previous => next ? [...previous, ...data.items] : data.items);
    setCursor(data.nextCursor);
  }, [fetchRows]);

  useEffect(() => { request('/console/session').then(setSession).catch(() => setSession(null)); }, [request]);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchRows().then(data => {
      if (!cancelled) { setRows(data.items); setCursor(data.nextCursor); setError(''); }
    }).catch(cause => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [fetchRows, session]);

  async function authenticate(sudo = false) {
    setBusy(true); setError('');
    try {
      await request('/console/session', { method: 'POST', headers: { 'X-CSRF-Token': session?.csrfToken ?? '' },
        body: JSON.stringify({ password, action: sudo ? 'sudo' : 'login' }) });
      setSession(await request('/console/session')); setPassword('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function write(action?: string) {
    if (!selected || !session) return;
    const id = String(selected.id ?? selected.key ?? selected.kind ?? '');
    if (!id) { setError('수정할 항목의 식별자가 없습니다.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const parsed = JSON.parse(draft);
      const result = await request(`/console/notification/${resource}/${encodeURIComponent(id)}${action ? `/${action}` : ''}?environment=${environment}`,
        { method: action ? 'POST' : 'PUT', headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(parsed) });
      setNotice(action === 'preview' ? JSON.stringify(result, null, 2) : '반영했습니다.');
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <main className="console">
    <header><span className="brand">gromo <small>알림 관리</small></span>{session && <button onClick={async () => {
      await request('/console/session', { method: 'DELETE', headers: { 'X-CSRF-Token': session.csrfToken } });
      setSession(null); setRows([]);
    }}>로그아웃</button>}</header>
    {!session ? <form className="login" onSubmit={event => { event.preventDefault(); void authenticate(); }}>
      <h1>팀 계정으로 로그인</h1><p>배정받은 비밀번호를 입력해 주세요.</p>
      <label>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
      <button className="primary" disabled={busy}>로그인</button>
    </form> : <>
      <nav>{Object.entries(labels).map(([key, label]) => <Link key={key} href={`/notifications/${key}`} aria-current={key === resource ? 'page' : undefined}>{label}</Link>)}</nav>
      <section className="heading"><div><p className="eyebrow">{session.actor}</p><h1>{labels[resource]}</h1></div>
        <label>대상 환경<select value={environment} onChange={event => { setEnvironment(event.target.value); setSelected(null); setNotice(''); }}><option value="dev">개발</option><option value="prod">운영</option></select></label>
      </section>
      {environment === 'prod' && <p className="environment">운영 알림을 관리하고 있습니다.</p>}
      <div className="workspace"><section className="list">
        <button onClick={() => void load().catch(cause => setError(cause.message))}>새로고침</button>
        <table><thead><tr><th>항목</th><th>상태 / 언어</th><th>최근 변경</th></tr></thead><tbody>
          {rows.map((row, index) => <tr key={String(row.id ?? row.key ?? index)} onClick={() => { setSelected(row); setDraft(JSON.stringify(row, null, 2)); setNotice(''); }}>
            <td><button>{String(row.name ?? row.kind ?? row.key ?? row.id)}</button></td>
            <td>{String(row.status ?? row.locale ?? (row.enabled === undefined ? '—' : row.enabled ? '사용' : '중지'))}</td>
            <td>{String(row.updatedAt ?? row.createdAt ?? '—')}</td></tr>)}
        </tbody></table>{rows.length === 0 && <p>표시할 항목이 없습니다.</p>}
        {cursor && <button onClick={() => void load(cursor).catch(cause => setError(cause.message))}>더 보기</button>}
      </section><aside>
        {selected ? <><h2>항목 상세</h2><textarea aria-label="항목 설정" rows={18} value={draft} readOnly={resource === 'deliveries'} onChange={event => setDraft(event.target.value)} />
          {!session.sudo ? <form onSubmit={event => { event.preventDefault(); void authenticate(true); }}>
            <label>변경 권한 비밀번호<input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" /></label>
            <button disabled={busy}>10분간 변경 허용</button></form> : <div className="actions">
            {resource !== 'deliveries' && <button className="primary" disabled={busy} onClick={() => void write()}>저장</button>}
            {resource === 'templates' && <><button disabled={busy} onClick={() => void write('preview')}>미리보기</button><button disabled={busy} onClick={() => void write('test')}>테스트 발송</button></>}
            {resource === 'deliveries' && <button disabled={busy} onClick={() => void write('resend')}>재전송 요청</button>}
          </div>}</> : <p>목록에서 항목을 선택해 주세요.</p>}
      </aside></div>
    </>}
    {error && <p role="alert" className="error">{error}</p>}{notice && <pre role="status" className="notice">{notice}</pre>}
  </main>;
}
