// 매트릭스: GET /api/v1/stats/today — 인덱스 있는 대조군.
// daily_focus_stats 는 (user_id, date) UNIQUE 인덱스 보유 — v1 가설("heatmap 이 느릴 것")이
// 틀렸던 증거를 실측으로 남기는 카드 (설계 Phase 1 대조군).
import http from 'k6/http';
import { API, THRESHOLDS, pick, randInt } from '../lib/config.js';
import { usersZipf } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const users = usersZipf();

export const options = {
  scenarios: resolveProfile().scenarios('today'),
  thresholds: THRESHOLDS,
};

export function today() {
  const u = pick(users);
  const date = new Date(Date.now() - randInt(30) * 864e5).toISOString().slice(0, 10);
  http.get(`${API}/stats/today?date=${date}`, authParams(u, 'stats_today'));
}

export function handleSummary(data) {
  return summarize(data);
}
