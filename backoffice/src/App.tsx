import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, request } from './api';
import type { ContentItem, ContentKind, ContentStatus, Draft, MagazineCard, MagazineSnapshot, Session } from './types';

const ANNOUNCEMENT_KIND = 'ADMIN_ANNOUNCEMENT';
const CHANNELS: { kind: ContentKind; name: string; description: string; icon: string }[] = [
  { kind: 'fcm', name: 'FCM 알림', description: '수신자를 확인하고 운영 공지 알림을 발송합니다.', icon: 'bell' },
  { kind: 'notice', name: '개발자 공지', description: '앱에 표시할 소식과 게시 기간을 관리합니다.', icon: 'notice' },
  { kind: 'magazine', name: '잡지', description: '발행일의 콘텐츠를 검토하고 게시합니다.', icon: 'book' },
];
const STATUS: Record<ContentStatus, string> = { draft: '작성 중', review: '검토 대기', approved: '승인됨', publishing: '처리 중', published: '게시됨', failed: '처리 실패', uncertain: '결과 확인 필요' };
const ACTIONS: Record<string, string> = { create: '초안 생성', update: '내용 수정', edit: '내용 수정', review: '검토 요청', approve: '승인', publish: '발송·게시 요청', published: '요청 완료', failed: '처리 실패' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readableDate = (value?: string) => value ? new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const localDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function emptyDraft(kind: ContentKind): Draft {
  const today = localDate(new Date().toISOString()).slice(0, 10);
  return { kind, title: '', body: '', targetsText: '', fcmKind: ANNOUNCEMENT_KIND, dataText: '{}', issueDate: today, startsAt: localDate(new Date().toISOString()), endsAt: '' };
}
function draftFrom(item: ContentItem): Draft {
  const fcm = item.data?.fcm as { kind?: string } | undefined;
  return { kind: item.kind, title: item.title, body: item.body, targetsText: (item.targets ?? []).join('\n'), fcmKind: fcm?.kind ?? '', dataText: JSON.stringify(item.kind === 'fcm' ? item.data?.payload ?? {} : item.data ?? {}, null, 2), issueDate: item.issueDate ?? '', startsAt: localDate(item.startsAt), endsAt: localDate(item.endsAt) };
}
function objectData(text: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('추가 데이터는 올바른 JSON으로 입력해 주세요.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('추가 데이터는 JSON 객체여야 합니다.');
  return value as Record<string, unknown>;
}
function buildPayload(draft: Draft) {
  if (!draft.title.trim()) throw new Error('관리 제목을 입력해 주세요.');
  let data = objectData(draft.dataText);
  const targets = draft.targetsText.split(/[\s,;]+/).filter(Boolean);
  if (draft.kind === 'fcm') {
    if (targets.length < 1 || targets.length > 100) throw new Error('수신자 UUID를 1명 이상 100명 이하로 입력해 주세요.');
    if (targets.some(id => !UUID.test(id))) throw new Error('수신자 목록에 올바르지 않은 UUID가 있습니다.');
    if (new Set(targets.map(id => id.toLowerCase())).size !== targets.length) throw new Error('중복 수신자를 제거해 주세요.');
    if (draft.fcmKind !== ANNOUNCEMENT_KIND) throw new Error('운영 공지 알림만 작성·검토·발송할 수 있습니다. 새 초안을 작성해 주세요.');
    if (Object.values(data).some(value => typeof value !== 'string')) throw new Error('FCM 추가 데이터 값은 모두 문자열이어야 합니다.');
    data = { fcm: { kind: ANNOUNCEMENT_KIND, locale: 'ko', silent: false, params: {} }, payload: data };
  }
  if (draft.kind === 'notice' && !draft.startsAt) throw new Error('공지 게시 시작 시각을 입력해 주세요.');
  if (draft.endsAt && draft.startsAt && new Date(draft.endsAt) <= new Date(draft.startsAt)) throw new Error('종료 시각은 시작 시각보다 늦어야 합니다.');
  if (draft.kind === 'magazine' && !draft.issueDate) throw new Error('잡지 발행일을 선택해 주세요.');
  if (draft.kind === 'magazine' && data.snapshot) {
    const snapshot = data.snapshot as MagazineSnapshot;
    // 검토한 원본은 서버에 보관한다. 저장 요청에는 불변 스냅샷 참조만 보낸다.
    data.snapshot = { snapshotId: snapshot.snapshotId, digest: snapshot.digest };
  }
  return { kind: draft.kind, title: draft.title.trim(), body: draft.body, targets: draft.kind === 'fcm' ? targets : [], data,
    ...(draft.kind === 'magazine' ? { issueDate: draft.issueDate } : {}),
    ...(draft.kind === 'notice' ? { startsAt: new Date(draft.startsAt).toISOString(), endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null } : {}),
  };
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" /><path d="M10 21h4" /></>,
    notice: <><path d="M5 4h14v17l-4-3H5Z" /><path d="M8 8h8M8 12h6" /></>,
    book: <><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Z" /><path d="M12 5v15" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.notice}</svg>;
}
function Badge({ item }: { item: ContentItem }) { return <span className={`badge status-${item.status}`}>{item.status === 'published' && item.kind === 'fcm' ? '발송 요청됨' : STATUS[item.status]}</span>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === '') return <span className="muted">내용 없음</span>;
  if (typeof value !== 'object') return <span className="prewrap">{String(value)}</span>;
  if (depth > 3) return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) return <div className="snapshot-cells">{value.map((entry, index) => <section className="snapshot-cell" key={index}><ReadableValue value={entry} depth={depth + 1} /></section>)}</div>;
  return <dl className="snapshot-fields">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{({ title: '제목', body: '본문', content: '내용', type: '유형', label: '이름', name: '이름', value: '값', rank: '순위', nickname: '닉네임', focusMinutes: '집중 시간(분)' } as Record<string, string>)[key] ?? key}</dt><dd><ReadableValue value={entry} depth={depth + 1} /></dd></div>)}</dl>;
}
function IslandSummary({ card }: { card: MagazineCard }) {
  return <div className="island-summary"><strong>{card.name}</strong><span>멤버 {card.memberCount}/{card.maxMembers}명 · 건물 {card.buildingCount}개</span><span>하루 평균 집중 {card.averageFocusMinutesPerDay === null ? '집계 전' : `${card.averageFocusMinutesPerDay}분`}</span></div>;
}
function MagazineReview({ snapshot }: { snapshot: MagazineSnapshot }) {
  return <article className="magazine-preview">
    <div className="magazine-masthead"><Icon name="book" /><span>고양이 잡지</span></div>
    <div className="magazine-date">{snapshot.issueDate} · 제 {snapshot.issueNo}호</div>
    <h4>{snapshot.editorial?.note?.type === 'TIP' ? '오늘의 팁' : '편집부의 한마디'}</h4>
    <p className="prewrap">{snapshot.editorial?.note?.type === 'TIP' ? `몽돌 집중 팁 · 번호 ${snapshot.editorial.note.tipNo ?? '미지정'} (앱 문구로 표시)` : snapshot.editorial?.note?.body || '등록된 문구가 없습니다.'}</p>
    <div className="magazine-rule" /><h4>집중 랭킹</h4>
    {snapshot.editorial?.ranking?.length ? <ol className="ranking-list">{snapshot.editorial.ranking.map(entry => <li key={entry.island.islandId}><span className="rank-number">{entry.rank}</span><IslandSummary card={entry.island} /></li>)}</ol> : <p className="field-hint">집계된 랭킹이 없습니다.</p>}
    <div className="magazine-rule" /><h4>새로운 섬</h4>
    {snapshot.editorial?.newIslands?.length ? <div className="new-islands">{snapshot.editorial.newIslands.map(card => <IslandSummary key={card.islandId} card={card} />)}</div> : <p className="field-hint">소개할 새로운 섬이 없습니다.</p>}
    <div className="magazine-rule" /><h4>섬 소식</h4>
    {snapshot.cells?.length ? snapshot.cells.map(cell => {
      const hidden = !cell.card || ['HIDDEN', 'REMOVED'].includes(cell.moderation);
      return <section className={`promotion-cell ${hidden ? 'excluded' : ''}`} key={cell.promotionId}>
        {hidden && <span className="badge">게시 제외 · {!cell.card ? '닫힌 섬' : cell.moderation === 'REMOVED' ? '삭제됨' : '숨김'}</span>}
        {cell.card && <IslandSummary card={cell.card} />}
        <p className="prewrap">{cell.body}</p>
        <span className="field-hint">틀: {cell.layout.frameId} · 스티커 {cell.layout.stickers.length}개 · 테이프 {cell.layout.tape ? '있음' : '없음'}</span>
      </section>;
    }) : <p className="field-hint">이 발행일에 등록된 섬 소식이 없습니다.</p>}
    <p className="field-hint">게시할 데이터의 검토 화면입니다. 앱 화면과 배치는 다를 수 있습니다.</p>
  </article>;
}
function ContentPreview({ draft }: { draft: Draft }) {
  let data: Record<string, unknown> = {};
  try { data = objectData(draft.dataText); } catch { /* 편집 중 JSON 오류는 저장 시 안내한다. */ }
  const snapshot = data.snapshot as MagazineSnapshot | undefined;
  const targets = draft.targetsText.split(/[\s,;]+/).filter(Boolean);
  return <section className="preview-section" aria-labelledby="preview-title">
    <div className="section-heading"><h3 id="preview-title">{draft.kind === 'magazine' ? '게시 내용 검토' : '내용 미리보기'}</h3><span className="muted">{draft.kind === 'fcm' ? '발송 전 확인' : '게시 전 확인'}</span></div>
    {draft.kind === 'magazine' ? snapshot ? <MagazineReview snapshot={snapshot} /> : <div className="preview-empty"><Icon name="book" /><p>발행일과 편집부 문구를 정한 뒤<br />게시 내용을 불러와 주세요.</p></div> : <article className={`message-preview ${draft.kind}`}>
      <div className="message-channel"><Icon name={draft.kind === 'fcm' ? 'bell' : 'notice'} /><span>{draft.kind === 'fcm' ? '앱 알림' : '개발자 공지'}</span></div>
      <h4>{draft.title || '제목을 입력해 주세요'}</h4><p className="prewrap">{draft.body || '본문을 입력하면 이곳에 표시됩니다.'}</p>
    </article>}
    {draft.kind === 'fcm' && <div className="preview-meta"><span>명시한 수신자</span><strong>{targets.length}명</strong><span>알림 종류</span><strong>{draft.fcmKind === ANNOUNCEMENT_KIND ? '운영 공지' : draft.fcmKind || '지원하지 않는 종류'}</strong></div>}
    {draft.kind === 'notice' && <div className="preview-meta"><span>게시 시작</span><strong>{draft.startsAt ? readableDate(draft.startsAt) : '미입력'}</strong><span>게시 종료</span><strong>{draft.endsAt ? readableDate(draft.endsAt) : '종료일 없음'}</strong></div>}
    {draft.kind === 'magazine' && snapshot && <details className="technical-details"><summary>스냅샷 원본 보기</summary><pre className="json-view">{JSON.stringify(snapshot, null, 2)}</pre></details>}
  </section>;
}
function ConfirmDialog({ item, action, busy, error, mode, onClose, onConfirm }: { item: ContentItem; action: string; busy: boolean; error: string; mode: Session['mode']; onClose: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  const verb = action === 'review' ? '검토 요청' : action === 'approve' ? '승인' : item.kind === 'fcm' ? '발송 요청' : '게시';
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === ref.current && !busy) onClose(); }}>
    <div className="dialog-content"><span className="dialog-channel">{CHANNELS.find(channel => channel.kind === item.kind)?.name} · 수정본 {item.revision}</span><h2 id="confirm-title">이 내용으로 {verb}할까요?</h2>
      <p className="dialog-title">{item.title}</p><p className="prewrap dialog-body">{item.body || '본문 없음'}</p>
      <dl className="confirmation-facts"><div><dt>대상</dt><dd>{item.kind === 'fcm' ? `명시한 수신자 ${item.targets.length}명` : item.kind === 'magazine' ? `${item.issueDate} 잡지` : '앱 개발자 공지'}</dd></div>
        {item.kind === 'notice' && <div><dt>게시 기간</dt><dd>{readableDate(item.startsAt)} ~ {item.endsAt ? readableDate(item.endsAt) : '종료일 없음'}</dd></div>}
        {item.approvedBy && <div><dt>승인자</dt><dd>{item.approvedBy}</dd></div>}<div><dt>연결 모드</dt><dd>{mode === 'local' ? '로컬 · 외부 발송/게시 없음' : '서비스 연결'}</dd></div></dl>
      {item.kind === 'fcm' && <details className="technical-details"><summary>수신자 {item.targets.length}명 확인</summary><ul className="recipient-list">{item.targets.map(id => <li key={id}><code>{id}</code></li>)}</ul></details>}
      {item.kind === 'fcm' && <details className="technical-details"><summary>알림 데이터 확인</summary><pre className="json-view">{JSON.stringify(item.data, null, 2)}</pre></details>}
      {item.status === 'uncertain' && <p className="callout">최초 발송과 같은 요청 번호로 재시도합니다. 새로운 발송 요청을 만들지 않습니다.</p>}
      {item.kind === 'magazine' && <ContentPreview draft={draftFrom(item)} />}
      {action === 'publish' && <p className="callout">{item.kind === 'fcm' ? '발송 요청이 접수되어도 실제 기기 수신을 의미하지 않습니다. 발송 게이트가 꺼져 있으면 대기합니다.' : '현재 승인된 수정본을 게시합니다. 게시 이후 내용은 이 초안에서 수정할 수 없습니다.'}</p>}
      {action === 'approve' && <p className="field-hint">승인 후 내용이 바뀌면 다시 검토·승인이 필요합니다.</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <div className="dialog-actions"><button className="button secondary" onClick={onClose} disabled={busy}>돌아가기</button><button className="button primary" onClick={onConfirm} disabled={busy}>{busy ? '처리 중…' : `${verb} 확인`}</button></div>
    </div>
  </dialog>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [channel, setChannel] = useState<ContentKind>('fcm');
  const [items, setItems] = useState<ContentItem[]>([]);
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [modalError, setModalError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [actor, setActor] = useState('');
  const [password, setPassword] = useState('');
  const actionLock = useRef(false);
  const dirty = draft !== null && JSON.stringify(draft) !== baseline;
  const unsupportedFcm = selected?.kind === 'fcm' && (selected.data?.fcm as { kind?: string } | undefined)?.kind !== ANNOUNCEMENT_KIND;
  const editable = !unsupportedFcm && (!selected || ['draft', 'review', 'approved', 'failed'].includes(selected.status));
  const currentChannel = CHANNELS.find(value => value.kind === channel)!;
  const filtered = items.filter(item => item.kind === channel && (filter === 'all' || item.status === filter) && `${item.title} ${item.body}`.toLowerCase().includes(search.toLowerCase()));
  function handleError(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401) { setSession(null); setItems([]); setSelected(null); setDraft(null); }
    setError(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.');
  }
  useEffect(() => {
    const controller = new AbortController();
    request<Session>('/api/session', { signal: controller.signal }).then(setSession).catch(cause => {
      if (cause.name !== 'AbortError' && !(cause instanceof ApiError && cause.status === 401)) handleError(cause);
    }).finally(() => { if (!controller.signal.aborted) setSessionLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setListLoading(true);
    request<{ items: ContentItem[] }>('/api/items', { signal: controller.signal }).then(value => setItems(value.items)).catch(cause => { if (cause.name !== 'AbortError') handleError(cause); }).finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [session]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function showItem(item: ContentItem) {
    setSelected(item); const next = draftFrom(item); setDraft(next); setBaseline(JSON.stringify(next));
    setItems(previous => [item, ...previous.filter(value => value.id !== item.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  async function perform(name: string, work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(name); setError('');
    try { await work(); } catch (cause) { handleError(cause); }
    finally { actionLock.current = false; setBusy(''); }
  }
  function mayLeave() { return !dirty || window.confirm('저장하지 않은 변경 내용이 있습니다. 변경을 버리고 이동할까요?'); }
  function changeChannel(next: ContentKind) {
    if (busy || !mayLeave()) return;
    setChannel(next); setSelected(null); setDraft(null); setSearch(''); setFilter('all'); setError('');
  }
  function createDraft() {
    if (!mayLeave()) return;
    const next = emptyDraft(channel); setSelected(null); setDraft(next); setBaseline(JSON.stringify(next)); setError('');
  }
  function updateDraft(field: keyof Draft, value: string) {
    setDraft(previous => {
      if (!previous) return previous;
      const next = { ...previous, [field]: value };
      if (previous.kind === 'magazine' && (field === 'issueDate' || field === 'body') && previous[field] !== value) {
        try { const data = objectData(previous.dataText); delete data.snapshot; next.dataText = JSON.stringify(data, null, 2); } catch { /* JSON 수정은 기존 값을 보존한다. */ }
      }
      return next;
    });
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!draft || !session) return;
    await perform('save', async () => {
      const payload = buildPayload(draft);
      const item = await request<ContentItem>(selected ? `/api/items/${encodeURIComponent(selected.id)}` : '/api/items', { method: selected ? 'PATCH' : 'POST', csrfToken: session.csrfToken, body: selected ? { ...payload, revision: selected.revision } : payload });
      showItem(item);
    });
  }
  async function previewMagazine() {
    if (!draft || !session) return;
    await perform('preview', async () => {
      if (!draft.issueDate) throw new Error('발행일을 선택해 주세요.');
      const data = objectData(draft.dataText);
      const snapshot = await request<MagazineSnapshot>('/api/magazine/preview', { method: 'POST', csrfToken: session.csrfToken, body: { issueDate: draft.issueDate, ...(draft.body ? { editorialBody: draft.body } : {}) } });
      setDraft(previous => previous ? { ...previous, dataText: JSON.stringify({ ...data, snapshot }, null, 2) } : previous);
    });
  }
  async function transition() {
    if (!selected || !confirmation || !session || actionLock.current || unsupportedFcm) return;
    actionLock.current = true; setBusy('transition'); setModalError('');
    try {
      const item = await request<ContentItem>(`/api/items/${encodeURIComponent(selected.id)}/${confirmation}`, { method: 'POST', csrfToken: session.csrfToken, body: { revision: selected.revision } });
      showItem(item); setConfirmation(null);
    } catch (cause) {
      setModalError(cause instanceof Error ? cause.message : '요청을 처리하지 못했습니다.');
      if (cause instanceof ApiError && cause.status === 401) { setConfirmation(null); handleError(cause); }
    } finally { actionLock.current = false; setBusy(''); }
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    await perform('login', async () => {
      await request('/api/login', { method: 'POST', body: { actor, password } });
      setPassword(''); setSession(await request<Session>('/api/session'));
    });
  }
  if (sessionLoading) return <main className="session-state" aria-busy="true"><span className="brand-mark">c</span><p role="status">운영실을 여는 중…</p></main>;
  if (!session) return <main className="login-layout"><section className="login-intro"><a className="brand" href="/"><span className="brand-mark">c</span><span>콘텐츠 운영실</span></a><div><h1>보내기 전에,<br />한 번 더 확인.</h1><p>앱 알림부터 개발자 공지, 잡지까지.<br />작성한 내용과 수신자를 검토하고 승인합니다.</p></div><p className="login-footnote">검토 → 승인 → 발송·게시</p></section><section className="login-form-wrap"><form className="login-form" onSubmit={login}><h2>운영실 로그인</h2><p className="muted">등록된 운영자 계정으로 접속해 주세요.</p><Field label="운영자 계정"><input name="actor" autoComplete="username" value={actor} onChange={event => setActor(event.target.value)} required disabled={!!busy} /></Field><Field label="비밀번호"><input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={!!busy} /></Field>{error && <p role="alert" className="error-message">{error}</p>}<button className="button primary login-submit" disabled={!!busy}>{busy ? '로그인 중…' : '로그인'}<Icon name="arrow" /></button></form></section></main>;
  return <div className="app-shell">
    <a className="skip-link" href="#workspace">본문으로 이동</a>
    <aside className="sidebar"><a className="brand" href="/" onClick={event => { event.preventDefault(); if (!busy && mayLeave()) { setDraft(null); setSelected(null); } }}><span className="brand-mark">c</span><span>콘텐츠<br />운영실</span></a><div className={`mode-badge ${session.mode}`}><span aria-hidden="true" />{session.mode === 'local' ? '로컬 모드' : '서비스 연결'}</div>
      <nav aria-label="콘텐츠 채널">{CHANNELS.map(value => <button key={value.kind} className={`nav-item ${channel === value.kind ? 'active' : ''}`} aria-current={channel === value.kind ? 'page' : undefined} disabled={!!busy} onClick={() => changeChannel(value.kind)}><Icon name={value.icon} /><span>{value.name}</span><span className="nav-count">{items.filter(item => item.kind === value.kind && item.status === 'review').length || ''}</span></button>)}</nav>
      <div className="sidebar-bottom"><p>{session.mode === 'local' ? '외부 발송·게시 없이 검토 흐름을 확인합니다.' : '승인한 내용만 서비스에 발송·게시합니다.'}</p><div className="actor-row"><span className="avatar" aria-hidden="true">{session.actor.slice(0, 1).toUpperCase()}</span><span>{session.actor}</span></div><button className="logout" disabled={!!busy} onClick={() => { if (mayLeave()) void perform('logout', async () => { await request('/api/logout', { method: 'POST', csrfToken: session.csrfToken }); setSession(null); setItems([]); setDraft(null); setSelected(null); }); }}>로그아웃</button></div>
    </aside>
    <main className="workspace" id="workspace"><header className="workspace-header"><div><h1>{currentChannel.name}</h1><p>{currentChannel.description}</p></div><button className="button primary" onClick={createDraft} disabled={!!busy}><Icon name="plus" />새 초안</button></header>
      <div className="local-banner"><strong>{session.environment === 'local' ? '로컬 작업 공간' : session.environment === 'dev' ? '개발 환경 · dev' : '운영 환경 · prod'}</strong><span>{session.environment === 'local' ? '발송·게시는 로컬 기록으로만 처리됩니다.' : '검토와 발행은 이 환경의 Data·Notification에서만 처리됩니다.'}</span></div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={() => setError('')}>닫기</button></div>}
      <div className="workspace-grid"><section className="item-panel" aria-label={`${currentChannel.name} 목록`}>
        <div className="list-toolbar"><label className="search-label"><span className="sr-only">콘텐츠 검색</span><input type="search" placeholder="제목·본문 검색" value={search} onChange={event => setSearch(event.target.value)} /></label><label><span className="sr-only">상태 필터</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">모든 상태</option>{Object.entries(STATUS).map(([key, label]) => <option value={key} key={key}>{key === 'published' && channel === 'fcm' ? '발송 요청됨' : label}</option>)}</select></label></div>
        <div className="list-caption"><span>{filtered.length}개의 콘텐츠</span><button className="text-button" disabled={!!busy || listLoading} onClick={() => void perform('refresh', async () => { setItems((await request<{ items: ContentItem[] }>('/api/items')).items); })}>새로고침</button></div>
        {listLoading ? <div className="list-loading" role="status" aria-busy="true"><span>목록을 불러오는 중…</span>{[1, 2, 3].map(index => <div className="skeleton-row" key={index} />)}</div> : filtered.length ? <ul className="item-list">{filtered.map(item => <li key={item.id}><button className={`item-row ${selected?.id === item.id ? 'selected' : ''}`} aria-current={selected?.id === item.id ? 'true' : undefined} disabled={!!busy} onClick={() => { if (mayLeave()) void perform('select', async () => showItem(await request<ContentItem>(`/api/items/${encodeURIComponent(item.id)}`))); }}><div className="item-row-top"><Badge item={item} /><span>v{item.revision}</span></div><strong>{item.title}</strong><p>{item.body || (item.kind === 'magazine' ? `${item.issueDate} 발행` : '본문 없음')}</p><time dateTime={item.updatedAt}>{readableDate(item.updatedAt)}</time></button></li>)}</ul> : <div className="list-empty"><Icon name={currentChannel.icon} /><h2>{search || filter !== 'all' ? '조건에 맞는 콘텐츠가 없어요' : '아직 작성한 콘텐츠가 없어요'}</h2><p>{search || filter !== 'all' ? '검색어나 상태 필터를 바꿔보세요.' : '새 초안을 작성하고 검토를 시작하세요.'}</p>{!search && filter === 'all' && <button className="button secondary" onClick={createDraft} disabled={!!busy}>초안 작성</button>}</div>}
      </section>
      <section className="editor-panel" aria-label="콘텐츠 편집 및 검토" aria-busy={busy === 'select'}>{draft ? <>
        <header className="editor-header"><div className="editor-heading"><h2>{selected ? '콘텐츠 상세' : '새 초안 작성'}</h2>{selected ? <Badge item={selected} /> : <span className="badge">저장 전</span>}</div><span className="save-state" role="status">{busy === 'save' ? '저장 중…' : dirty ? '저장하지 않은 변경' : selected ? `수정본 ${selected.revision} · ${readableDate(selected.updatedAt)}` : '초안을 저장해 검토를 시작하세요'}</span></header>
        {unsupportedFcm && <p className="receipt-section callout">이 항목은 운영 공지 알림이 아니므로 읽기만 가능합니다. 검토·승인·발송하려면 새 운영 공지 초안을 작성해 주세요.</p>}
        <div className="editor-columns"><form id="content-form" className="editor-form" onSubmit={save}><fieldset disabled={!!busy || !editable}>
          <Field label={draft.kind === 'magazine' ? '관리 제목' : '제목'} hint={draft.kind === 'magazine' ? '운영실에서 구분하는 제목입니다.' : undefined}><input value={draft.title} onChange={event => updateDraft('title', event.target.value)} maxLength={120} required /></Field>
          <Field label={draft.kind === 'magazine' ? '편집부의 한마디' : '본문'} hint={draft.kind === 'magazine' ? `${draft.body.length}/80자 · 변경하면 게시 내용을 다시 불러와야 합니다.` : '미리보기에서 줄바꿈과 문구를 확인하세요.'}><textarea rows={draft.kind === 'magazine' ? 3 : 5} value={draft.body} onChange={event => updateDraft('body', event.target.value)} maxLength={draft.kind === 'magazine' ? 80 : 10000} /></Field>
          {draft.kind === 'fcm' && <><Field label="수신자 UUID" hint="한 줄에 한 명 또는 쉼표로 구분합니다. 1~100명, 중복 불가."><textarea className="mono-input" rows={4} value={draft.targetsText} onChange={event => updateDraft('targetsText', event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} required /></Field><p className="field-hint">운영 공지 알림으로 발송합니다. 한국어 표시 알림만 지원하며, 다른 서비스 알림의 종류·매개변수는 사용하지 않습니다.</p></>}
          {draft.kind === 'notice' && <div className="date-fields"><Field label="게시 시작" hint="현재 브라우저의 현지 시각 기준"><input type="datetime-local" value={draft.startsAt} onChange={event => updateDraft('startsAt', event.target.value)} required /></Field><Field label="게시 종료" hint="비워두면 종료일 없이 게시"><input type="datetime-local" value={draft.endsAt} onChange={event => updateDraft('endsAt', event.target.value)} /></Field></div>}
          {draft.kind === 'magazine' && <><Field label="발행일" hint="미래 날짜도 초안으로 미리 저장할 수 있습니다."><input type="date" value={draft.issueDate} onChange={event => updateDraft('issueDate', event.target.value)} required /></Field><button type="button" className="button secondary preview-button" onClick={() => void previewMagazine()} disabled={!!busy}>{busy === 'preview' ? '게시 내용 불러오는 중…' : '게시 내용 불러오기'}<Icon name="arrow" /></button><p className="field-hint">최종 게시 내용은 발행일 당일 오전 7시(KST) 이후에 불러올 수 있습니다. 내용을 확인하고 저장한 뒤 검토·승인해 주세요.</p></>}
          {draft.kind !== 'magazine' && <details className="advanced-fields"><summary>추가 데이터 설정</summary><Field label={draft.kind === 'fcm' ? 'FCM 추가 데이터 (JSON)' : '추가 데이터 (JSON)'} hint={draft.kind === 'fcm' ? '앱에 전달할 추가 데이터만 입력합니다. 모든 값은 문자열이어야 합니다. 필요하지 않으면 {}로 두세요.' : undefined}><textarea className="mono-input" rows={8} value={draft.dataText} onChange={event => updateDraft('dataText', event.target.value)} spellCheck={false} /></Field></details>}
        </fieldset></form><div className="preview-column"><ContentPreview draft={draft} /></div></div>
        <div className="editor-actions"><div className="action-explanation">{unsupportedFcm ? '운영 공지 알림만 검토·승인·발송할 수 있습니다.' : !editable ? '처리된 콘텐츠는 수정할 수 없습니다.' : dirty && selected?.status === 'approved' ? '수정하면 승인이 해제됩니다.' : dirty ? '변경 내용을 저장한 뒤 검토를 요청하세요.' : selected?.status === 'review' ? '내용과 대상을 확인한 뒤 승인하세요.' : selected?.status === 'approved' ? '승인한 수정본을 발송·게시할 수 있습니다.' : '초안 저장 → 검토 요청 → 승인 → 발송·게시'}</div><div className="action-buttons">
          {editable && <button className="button secondary" type="submit" form="content-form" disabled={!!busy || (!!selected && !dirty && selected.status !== 'failed')}>{busy === 'save' ? '저장 중…' : selected?.status === 'failed' ? '초안 다시 저장' : '초안 저장'}</button>}
          {!unsupportedFcm && selected?.status === 'draft' && <button className="button primary" disabled={!!busy || dirty} onClick={() => { setModalError(''); setConfirmation('review'); }}>검토 요청</button>}
          {!unsupportedFcm && selected?.status === 'review' && <button className="button primary" disabled={!!busy || dirty} onClick={() => { setModalError(''); setConfirmation('approve'); }}>승인하기</button>}
          {!unsupportedFcm && selected?.status === 'uncertain' && (!selected.dispatchActor || selected.dispatchActor === session.actor) && <button className="button primary" disabled={!!busy} onClick={() => { setModalError(''); setConfirmation('publish'); }}>같은 요청 재시도</button>}
          {!unsupportedFcm && selected?.status === 'approved' && <button className="button primary" disabled={!!busy || dirty} onClick={() => { setModalError(''); setConfirmation('publish'); }}>{selected.kind === 'fcm' ? '발송 요청' : '게시하기'}<Icon name="arrow" /></button>}
        </div></div>
        {selected?.error && <div className="receipt-section error-message" role="alert">{selected.error}</div>}
        {selected?.receipt && <section className="receipt-section"><h3>{selected.kind === 'fcm' ? '발송 요청 결과' : '게시 처리 결과'}</h3>{selected.kind === 'fcm' && <p>{selected.receipt.dispatchEnabled === false ? '발송 게이트가 꺼져 있어 대기 중입니다. 실제 발송·수신은 완료되지 않았습니다.' : '발송 요청 접수 기록입니다. 기기 수신 완료를 의미하지 않습니다.'}</p>}
          {selected.receipt.local === true && <p>로컬 모의 처리입니다. 실제 발송·게시는 하지 않았습니다.</p>}
          {selected.kind === 'fcm' && typeof selected.receipt.recipientCount === 'number' && <p>요청 수신자 {selected.receipt.recipientCount}명</p>}
          <details className="technical-details"><summary>처리 기록 자세히 보기</summary><ReadableValue value={selected.receipt} /></details></section>}
        {selected?.status === 'uncertain' && <p className="receipt-section callout">처리 결과가 확정되지 않았습니다. 최초 요청자는 같은 요청으로 결과를 다시 확인할 수 있습니다. 새 초안을 만들어 중복 발송하지 마세요.</p>}
        {selected && <section className="audit-section"><div className="section-heading"><h3>변경 이력</h3><span className="muted">{selected.audit?.length ?? 0}건</span></div>{selected.audit?.length ? <ol className="audit-list">{[...selected.audit].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><span className="audit-dot" aria-hidden="true" /><div><strong>{ACTIONS[entry.action] ?? entry.action}</strong><span>{entry.actor} · 수정본 {entry.revision}</span></div><time dateTime={entry.at}>{readableDate(entry.at)}</time></li>)}</ol> : <p className="muted">기록된 변경 이력이 없습니다.</p>}</section>}
      </> : <div className="editor-empty"><div className="empty-symbol"><Icon name={currentChannel.icon} /></div><h2>보낼 내용을 함께 확인하세요</h2><p>목록에서 콘텐츠를 선택하거나<br />새 초안을 작성해 주세요.</p><div className="empty-flow"><span>작성</span><span aria-hidden="true">→</span><span>검토</span><span aria-hidden="true">→</span><span>승인</span><span aria-hidden="true">→</span><span>{channel === 'fcm' ? '발송 요청' : '게시'}</span></div></div>}</section></div>
    </main>
    {confirmation && selected && <ConfirmDialog item={selected} action={confirmation} busy={!!busy} error={modalError} mode={session.mode} onClose={() => setConfirmation(null)} onConfirm={() => void transition()} />}
  </div>;
}
