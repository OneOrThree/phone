// 매트릭스: POST /api/v1/focus-session — 쓰기 연쇄(daily_focus_stats upsert·streak·재화 적립).
// 유저 풀 파티셔닝: 같은 유저 동시 요청을 배제해 낙관락 충돌이 "우연히" 섞이는 것을 막는다 —
// 우연은 배제, 경합은 (Phase 4 에서) 설계 (설계 §3-2).
import http from 'k6/http';
import { scenario } from 'k6/execution';
import { API, THRESHOLDS, randInt } from '../lib/config.js';
import { usersUniform } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const users = usersUniform(); // 파티셔닝엔 균등 풀이 맞다 — Zipf 중복 수록 파일이면 같은 유저 재등장

export const options = {
  scenarios: resolveProfile().scenarios('create'),
  thresholds: THRESHOLDS,
};

export function create() {
  // 파티셔닝 — 유저당 동시 1요청. 무충돌 조건: 풀 크기 ≥ 프로파일 maxVUs(최대 1500, spike).
  // users_uniform.json 은 1만 명 export(40_params_export) — SCALE 축소 시드에선 풀이 줄어드니 주의 (#182 리뷰 3)
  const u = users[scenario.iterationInTest % users.length];
  const durMin = 15 + randInt(60);
  const ended = Date.now() - randInt(3600) * 1000;
  const started = ended - durMin * 60e3;
  // focusTagId 는 생략(무태그 세션 — 유효 케이스). 유저별 태그 id 는 params 에 없어 Phase 1 에서
  // export 확장으로 추가 예정.
  const body = JSON.stringify({
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    totalDistractionSeconds: randInt(durMin * 12),
  });
  http.post(`${API}/focus-session`, body, authParams(u, 'focus_session_create'));
}

export function handleSummary(data) {
  return summarize(data);
}
