// openapi.json(springdoc 스냅샷) + recipes-manifest.json 에서 대시보드 타겟 카탈로그를 파생 (GROMO-750).
// 스냅샷 재생성: .github/workflows/api-dog-generate.yml 과 동일(SPRING_PROFILES_ACTIVE=ci ./gradlew generateOpenApiDocs).
// recipe 매니페스트: loadtest/recipes/gen-recipes.mjs 산출물(어떤 엔드포인트가 제네릭 러너로 실행 가능한지).
// 디스패치: script=기존 k6 스크립트 / recipe=matrix/_generic.js + RECIPE / gap=아직 실행불가(path ID 미조달).

export type RunKind = 'script' | 'recipe' | 'gap';

export interface EndpointEntry {
  method: string;
  path: string; // /api/v1 포함 전체 경로
  summary: string;
  requiredParams: string[];
  hasBody: boolean;
  kind: RunKind;
  target?: string; // kind 'script' — 기존 k6 스크립트 경로
  recipe?: string; // kind 'recipe'|'gap' — recipe 이름(=RECIPE)
}

export interface CatalogGroup {
  tag: string;
  endpoints: EndpointEntry[];
}

export interface Catalog {
  groups: CatalogGroup[];
  endpoints: EndpointEntry[]; // 평탄 목록(전체선택·배치용)
  total: number;
  scriptCount: number;
  recipeCount: number;
  gapCount: number;
}

// 디스패치 대상 — 단일 실행/배치가 dispatchRun(profile, target, false, {recipe}) 로 사용
export interface DispatchTarget {
  target: string;
  recipe?: string;
  label: string;
}
export function dispatchTargetOf(e: EndpointEntry): DispatchTarget | null {
  if (e.kind === 'script' && e.target) return { target: e.target, label: `${e.method} ${short(e.path)}` };
  if (e.kind === 'recipe' && e.recipe) return { target: 'matrix/_generic.js', recipe: e.recipe, label: `${e.method} ${short(e.path)}` };
  return null;
}
export const short = (p: string) => p.replace(/^\/api\/v1/, '');
export const isRunnable = (e: EndpointEntry) => e.kind === 'script' || e.kind === 'recipe';

// openapi 엔드포인트(METHOD 경로) → 기존 k6 스크립트(제네릭 recipe 보다 우선 — 현실 입력 전략 유지)
const SCRIPT_TARGETS: Record<string, string> = {
  'GET /api/v1/focus-session': 'matrix/focus-session-list.js',
  'POST /api/v1/focus-session': 'matrix/focus-session-create.js',
  'GET /api/v1/stats/today': 'matrix/stats-today.js',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const rank = (k: RunKind) => (k === 'script' ? 0 : k === 'recipe' ? 1 : 2);

interface RawOp {
  tags?: string[];
  summary?: string;
  operationId?: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: unknown;
}
interface ManifestRecipe {
  endpoint: string;
  method: string;
  path: string;
  runnable: boolean;
}

export async function loadCatalog(): Promise<Catalog> {
  const [specRes, manRes] = await Promise.all([
    fetch('/openapi.json'),
    fetch('/recipes-manifest.json'),
  ]);
  if (!specRes.ok) throw new Error(`openapi.json 로드 실패 (${specRes.status})`);
  if (!manRes.ok) throw new Error(`recipes-manifest.json 로드 실패 (${manRes.status})`);
  const spec = (await specRes.json()) as { paths?: Record<string, Record<string, RawOp>> };
  const manifest = (await manRes.json()) as { recipes: ManifestRecipe[] };

  // method+path → recipe
  const recipeByKey = new Map<string, ManifestRecipe>();
  for (const r of manifest.recipes) recipeByKey.set(`${r.method} ${r.path}`, r);

  const byTag = new Map<string, EndpointEntry[]>();
  const endpoints: EndpointEntry[] = [];
  let scriptCount = 0;
  let recipeCount = 0;
  let gapCount = 0;

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const key = `${method.toUpperCase()} ${path}`;
      const requiredParams = (op.parameters ?? []).filter((x) => x.required).map((x) => x.name);
      const hasBody = op.requestBody != null;
      const scriptTarget = SCRIPT_TARGETS[key];
      const rec = recipeByKey.get(key);

      let kind: RunKind;
      let target: string | undefined;
      let recipe: string | undefined;
      if (scriptTarget) {
        kind = 'script';
        target = scriptTarget;
        recipe = rec?.endpoint; // 배치(병렬)에선 스크립트 엔드포인트도 generic recipe 로 함께 실행
        scriptCount++;
      } else if (rec && rec.runnable) {
        kind = 'recipe';
        recipe = rec.endpoint;
        recipeCount++;
      } else {
        kind = 'gap';
        recipe = rec?.endpoint;
        gapCount++;
      }

      const entry: EndpointEntry = {
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? op.operationId ?? '',
        requiredParams,
        hasBody,
        kind,
        target,
        recipe,
      };
      endpoints.push(entry);
      const list = byTag.get(op.tags?.[0] ?? '(기타)');
      if (list) list.push(entry);
      else byTag.set(op.tags?.[0] ?? '(기타)', [entry]);
    }
  }

  const groups = [...byTag.entries()]
    .map(([tag, eps]) => ({
      tag,
      endpoints: eps.sort((a, b) => rank(a.kind) - rank(b.kind) || a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    groups,
    endpoints,
    total: scriptCount + recipeCount + gapCount,
    scriptCount,
    recipeCount,
    gapCount,
  };
}
