// 제네릭 러너 (GROMO-750) — 선택 엔드포인트 목록(RECIPES)에 병렬 부하.
// __ENV.RECIPES = 콤마구분 recipe 이름(단일도 길이 1). __ENV.RATE = 총 arrival rate(rps).
// 모델 A: 하나의 arrival-rate 시나리오에서 매 iteration 랜덤 recipe 를 골라 실행 → 총 부하를 선택
// 엔드포인트에 분산(동시 VU = 병렬 부하). 유저 변동·per-endpoint 지표는 execRecipe 가 처리.
import { THRESHOLDS, pick } from '../lib/config.js';
import { usersZipf, usersUniform, groupIds, searchTerms } from '../lib/params.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { execRecipe } from '../lib/recipe-exec.js';

const NAMES = (__ENV.RECIPES || __ENV.RECIPE || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!NAMES.length) throw new Error('RECIPES 환경변수 필요 (콤마구분 recipe 목록)');
const recipes = NAMES.map((name) => JSON.parse(open(`../recipes/${name}.json`)));

const usersZ = usersZipf();
const usersU = usersUniform();
const pools = { groups: groupIds(), terms: searchTerms() };

// per-endpoint 서브메트릭 — k6 는 threshold 가 선언된 태그 조합만 summary 에 남긴다(집계만으론
// "어느 API 가 느린가"를 못 본다). 항상 참인 식으로 선언해 **판정에는 영향을 주지 않고**
// 엔드포인트별 지연·에러율·요청수만 summary.json 에 실린다. 합격선은 THRESHOLDS(전체) 소관.
const perEndpoint = {};
for (const n of NAMES) {
  perEndpoint[`http_req_duration{endpoint:${n}}`] = ['p(95)>=0'];
  perEndpoint[`http_req_failed{endpoint:${n}}`] = ['rate>=0'];
  perEndpoint[`http_reqs{endpoint:${n}}`] = ['count>=0'];
}

export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: { ...THRESHOLDS, ...perEndpoint },
  // 기본값엔 p(99)·count 가 없어 서브메트릭 values 에도 안 실린다 — 리포트에 필요한 통계를 명시.
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

// (endpoint × status) 실패 분류 로그 — 비-2xx 조합당 최대 3건, 응답 본문 일부 포함(원인 즉독).
// stderr 로 나가 vm_ssh 출력 → 오케스트레이션 로그에 남는다. 부하 경로 비용은 카운터 증가뿐.
const seenStatus = {};
export function run() {
  const recipe = pick(recipes); // 랜덤 픽 = 총 rate 를 선택분에 분산(모델 A)
  const u = pick(recipe.userPool === 'uniform' ? usersU : usersZ);
  const res = execRecipe(recipe, u, pools);
  if (res && (res.status < 200 || res.status >= 300)) {
    const k = `${recipe.endpoint} ${res.status}`;
    seenStatus[k] = (seenStatus[k] || 0) + 1;
    if (seenStatus[k] <= 3)
      console.warn(`[STATUS] ${k} :: ${String(res.body).slice(0, 160)}`);
  }
}

export function handleSummary(data) {
  return summarize(data);
}
