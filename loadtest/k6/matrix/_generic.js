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

export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: THRESHOLDS,
};

export function run() {
  const recipe = pick(recipes); // 랜덤 픽 = 총 rate 를 선택분에 분산(모델 A)
  const u = pick(recipe.userPool === 'uniform' ? usersU : usersZ);
  execRecipe(recipe, u, pools);
}

export function handleSummary(data) {
  return summarize(data);
}
