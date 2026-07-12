// GitHub API 클라이언트 — 대시보드의 유일한 백엔드.
// 트리거: workflow_dispatch / 히스토리: workflow runs / 판정·diff: loadtest-reports 브랜치 Contents API
// 인증: fine-grained PAT(actions rw + contents rw — dispatch 와 리포트 조회) 1회 입력 → localStorage.
const REPO = 'OneOrThree/phone';
const WORKFLOW = 'loadtest.yml';
const REPORTS_BRANCH = 'loadtest-reports';
const API = 'https://api.github.com';
const PAT_KEY = 'loadtest_pat';

export const getToken = () => localStorage.getItem(PAT_KEY) ?? '';
export const setToken = (t: string) => localStorage.setItem(PAT_KEY, t.trim());

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  // 204(dispatch 성공) 는 본문 없음
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface WorkflowRun {
  id: number;
  run_number: number;
  display_title: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface Verdict {
  verdict: 'PASS' | 'FAIL' | 'INVALID';
  reasons: string[];
  baseline: string | null;
  diff: {
    p95: { base: number; cur: number; pct: number | null };
    p99: { base: number; cur: number; pct: number | null };
    errRate: { base: number; cur: number };
    dropped: number;
  } | null;
  meta: { sha: string; profile: string; target: string; startedAt: string };
}

// 고급 설정(expert) override — 빈 값은 생략해 워크플로우 default(=프로파일 기본)로 폴백.
// rate 계열(rate·duration·startRate·baseRate·spikeRate)은 workflow_dispatch 10-input 제한 때문에
// 단일 `params` 입력(KEY=VALUE;…)으로 합쳐 보낸다(run.sh 가 파싱·검증). 프로파일별로 쓰는 것만 채움.
export interface RunOverrides {
  rate?: string; // RATE — smoke/load(constant) 총 rps
  duration?: string; // DURATION — smoke/load 지속시간(예: 5m)
  startRate?: string; // START_RATE — stress 시작 rps
  baseRate?: string; // BASE_RATE — spike 시작(평시) rps
  spikeRate?: string; // SPIKE_RATE — spike 끝(피크) rps
  scale?: string;
  recipes?: string; // 제네릭 러너 — TARGET=matrix/_generic.js 일 때 콤마구분 엔드포인트 목록(총 rate 분산)
  spots?: string; // loadgen spot VM 수(고rps 분산 생성)
  scenario?: string; // 유저 시나리오 — TARGET=scenarios/_generic.js 일 때 def id
}

// rate 계열 override → 단일 params 문자열 "RATE=..;DURATION=..;.." (빈값 제외). KEY 는 k6 __ENV 이름.
const buildParams = (o: RunOverrides): string =>
  [
    o.rate && `RATE=${o.rate}`,
    o.duration && `DURATION=${o.duration}`,
    o.startRate && `START_RATE=${o.startRate}`,
    o.baseRate && `BASE_RATE=${o.baseRate}`,
    o.spikeRate && `SPIKE_RATE=${o.spikeRate}`,
  ]
    .filter(Boolean)
    .join(';');

export const dispatchRun = (
  profile: string,
  target: string,
  updateBaseline: boolean,
  overrides: RunOverrides = {},
) => {
  const inputs: Record<string, string | boolean> = {
    profile,
    target,
    update_baseline: updateBaseline,
  };
  const params = buildParams(overrides);
  if (params) inputs.params = params;
  if (overrides.scale) inputs.scale = overrides.scale;
  if (overrides.recipes) inputs.recipes = overrides.recipes;
  if (overrides.spots) inputs.spots = overrides.spots;
  if (overrides.scenario) inputs.scenario = overrides.scenario;
  return gh<void>(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: 'main', // WIF 신뢰 조건이 main ref 한정 — 다른 브랜치 dispatch 는 GCP 인증 실패
      inputs,
    }),
  });
};

export const listRuns = async (): Promise<WorkflowRun[]> => {
  const r = await gh<{ workflow_runs: WorkflowRun[] }>(
    `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=20`,
  );
  return r.workflow_runs;
};

// slim 리포트는 runs/gha-<run_number>-… 디렉토리에 커밋됨 (loadtest.yml) — run_number 로 매칭
const decodeB64 = (content: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(content), (c) => c.charCodeAt(0)));

async function reportFile(runNumber: number, name: string): Promise<string | null> {
  try {
    const dirs = await gh<{ name: string }[]>(
      `/repos/${REPO}/contents/runs?ref=${REPORTS_BRANCH}`,
    );
    const dir = dirs.find((d) => d.name.startsWith(`gha-${runNumber}-`));
    if (!dir) return null;
    const file = await gh<{ content: string }>(
      `/repos/${REPO}/contents/runs/${dir.name}/${name}?ref=${REPORTS_BRANCH}`,
    );
    return decodeB64(file.content);
  } catch {
    return null; // 브랜치/리포트/파일 미존재 — 진행 중이거나 초기 상태
  }
}

export async function getVerdict(runNumber: number): Promise<Verdict | null> {
  const text = await reportFile(runNumber, 'verdict.json');
  return text ? (JSON.parse(text) as Verdict) : null;
}

// meta.json — 비교 가능 조건 + 측정 신뢰도 (collect.sh 작성)
export interface RunMeta {
  sha: string;
  seedVersion: string;
  profile: string;
  target: string;
  sut: string;
  db: string;
  loadgen: string;
  loadgenCpuPlatforms?: string; // #213 이후 — 실제 배정 CPU 세대(정보용)
  spots?: number;
  summariesCollected?: number;
  k6OptionsHash: string;
  loadgenMaxCpu: number; // -1 = 조회 실패
  sutP95?: number; // 서버 관점(micrometer) — 부하기 대수 무관 참 글로벌. -1 = 조회 실패
  sutP99?: number;
  preempted: boolean;
  k6ExitCode: number;
  startedAt: string;
  endedAt: string;
}

// k6 summary(병합본) — threshold 보유 메트릭만 남는다(collect.sh 병합 규칙). values 는 관대하게 읽는다.
export interface K6Summary {
  metrics: Record<
    string,
    { values?: Record<string, number>; thresholds?: Record<string, { ok: boolean }> }
  >;
}

export interface PgRow {
  calls: string;
  mean_ms: string;
  total_ms: string;
  rows: string;
  hit_pct: string;
  query: string;
}

// RFC4180 최소 파서 — pg_top20 의 query 컬럼이 따옴표·개행·콤마를 포함해 line split 으론 못 파싱
function parseCsv(text: string): PgRow[] {
  const rows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    if (row.some((x) => x !== '')) rows.push(row);
  }
  const [head, ...data] = rows;
  if (!head) return [];
  return data.map(
    (r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])) as unknown as PgRow,
  );
}

export interface RunDetailData {
  meta: RunMeta | null;
  summary: K6Summary | null;
  pgTop: PgRow[];
}

// 상세 3종은 행 펼침 시에만 lazy 조회 (verdict 는 목록에서 이미 조회)
export async function getRunDetail(runNumber: number): Promise<RunDetailData> {
  const [meta, summary, pg] = await Promise.all([
    reportFile(runNumber, 'meta.json'),
    reportFile(runNumber, 'summary.json'),
    reportFile(runNumber, 'pg_top20.csv'),
  ]);
  return {
    meta: meta ? (JSON.parse(meta) as RunMeta) : null,
    summary: summary ? (JSON.parse(summary) as K6Summary) : null,
    pgTop: pg ? parseCsv(pg) : [],
  };
}
