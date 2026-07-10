import { useEffect, useState } from 'react';
import { loadCatalog, type Catalog, type EndpointEntry } from '../openapi';

// method → 색상 클래스 (style.css)
const METHOD_CLASS: Record<string, string> = {
  GET: 'm-get',
  POST: 'm-post',
  PATCH: 'm-patch',
  PUT: 'm-put',
  DELETE: 'm-delete',
};

// openapi.json 스냅샷에서 파생한 타겟 카탈로그 (GROMO-750).
// 전체 API 표면을 컨트롤러별로 자동 목록화 — "스크립트 있음" 만 지금 트리거 타겟으로 선택 가능.
export function TargetCatalog({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (target: string) => void;
}) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState('');
  const [openTags, setOpenTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadCatalog()
      .then((c) => {
        setCat(c);
        // 스크립트 있는 그룹은 기본 펼침. controlled — 이후 사용자 토글도 그대로 유지.
        setOpenTags(
          new Set(c.groups.filter((g) => g.endpoints.some((e) => e.kind === 'script')).map((g) => g.tag)),
        );
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const toggleTag = (tag: string, isOpen: boolean) =>
    setOpenTags((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(tag);
      else next.delete(tag);
      return next;
    });

  return (
    <section className="card">
      <h2>타겟 카탈로그 (OpenAPI)</h2>
      {err && <p className="err">{err}</p>}
      {!cat && !err && <p className="muted">openapi.json 로딩…</p>}
      {cat && (
        <>
          <p className="sub">
            <code>openapi.json</code>(springdoc 스냅샷 · 전체 <b>{cat.total}</b>)에서 컨트롤러별 자동 목록화.{' '}
            <b className="ok">스크립트 있음 {cat.scriptCount}</b> · 실행가능(제네릭 러너 후속){' '}
            {cat.runnableCount} · 레시피 필요 {cat.recipeCount}. 손으로 4개 하드코딩하던 걸 대체.
          </p>
          <div className="legend">
            <span>
              <span className="b run">스크립트 있음</span> 지금 트리거로 실행(클릭)
            </span>
            <span>
              <span className="b blue">실행가능</span> GET·무필수 — 제네릭 러너 후속
            </span>
            <span>
              <span className="b need">레시피 필요</span> 파라미터·바디 필요
            </span>
          </div>
          {cat.groups.map((g) => (
            <details
              className="grp"
              key={g.tag}
              open={openTags.has(g.tag)}
              onToggle={(ev) => toggleTag(g.tag, (ev.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>
                {g.tag} <span className="chip cat">{g.endpoints.length}</span>
              </summary>
              {g.endpoints.map((e) => (
                <EndpointRow key={`${e.method} ${e.path}`} e={e} selected={selected} onPick={onPick} />
              ))}
            </details>
          ))}
        </>
      )}
    </section>
  );
}

function EndpointRow({
  e,
  selected,
  onPick,
}: {
  e: EndpointEntry;
  selected: string;
  onPick: (target: string) => void;
}) {
  const clickable = e.kind === 'script';
  const runTarget = clickable ? e.target : undefined;
  const isSel = runTarget === selected;
  return (
    <div
      className={`ep${clickable ? ' clickable' : ' disabled'}${isSel ? ' sel' : ''}`}
      onClick={runTarget ? () => onPick(runTarget) : undefined}
    >
      <span className={`b method ${METHOD_CLASS[e.method] ?? ''}`}>{e.method}</span>
      <span className="path">{e.path.replace(/^\/api\/v1/, '')}</span>
      <span className="desc">{e.summary}</span>
      <span className="tail">
        {e.requiredParams.length > 0 && <span className="req">{e.requiredParams.join('·')}</span>}
        {e.hasBody && <span className="req">body</span>}
        {e.kind === 'script' && <span className="b run">{isSel ? '선택됨' : '실행 ▶'}</span>}
        {e.kind === 'runnable' && <span className="b blue">실행가능</span>}
        {e.kind === 'recipe' && <span className="b need">레시피 필요</span>}
      </span>
    </div>
  );
}
