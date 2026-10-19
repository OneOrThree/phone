// CASE별 동일 도착률로 공개 API/화면 조합을 비교한다. fixture는 survey 준비 단계가 검증한다.
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Counter } from 'k6/metrics';
import { BASE_URL, THRESHOLDS, pick } from '../lib/config.js';
import { usersUniform } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { summarize } from '../lib/summary.js';
import { resolveProfile } from '../profiles/index.js';

const cases = JSON.parse(open('../cases/public.json'));
const selected = cases.find((c) => c.id === __ENV.CASE);
if (!selected) throw new Error('CASE를 k6/cases/public.json에서 선택하세요');
// SharedArray를 일반 배열로 복사하면 큰 fixture가 VU 수만큼 복제된다. 역할 풀도 공유한다.
const allUsers = usersUniform();
const users = selected.role
  ? new SharedArray(`survey-users-${selected.role}`, () => allUsers.filter(u => u.role === selected.role))
  : allUsers;
const seededId=(key)=>{const h=crypto.md5(key,'hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
const errors = new Rate('api_errors');
const completed = new Counter('completed_app_journeys');
const perPath = {};
for (const [i, path] of selected.paths.entries()) perPath[`http_req_duration{endpoint:${selected.id}_${i}}`] = ['p(95)>=0'];
export const options = {
  scenarios: resolveProfile().scenarios('run'),
  thresholds: { ...THRESHOLDS, ...perPath, api_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};
let reported = false;
export function run() {
  const user = pick(users);
  const weekStart = new Date(); weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const requests = selected.paths.map((template,i) => {
    if (template.includes('{islandId}') && !user.islandId) throw new Error('fixture에 islandId 필요');
    const path = template.replaceAll('{islandId}', user.islandId || '')
      .replaceAll('{noticeId}',seededId('survey-notice-'+user.islandId+'-1'))
      .replaceAll('{letterId}',seededId('survey-letter-'+user.userId+'-1'))
      .replaceAll('{yesterday}',new Date(Date.now()-86400000).toISOString().slice(0,10))
      .replaceAll('{month}',new Date().toISOString().slice(0,7))
      .replaceAll('{date}', new Date().toISOString().slice(0, 10))
      .replaceAll('{from}', new Date(Date.now()-29*86400000).toISOString().slice(0,10))
      .replaceAll('{week}', weekStart.toISOString().slice(0, 10));
    return {method:'GET',url:BASE_URL+path,params:authParams(user,`${selected.id}_${i}`)};
  });
  const first=requests[0];
  const responses=[http.get(first.url,first.params)];
  if(selected.parallelAfterFirst) responses.push(...http.batch(requests.slice(1)));
  else for(const r of requests.slice(1)) responses.push(http.get(r.url,r.params));
  let allSucceeded = true;
  for (const res of responses) {
    const ok = check(res, { '정상 2xx 응답': (r) => r.status >= 200 && r.status < 300 });
    errors.add(!ok);
    allSucceeded = allSucceeded && ok;
    if (!ok && !reported) {
      reported = true;
      // 토큰·개인 데이터는 출력하지 않고 에러 코드만 기록한다.
      let code; try { code = res.json('error.code') || res.json('code'); } catch (_) {}
      console.warn(`${selected.id} status=${res.status} code=${code || 'unknown'}`);
    }
  }
  if (selected.kind === 'journey' && allSucceeded) completed.add(1);
}
export function handleSummary(data) { return summarize(data); }
