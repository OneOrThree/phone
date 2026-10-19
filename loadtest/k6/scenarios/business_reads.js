// 현재 앱 공개 API → Business → Data 경로. 유효한 sid/gen 세션이 있는 전용 계정 풀을 사용한다.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, THRESHOLDS, pick } from '../lib/config.js';
import { usersUniform } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const users = usersUniform();
export const options = {
  scenarios: resolveProfile().scenarios('browse'),
  thresholds: { ...THRESHOLDS, 'checks{phase:main}': ['rate>0.99'] },
};
export function browse() {
  const user = pick(users);
  const path = pick(['/me', '/me/islands', '/focus-sessions/current', '/screens/account']);
  const response = http.get(`${BASE_URL}${path}`, authParams(user, path));
  check(response, { '공개 API 성공': (r) => r.status === 200 });
}
export function handleSummary(data) { return summarize(data); }
