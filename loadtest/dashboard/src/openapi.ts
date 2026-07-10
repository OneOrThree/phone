// openapi.json(springdoc 스냅샷)에서 대시보드 타겟 카탈로그를 파생한다 (GROMO-750).
// 스냅샷은 public/openapi.json 에 커밋 — 재생성: loadtest/openapi/generate.sh
// (백엔드 ci 프로파일로 gradlew generateOpenApiDocs → build/docs/api/openapi.json 복사).
// "카탈로그 우선(점진)": 전체 엔드포인트를 목록화하되, 지금 실행 가능한 건 기존 k6 스크립트가 있는 것뿐.

export type RunKind = 'script' | 'runnable' | 'recipe';

export interface EndpointEntry {
  method: string;
  path: string; // /api/v1 포함 전체 경로
  summary: string;
  requiredParams: string[];
  hasBody: boolean;
  kind: RunKind; // script=기존 스크립트 실행가능 / runnable=GET·무필수(제네릭 러너 후속) / recipe=파라미터·바디 필요
  target?: string; // kind==='script' 일 때 트리거에 실릴 k6 타겟 경로
}

export interface CatalogGroup {
  tag: string;
  endpoints: EndpointEntry[];
}

export interface Catalog {
  groups: CatalogGroup[];
  total: number;
  scriptCount: number;
  runnableCount: number;
  recipeCount: number;
}

// openapi 엔드포인트(METHOD 경로) → 지금 존재하는 k6 스크립트. 이것만 현재 트리거로 실행 가능.
// (제네릭 러너 + recipes 는 후속 증분에서 이 맵을 확장 대체.)
const SCRIPT_TARGETS: Record<string, string> = {
  'GET /api/v1/focus-session': 'matrix/focus-session-list.js',
  'POST /api/v1/focus-session': 'matrix/focus-session-create.js',
  'GET /api/v1/stats/today': 'matrix/stats-today.js',
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const rank = (k: RunKind) => (k === 'script' ? 0 : k === 'runnable' ? 1 : 2);

interface RawOp {
  tags?: string[];
  summary?: string;
  operationId?: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: unknown;
}

export async function loadCatalog(): Promise<Catalog> {
  const res = await fetch('openapi.json');
  if (!res.ok) throw new Error(`openapi.json 로드 실패 (${res.status})`);
  const spec = (await res.json()) as { paths?: Record<string, Record<string, RawOp>> };

  const byTag = new Map<string, EndpointEntry[]>();
  let scriptCount = 0;
  let runnableCount = 0;
  let recipeCount = 0;

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const requiredParams = (op.parameters ?? []).filter((x) => x.required).map((x) => x.name);
      const hasBody = op.requestBody != null;
      const target = SCRIPT_TARGETS[`${method.toUpperCase()} ${path}`];

      let kind: RunKind;
      if (target) {
        kind = 'script';
        scriptCount++;
      } else if (method === 'get' && requiredParams.length === 0 && !hasBody) {
        kind = 'runnable';
        runnableCount++;
      } else {
        kind = 'recipe';
        recipeCount++;
      }

      const tag = op.tags?.[0] ?? '(기타)';
      const entry: EndpointEntry = {
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? op.operationId ?? '',
        requiredParams,
        hasBody,
        kind,
        target,
      };
      const list = byTag.get(tag);
      if (list) list.push(entry);
      else byTag.set(tag, [entry]);
    }
  }

  const groups = [...byTag.entries()]
    .map(([tag, endpoints]) => ({
      tag,
      endpoints: endpoints.sort((a, b) => rank(a.kind) - rank(b.kind) || a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    groups,
    total: scriptCount + runnableCount + recipeCount,
    scriptCount,
    runnableCount,
    recipeCount,
  };
}
