import { useEffect, useMemo, useState } from 'react';
import { loadCatalog, isRunnable, short, type Catalog, type EndpointEntry } from '../openapi';
import { dispatchRun } from '../api/github';

// 단일 API 부하 모드 (GROMO-750) — openapi 카탈로그에서 실행 가능한 엔드포인트를 다중선택(또는 전체선택)해
// 프로파일(load/stress/spike)로 배치 디스패치. run 은 concurrency 로 직렬화되므로 "전체 선택 = 새벽 통째 실행".
const PROFILES = [
  { value: 'smoke', label: 'smoke — 빠른 검증 (5rps·1분)' },
  { value: 'load', label: 'load — 목표 부하 (50rps·10분)' },
  { value: 'stress', label: 'stress — 한계 탐색 (계단)' },
  { value: 'spike', label: 'spike — 급증 (10→300)' },
];
const METHOD_CLASS: Record<string, string> = {
  GET: 'm-get',
  POST: 'm-post',
  PATCH: 'm-patch',
  PUT: 'm-put',
  DELETE: 'm-delete',
};
const keyOf = (e: EndpointEntry) => `${e.method} ${e.path}`;

export function SingleApiMode({ onDispatched }: { onDispatched: () => void }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [err, setErr] = useState('');
  const [profile, setProfile] = useState('load');
  const [rps, setRps] = useState(''); // 총 arrival rate override(빈값=프로파일 기본). 선택분에 분산(모델 A)
  const [spots, setSpots] = useState('1'); // loadgen spot VM 수(고rps 분산 생성)
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openTags, setOpenTags] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    loadCatalog()
      .then((c) => {
        setCat(c);
        setOpenTags(new Set(c.groups.filter((g) => g.endpoints.some(isRunnable)).map((g) => g.tag)));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const runnable = useMemo(() => (cat ? cat.endpoints.filter(isRunnable) : []), [cat]);
  const toggle = (k: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const selectAll = () => setSel(new Set(runnable.map(keyOf)));
  const clearAll = () => setSel(new Set());
  const toggleTag = (tag: string, open: boolean) =>
    setOpenTags((prev) => {
      const n = new Set(prev);
      if (open) n.add(tag);
      else n.delete(tag);
      return n;
    });

  // 선택 엔드포인트를 한 run 에서 병렬 부하 — 총 rate 를 선택분에 분산(모델 A). loadgen 1사이클.
  const runBatch = async () => {
    if (!cat || sel.size === 0 || running) return;
    setRunning(true);
    const picked = runnable.filter((e) => sel.has(keyOf(e)));
    const recipes = picked.map((e) => e.recipe).filter((r): r is string => !!r);
    try {
      await dispatchRun(profile, 'matrix/_generic.js', false, {
        recipes: recipes.join(','),
        rate: rps.trim() || undefined,
        spots: spots.trim() || undefined,
      });
      const opts = [profile, rps.trim() && `${rps.trim()}rps`, spots.trim() !== '1' && `spot ${spots.trim()}`]
        .filter(Boolean)
        .join(' · ');
      setProgress(`디스패치 완료 — ${recipes.length}개 엔드포인트 병렬 부하 (${opts}). 히스토리에 나타납니다.`);
    } catch (e) {
      setProgress(`실패: ${String(e)} (PAT 권한: actions rw)`);
    }
    setRunning(false);
    setTimeout(onDispatched, 3000);
  };

  return (
    <section className="card">
      <h2>단일 API 부하 — 대상 선택</h2>
      {err && <p className="err">{err}</p>}
      {!cat && !err && <p className="muted">openapi 카탈로그 로딩…</p>}
      {cat && (
        <>
          <p className="sub">
            openapi <b>{cat.total}</b>개 중 실행 가능 <b className="ok">{runnable.length}</b>(스크립트{' '}
            {cat.scriptCount} · recipe {cat.recipeCount}) · gap {cat.gapCount}. 특정 API만 고르거나 전체
            선택해 <b>{profile}</b> 부하를 한 run 에서 병렬 실행(총 rate 를 선택분에 분산).
          </p>

          <div className="form-row" style={{ marginBottom: 10 }}>
            <label>
              프로파일
              <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={running}>
                {PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              총 rps (빈값=프로파일 기본)
              <input
                type="text"
                className="short"
                value={rps}
                placeholder="기본"
                inputMode="numeric"
                disabled={running}
                onChange={(e) => setRps(e.target.value)}
              />
            </label>
            <label>
              loadgen spot 수
              <input
                type="text"
                className="short"
                value={spots}
                placeholder="1"
                inputMode="numeric"
                disabled={running}
                onChange={(e) => setSpots(e.target.value)}
              />
            </label>
          </div>

          <div className="batch-bar">
            <button className="ghost" onClick={selectAll} disabled={running}>
              전체 선택 ({runnable.length})
            </button>
            <button className="ghost" onClick={clearAll} disabled={running || sel.size === 0}>
              해제
            </button>
            <span className="muted">선택 {sel.size}개</span>
            <span style={{ flex: 1 }} />
            <button onClick={runBatch} disabled={running || sel.size === 0}>
              {running ? '디스패치 중…' : `선택 ${sel.size}개 실행 ▶`}
            </button>
          </div>
          {progress && <p className="ok" style={{ marginTop: 8 }}>{progress}</p>}

          {cat.groups.map((g) => {
            const runnableInGroup = g.endpoints.filter(isRunnable);
            return (
              <details
                className="grp"
                key={g.tag}
                open={openTags.has(g.tag)}
                onToggle={(ev) => toggleTag(g.tag, (ev.currentTarget as HTMLDetailsElement).open)}
              >
                <summary>
                  {g.tag} <span className="chip cat">{g.endpoints.length}</span>
                  {runnableInGroup.length > 0 && (
                    <span
                      className="link"
                      style={{ marginLeft: 'auto', fontSize: 12 }}
                      onClick={(e) => {
                        e.preventDefault();
                        if (running) return;
                        const keys = runnableInGroup.map(keyOf);
                        const allSel = keys.every((k) => sel.has(k));
                        setSel((prev) => {
                          const n = new Set(prev);
                          keys.forEach((k) => (allSel ? n.delete(k) : n.add(k)));
                          return n;
                        });
                      }}
                    >
                      그룹 {runnableInGroup.every((e) => sel.has(keyOf(e))) ? '해제' : '선택'}
                    </span>
                  )}
                </summary>
                {g.endpoints.map((e) => {
                  const k = keyOf(e);
                  const run = isRunnable(e);
                  return (
                    <label className={`ep ${run ? 'clickable' : 'disabled'}`} key={k}>
                      <input
                        type="checkbox"
                        checked={sel.has(k)}
                        disabled={!run || running}
                        onChange={() => toggle(k)}
                      />
                      <span className={`b method ${METHOD_CLASS[e.method] ?? ''}`}>{e.method}</span>
                      <span className="path">{short(e.path)}</span>
                      <span className="desc">{e.summary}</span>
                      <span className="tail">
                        {e.kind === 'script' && <span className="b run">스크립트</span>}
                        {e.kind === 'recipe' && <span className="b blue">recipe</span>}
                        {e.kind === 'gap' && <span className="b need">gap</span>}
                      </span>
                    </label>
                  );
                })}
              </details>
            );
          })}
        </>
      )}
    </section>
  );
}
