// 망원경 pin — 다른 slot 의 공개 섬을 pin 하고 목록을 읽은 뒤 unpin(되돌림).
// POST /me/telescope/pins {islandId, source:"observatory"} → GET /me/telescope → DELETE /me/telescope/pins/{islandId}.
// 전제: slot.pinTargetId 는 actor 가 소속이 아닌 공개 섬(다른 slot 의 섬)이다. pin 은 어차피 정시 버킷 끝에 만료되지만
// 보이는 핀 5개 한도의 밀어내기(evicted) 경로를 타지 않도록 매 회 unpin 한다. 게스트도 쓰므로 소셜 로그인은 타지 않는다.
import { Rate, Counter } from 'k6/metrics';
import { THRESHOLDS } from '../lib/config.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { slotList, mySlot, call } from '../lib/slots.js';

const slots = slotList();
const errors = new Rate('api_errors');
const completed = new Counter('completed_telescope_pin_journeys');
const perStep = {};
for (const step of ['pin', 'list', 'unpin']) perStep[`http_req_duration{endpoint:telescope_${step}}`] = ['p(95)>=0'];
export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: { ...THRESHOLDS, ...perStep, api_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
};

export function run() {
  const s = mySlot(slots);
  const target = s.pinTargetId;
  let pinned = false, ok = false;
  try {
    if (!call('POST', '/me/telescope/pins', s.actor, 'telescope_pin', errors, { body: { islandId: target, source: 'observatory' } })) return;
    pinned = true;
    if (!call('GET', '/me/telescope', s.actor, 'telescope_list', errors)) return;
    ok = true;
  } finally {
    if (pinned) {
      const gone = call('DELETE', `/me/telescope/pins/${target}`, s.actor, 'telescope_unpin', errors);
      if (ok && gone) completed.add(1);
    }
  }
}
export function handleSummary(data) { return summarize(data); }
