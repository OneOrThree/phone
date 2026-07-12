import { useEffect, useMemo, useState } from 'react';
import { loadCatalog, isRunnable, short, type Catalog, type EndpointEntry } from '../openapi';
import { dispatchRun } from '../api/github';
import { paramsFor, defaultValues, validateParam, toOverrides } from '../loadparams';

// 단일 API 부하 모드 (GROMO-750) — openapi 카탈로그에서 실행 가능한 엔드포인트를 다중선택(또는 전체선택)해
// 프로파일(load/stress/spike)로 배치 디스패치. run 은 concurrency 로 직렬화되므로 "전체 선택 = 새벽 통째 실행".
// 프로파일을 고르면 그 프로파일이 실제 읽는 파라미터만 우측에 뜨고 기본값이 프리필된다(loadparams.ts).
const PROFILES = [
  { value: 'smoke', label: 'smoke — 빠른 검증 (5rps·1분)' },
  { value: 'load', label: 'load — 목표 부하 (50rps·10분)' },
  { value: 'stress', label: 'stress — 한계 탐색 (계단 100→400)' },
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
  const [params, setParams] = useState<Record<string, string>>(defaultValues('load')); // 프로파일별 부하 파라미터(프리필)
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
  const fields = paramsFor(profile);
  // 프로파일 전환 시 그 프로파일의 파라미터 기본값으로 프리필(우측 입력이 프로파일에 맞게 바뀜)
  const onProfile = (v: string) => {
    setProfile(v);
    setParams(defaultValues(v));
  };
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
    const picked = runnable.filter((e) => sel.has(keyOf(e)));
    const recipes = picked.map((e) => e.recipe).filter((r): r is string => !!r);
    if (recipes.length === 0) {
      setProgress('실패: 선택 항목에 실행 가능한 recipe 가 없습니다.');
      return;
    }
    // 프로파일 파라미터 검증(서버 run.sh 가드 전 조기 실패 UX)
    for (const f of fields) {
      const msg = validateParam(f, params[f.key] ?? '');
      if (msg) {
        setProgress(`실패: ${msg}`);
        return;
      }
    }
    const spotsVal = spots.trim();
    if (spotsVal && !(/^\d+$/.test(spotsVal) && +spotsVal >= 1 && +spotsVal <= 6)) {
      setProgress('실패: loadgen spot 수는 1~6 정수여야 합니다 (GCP vCPU 쿼터 상한 6).');
      return;
    }
    setRunning(true);
    try {
      await dispatchRun(profile, 'matrix/_generic.js', false, {
        recipes: recipes.join(','),
        spots: spotsVal || undefined,
        ...toOverrides(profile, params),
      });
      const opts = [profile, ...fields.map((f) => `${f.label} ${params[f.key]}`)].join(' · ');
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
              <select value={profile} onChange={(e) => onProfile(e.target.value)} disabled={running}>
                {PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {fields.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type="text"
                  className="short"
                  value={params[f.key] ?? ''}
                  inputMode={f.kind === 'rps' ? 'numeric' : 'text'}
                  disabled={running}
                  onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              </label>
            ))}
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
          {fields.some((f) => f.note) && (
            <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>
              {fields
                .filter((f) => f.note)
                .map((f) => `※ ${f.label}: ${f.note}`)
                .join('   ')}
            </p>
          )}
          <p className="muted" style={{ fontSize: 12, margin: '0 0 12px', lineHeight: 1.7 }}>
            <b>rps</b> = 초당 요청 수(총량, 선택 API에 분산). 프로파일을 고르면 기본값이 채워지고 직접 수정 가능.
            constant(smoke/load)은 총 rps·시간, 계단형(stress/spike)은 시작/피크 rps 로 커스텀합니다.
            <br />
            <b>spot</b> = 부하를 만드는 loadgen VM 수(1~6). 총 rate 를 N대에 균등 분산하고 CPU 가드는 VM별로 평가.
            상한 6 — GCP 전역 32vCPU 에서 SUT·obs·러너 제외 예산(n2-highcpu-4 6대=24vCPU).
          </p>

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
