// 가입 승인 — 승인제 섬(gate)에 신청 → 섬장이 신청 목록 확인·승인 → 신청자가 나가기(되돌림).
// POST /islands/{gate}/memberships → GET /islands/{gate}/join-requests(섬장) → PATCH …/join-requests/{id} approve(섬장)
// → DELETE /islands/{gate}/memberships/me. 승인 전 실패는 신청 취소(DELETE /me/join-requests/{id})로 되돌린다.
// 되돌릴 수 없는 잔여물: join_requests 행(요청당 1건)과 승인 안내 시스템 편지 1건 — 반복 실행 시 선형 증가한다.
// 전제: Data 의 ISLAND_MANAGEMENT_COMMANDS_ENABLED=true 필요(기본 false) — 꺼져 있으면 승인·나가기가 503 ISLAND_MANAGEMENT_NOT_READY 다(로컬 compose 는 켜 둠).
// 전제: slot.actor 는 소속 2곳(상한 3) 이하이고 gate 섬(승인제, 정원 여유)의 방장은 slot.partner 다.
import { Rate, Counter } from 'k6/metrics';
import { THRESHOLDS } from '../lib/config.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { slotList, mySlot, call, field } from '../lib/slots.js';

const slots = slotList();
const errors = new Rate('api_errors');
const completed = new Counter('completed_join_approval_journeys');
const perStep = {};
for (const step of ['apply', 'list', 'approve', 'leave', 'cancel']) perStep[`http_req_duration{endpoint:join_${step}}`] = ['p(95)>=0'];
export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: { ...THRESHOLDS, ...perStep, api_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
};

export function run() {
  const s = mySlot(slots);
  const gate = s.gateIslandId;
  const apply = (track) => call('POST', `/islands/${gate}/memberships`, s.actor, 'join_apply', errors, { body: {}, idem: true, track });
  const leave = () => call('DELETE', `/islands/${gate}/memberships/me`, s.actor, 'join_leave', errors, { idem: true, track: false });
  let requestId, maybeMember = false, ok = false;
  try {
    // 앞 회차의 유실 응답 등으로 actor 가 아직 gate 주민이면 신청이 실패한다 — 그때만 나가기 후 한 번 재시도한다.
    // 매 회차 사전 조회·나가기를 하면 요청이 1건 늘어 측정이 왜곡되므로, 정상 경로에는 비용이 없는 이 방식을 택했다.
    let applied = apply(false);
    if (!applied) { leave(); applied = apply(true); }
    if (!applied) return;
    requestId = field(applied, 'requestId');
    if (!requestId) { errors.add(true); return; }
    if (!call('GET', `/islands/${gate}/join-requests`, s.partner, 'join_list', errors)) return;
    // PATCH 를 보낸 순간부터 서버에선 승인이 커밋됐을 수 있다(타임아웃·5xx·응답 유실) — 결과와 무관하게 주민일 수 있다고 본다.
    maybeMember = true;
    if (!call('PATCH', `/islands/${gate}/join-requests/${requestId}`, s.partner, 'join_approve', errors, { body: { decision: 'approve' }, idem: true })) return;
    ok = true;
  } finally {
    // 정리 실패는 api_errors 에 넣지 않는다(track=false, 경고만). 나가기를 먼저, 안 됐으면(주민 아님) 신청 취소.
    const left = maybeMember ? leave() : null;
    if (!left && requestId) call('DELETE', `/me/join-requests/${requestId}`, s.actor, 'join_cancel', errors, { idem: true, track: false });
    if (ok && left) completed.add(1);
  }
}
export function handleSummary(data) { return summarize(data); }
