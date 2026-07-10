// 현실 트래픽 믹스 — 유저 여정 6종을 가중 랜덤으로 실행 (설계 §3-1).
// 비중(25/20/20/15/10/10)은 실 트래픽이 없어 **가정** — meta.json 에 mixVersion: assumed-v1 로
// 명시하고 출시 후 액세스 로그로 교정한다. screen_time_2359 는 spike 프로파일 전용(Phase 4).
import http from 'k6/http';
import { API, THRESHOLDS, pick, randInt } from '../lib/config.js';
import { usersZipf, usersUniform, groupIds, searchTerms } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { followCursor } from '../lib/cursor.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';
import { scenario } from 'k6/execution';

const users = usersZipf();
const writers = usersUniform(); // 쓰기 여정은 파티셔닝용 균등 풀
const groups = groupIds();
const terms = searchTerms();

export const options = {
  scenarios: resolveProfile().scenarios('journey'),
  thresholds: THRESHOLDS,
};

// ── 여정 정의 (실측 확인된 엔드포인트·파라미터만 사용) ──────────────
function morningCheck(u) {
  const date = new Date().toISOString().slice(0, 10);
  http.get(`${API}/stats/today?date=${date}`, authParams(u, 'stats_today'));
  http.get(`${API}/league/me/ranking`, authParams(u, 'league_me_ranking'));
  http.get(`${API}/stats/streak`, authParams(u, 'stats_streak'));
}

function statsBrowse(u) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  http.get(`${API}/stats/heatmap?from=${from}&to=${to}`, authParams(u, 'stats_heatmap'));
  const toTs = new Date().toISOString();
  const fromTs = new Date(Date.now() - pick([7, 30, 90]) * 864e5).toISOString();
  followCursor(`${API}/focus-session?from=${fromTs}&to=${toTs}&size=20`, authParams(u, 'focus_session_list'), 3);
}

function social(u) {
  http.get(`${API}/friends`, authParams(u, 'friends_list'));
  http.get(`${API}/friends/search?type=NICKNAME&q=${encodeURIComponent(pick(terms).term)}`, authParams(u, 'friends_search'));
  http.get(`${API}/groups/${pick(groups).groupId}/overview`, authParams(u, 'group_overview'));
}

function focusWrite() {
  const u = writers[scenario.iterationInTest % writers.length]; // 낙관락 우연 충돌 배제
  const durMin = 15 + randInt(60);
  const ended = Date.now() - randInt(3600) * 1000;
  const body = JSON.stringify({
    startedAt: new Date(ended - durMin * 60e3).toISOString(),
    endedAt: new Date(ended).toISOString(),
    totalDistractionSeconds: randInt(durMin * 12),
  });
  http.post(`${API}/focus-session`, body, authParams(u, 'focus_session_create'));
}

function shop(u) {
  // Phase 0 은 조회 중심 — spend 는 잔액 부족 4xx 가 에러율을 오염시켜 경합 설계(Phase 4)로 미룸
  http.get(`${API}/inventory/${u.userId}`, authParams(u, 'inventory'));
  http.get(`${API}/currency`, authParams(u, 'currency_balance'));
}

function misc(u) {
  http.get(`${API}/groups/search?query=${encodeURIComponent(pick(terms).term)}`, authParams(u, 'groups_search'));
}

// 가중 선택 — 25/20/20/15/10/10
const JOURNEYS = [
  [25, morningCheck],
  [20, statsBrowse],
  [20, social],
  [15, focusWrite],
  [10, shop],
  [10, misc],
];
const TOTAL_W = JOURNEYS.reduce((s, [w]) => s + w, 0);

export function journey() {
  const u = pick(users);
  let r = Math.random() * TOTAL_W;
  for (const [w, fn] of JOURNEYS) {
    if ((r -= w) < 0) return fn(u);
  }
}

export function handleSummary(data) {
  return summarize(data);
}
