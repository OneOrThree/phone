// 현재 앱의 시작 → 일시정지 → 재개 → 종료. VU별 전용 계정으로 경합과 처리량을 구분한다.
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check, sleep } from 'k6';
import { vu } from 'k6/execution';
import { Rate, Counter } from 'k6/metrics';
import { BASE_URL, THRESHOLDS } from '../lib/config.js';
import { usersUniform } from '../lib/params.js';
import { authParams } from '../lib/auth.js';
import { resolveProfile } from '../profiles/index.js';
import { summarize } from '../lib/summary.js';
const users=usersUniform(), errors=new Rate('api_errors');
const completed=new Counter('completed_focus_journeys');
const uuid=()=>{
 const bytes=new Uint8Array(crypto.randomBytes(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const perStep={};
for(const step of ['start','pause','resume','finish'])perStep[`http_req_duration{endpoint:focus_${step}}`]=['p(95)>=0'];
export const options={scenarios:resolveProfile().scenarios('run'),thresholds:{...THRESHOLDS,...perStep,api_errors:['rate<0.01']},summaryTrendStats:['avg','med','p(95)','p(99)','max','count']};
function command(user,path,body,step){
 const params=authParams(user,`focus_${step}`);params.headers['Idempotency-Key']=uuid();
 const res=http.post(BASE_URL+path,JSON.stringify(body),params);
 const ok=check(res,{ '수명주기 요청 성공':r=>r.status>=200&&r.status<300 });errors.add(!ok);
 if(!ok){let code;try{code=res.json("error.code");}catch(_){} console.warn(`${step} status=${res.status} code=${code||"unknown"}`);return null;}
 return res.json('data');
}
export function run(){
 const user=users[vu.idInTest-1];
 if(!user?.islandId)throw new Error('maxVUs 이상 전용 유저/islandId fixture 필요');
 const started=command(user,'/focus-sessions',{islandId:user.islandId,subject:'부하 조사'},'start');
 if(!started?.id)return;
 let version=started.version,allStepsSucceeded=false;
 try{
  sleep(.2);
  const paused=command(user,`/focus-sessions/${started.id}/pause`,{expectedVersion:version},'pause');
  if(!paused)return;version=paused.version;
  const resumed=command(user,`/focus-sessions/${started.id}/resume`,{expectedVersion:version},'resume');
  if(!resumed)return;version=resumed.version;allStepsSucceeded=true;
 }finally{
  // 실패 후에도 진행 세션을 회수한다. 조회에 실패하면 다음 run의 사전 검증에서 드러낸다.
  const current=http.get(`${BASE_URL}/focus-sessions/current`,authParams(user,'focus_cleanup_read'));
  if(current.status===200){const session=current.json('data');if(session?.id===started.id)version=session.version;}
  const finished=command(user,`/focus-sessions/${started.id}/finish`,{expectedVersion:version},'finish');
  if(allStepsSucceeded && finished)completed.add(1);
 }
}
export function handleSummary(data){return summarize(data);}
