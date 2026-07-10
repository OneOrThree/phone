// 제네릭 시나리오 러너 (GROMO-750) — 유저 여정(가중 혼합)에 부하.
// __ENV.SCENARIO = defs/<name>.json. def 의 journeys 를 가중 픽 → 한 유저가 스텝(recipe 참조)을
// 순차 실행(= 진짜 세션). 시나리오는 데이터(JSON)라 대시보드가 상세(여정·가중치·스텝)를 그대로 표시.
import { THRESHOLDS, pick } from '../lib/config.js';
import { usersZipf, usersUniform, groupIds, searchTerms } from '../lib/params.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { execRecipe } from '../lib/recipe-exec.js';

const NAME = __ENV.SCENARIO || '';
if (!NAME) throw new Error('SCENARIO 환경변수 필요 (defs/<name>.json)');
const scenario = JSON.parse(open(`./defs/${NAME}.json`));

// 스텝이 참조하는 recipe 를 모두 로드(init) — 캐시
const recipeCache = {};
for (const j of scenario.journeys) {
  for (const s of j.steps) {
    if (!recipeCache[s.recipe]) recipeCache[s.recipe] = JSON.parse(open(`../recipes/${s.recipe}.json`));
  }
}

const usersZ = usersZipf();
const usersU = usersUniform();
const pools = { groups: groupIds(), terms: searchTerms() };
const TOTAL_W = scenario.journeys.reduce((s, j) => s + (j.weight || 0), 0);

export const options = {
  scenarios: resolveProfile().scenarios('journey'),
  thresholds: THRESHOLDS,
};

export function journey() {
  // 가중 픽
  let r = Math.random() * TOTAL_W;
  let jrn = scenario.journeys[0];
  for (const j of scenario.journeys) {
    if ((r -= j.weight || 0) < 0) {
      jrn = j;
      break;
    }
  }
  // 여정 전체를 한 유저로(세션). 쓰기 스텝이 있으면 uniform(락 경합 배제), 아니면 zipf.
  const hasWrite = jrn.steps.some((s) => recipeCache[s.recipe].method !== 'GET');
  const u = pick(hasWrite ? usersU : usersZ);
  for (const s of jrn.steps) execRecipe(recipeCache[s.recipe], u, pools);
}

export function handleSummary(data) {
  return summarize(data);
}
