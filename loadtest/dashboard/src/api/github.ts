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

// 고급 설정(expert) override — 빈 값은 생략해 워크플로우 default(=프로파일 기본)로 폴백
export interface RunOverrides {
  rate?: string;
  duration?: string;
  scale?: string;
  recipes?: string; // 제네릭 러너 — TARGET=matrix/_generic.js 일 때 콤마구분 엔드포인트 목록(총 rate 분산)
  spots?: string; // loadgen spot VM 수(고rps 분산 생성)
}

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
  if (overrides.rate) inputs.rate = overrides.rate;
  if (overrides.duration) inputs.duration = overrides.duration;
  if (overrides.scale) inputs.scale = overrides.scale;
  if (overrides.recipes) inputs.recipes = overrides.recipes;
  if (overrides.spots) inputs.spots = overrides.spots;
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
export async function getVerdict(runNumber: number): Promise<Verdict | null> {
  try {
    const dirs = await gh<{ name: string }[]>(
      `/repos/${REPO}/contents/runs?ref=${REPORTS_BRANCH}`,
    );
    const dir = dirs.find((d) => d.name.startsWith(`gha-${runNumber}-`));
    if (!dir) return null;
    const file = await gh<{ content: string }>(
      `/repos/${REPO}/contents/runs/${dir.name}/verdict.json?ref=${REPORTS_BRANCH}`,
    );
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))));
  } catch {
    return null; // 브랜치/리포트 미존재 — 진행 중이거나 초기 상태
  }
}
