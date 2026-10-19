// 섬 전환 — 현재 섬을 가입한 다른 섬(hub)으로 옮겼다가 도착으로 되돌린다.
// PUT /me/current-island(hub) → POST /islands/{내 섬}/arrivals. 끝나면 현재 섬은 항상 원래 섬이다(되돌림 내장).
// 전제: slot.actor 는 islandId(방장)·hubIslandId(주민) 둘 다에 도착 기록이 있고 두 섬의 전망대가 열려 있다.
import { Rate, Counter } from 'k6/metrics';
import { THRESHOLDS } from '../lib/config.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { slotList, mySlot, call } from '../lib/slots.js';

const slots = slotList();
const errors = new Rate('api_errors');
const completed = new Counter('completed_island_switch_journeys');
const perStep = {};
for (const step of ['switch_out', 'switch_back', 'switch_restore']) perStep[`http_req_duration{endpoint:island_${step}}`] = ['p(95)>=0'];
export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: { ...THRESHOLDS, ...perStep, api_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
};

export function run() {
  const s = mySlot(slots);
  let atHome = true;
  try {
    if (!call('PUT', '/me/current-island', s.actor, 'island_switch_out', errors, { body: { islandId: s.hubIslandId }, idem: true })) return;
    atHome = false;
    if (!call('POST', `/islands/${s.islandId}/arrivals`, s.actor, 'island_switch_back', errors, { idem: true })) return;
    atHome = true;
    completed.add(1);
  } finally {
    // 중간 실패 시 원래 섬으로 복귀 — 같은 섬 PUT 은 상태확인(200)이라 이미 돌아와 있어도 안전하다.
    if (!atHome) call('PUT', '/me/current-island', s.actor, 'island_switch_restore', errors, { body: { islandId: s.islandId }, idem: true });
  }
}
export function handleSummary(data) { return summarize(data); }
