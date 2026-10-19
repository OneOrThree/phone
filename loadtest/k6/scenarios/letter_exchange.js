// 편지 — 친구에게 보내고(POST /letters) 수신자가 편지함·상세를 읽고 닫는다(되돌림).
// POST /letters(actor→partner) → GET /letters(partner) → GET /letters/{id}(partner, 읽음 처리) → DELETE /letters/{id}(partner, 닫기).
// 전제: actor·partner 는 게스트가 아닌 회원이고 서로 친구다(seed/60_write_fixture.sql). 발송 한도는 loadtest 프로파일(사실상 무제한)
// 이어야 한다 — 운영 기본 한도에서는 429(RATE_LIMITED) 가 나 에러율이 오염된다. 푸시(FCM)는 이 경로가 호출하지 않는다.
import { Rate, Counter } from 'k6/metrics';
import { THRESHOLDS } from '../lib/config.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { slotList, mySlot, call, field } from '../lib/slots.js';

const slots = slotList();
const errors = new Rate('api_errors');
const completed = new Counter('completed_letter_journeys');
const perStep = {};
for (const step of ['send', 'mailbox', 'detail', 'close']) perStep[`http_req_duration{endpoint:letter_${step}}`] = ['p(95)>=0'];
export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: { ...THRESHOLDS, ...perStep, api_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
};

export function run() {
  const s = mySlot(slots);
  let letterId, closed = false, ok = false;
  try {
    const sent = call('POST', '/letters', s.actor, 'letter_send', errors, { body: { receiverId: s.partner.userId, content: '부하 조사 편지' } });
    if (!sent) return;
    letterId = field(sent, 'id');
    if (!letterId) { errors.add(true); return; }
    if (!call('GET', '/letters', s.partner, 'letter_mailbox', errors)) return;
    if (!call('GET', `/letters/${letterId}`, s.partner, 'letter_detail', errors)) return;
    ok = true;
  } finally {
    if (letterId) {
      closed = !!call('DELETE', `/letters/${letterId}`, s.partner, 'letter_close', errors);
      if (ok && closed) completed.add(1);
    }
  }
}
export function handleSummary(data) { return summarize(data); }
