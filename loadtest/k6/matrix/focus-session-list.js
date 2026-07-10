// ⭐ 매트릭스: GET /api/v1/focus-session (커서 페이지네이션) — Phase 1 표적.
// focus_sessions 3천만 건·PK 외 인덱스 0 위에서 도는 조회. 단건 run 의 pg_stat 델타 = 이 API 의 쿼리 프로필.
import http from 'k6/http';
import { API, THRESHOLDS, pick, randInt } from '../lib/config.js';
import { usersZipf } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { followCursor } from '../lib/cursor.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const users = usersZipf(); // Zipf 전개 파일 — uniform 샘플 = Zipf (같은 유저만 치면 버퍼캐시 과대평가)

export const options = {
  scenarios: resolveProfile().scenarios('list'),
  thresholds: THRESHOLDS,
};

export function list() {
  const u = pick(users);
  const days = pick([7, 30, 90]); // 기간도 랜덤 — 캐시 편향 제거 (설계 §2-3)
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 864e5).toISOString();
  // 커서는 실제로 2페이지까지 — 첫 페이지만 치면 id < :cursor 분기가 안 탄다
  followCursor(
    `${API}/focus-session?from=${from}&to=${to}&size=20`,
    authParams(u, 'focus_session_list'),
    2,
  );
}

export function handleSummary(data) {
  return summarize(data);
}
