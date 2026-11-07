const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {extractApp,extractServer,canonical} = require('./inventory.cjs');
function fixture(t,name,text) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phone-contract-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,name);fs.writeFileSync(file,text);return file;
}
test('주석·문자열의 가짜 호출 제외, import 별칭과 메서드·쿼리 해석',t=>{
  const file=fixture(t,'api.ts',`import {request as call} from './client';
  // call('/fake')
  const text="call('/fake2')";
  call('/me'); call(\`/islands/\${encodeURIComponent(id)}/intro-arrivals\`,{method:'POST'});
  const options=(v)=>({method:'PATCH' as const,body:v}); call('/me',options(1));
  const query=cursor ? \`?cursor=\${cursor}\` : ''; call(\`/letters\${query}\`);
  call(cursor ? '/me?cursor=1' : '/me');`);
  const found=extractApp([file]);
  assert.equal(found.unresolved.length,0);
  assert.deepEqual(found.endpoints.map(e=>[e.method,e.path]),[['GET','/me'],['POST','/islands/{}/intro-arrivals'],['PATCH','/me'],['GET','/letters'],['GET','/me']]);
});
test('모르는 경로·옵션을 GET으로 추정하지 않음',t=>{
  const file=fixture(t,'api.ts',`import {request} from './client'; request(runtimeUrl);request('/me',dynamicOptions);request('/me',{...opts});`);
  assert.equal(extractApp([file]).unresolved.length,3);
});
test('method를 바꾸지 않는 조건부 전개만 허용한다',t=>{
  const file=fixture(t,'api.ts',`import {request} from './client';
    request('/safe',{method:'POST', ...(meta ? {body:meta} : {})});
    request('/unsafe',{method:'POST', ...(flag ? {method:'DELETE'} : {})});
    request('/unknown',{method:'POST', ...dynamic});`);
  const found=extractApp([file]);
  assert.deepEqual(found.endpoints.map(e=>[e.method,e.path]),[['POST','/safe']]);
  assert.equal(found.unresolved.length,2);
});
test('서버 클래스 접두·빈 메서드 매핑·본문 consumes 해석',t=>{
  const file=fixture(t,'Controller.java',`@RequestMapping("/me/settings") public class Controller {
  @GetMapping public void get() {} @PatchMapping(consumes="application/json") public void update() {}
  @DeleteMapping("/{id}") public void delete() {} }`);
  const result=extractServer([file]);
  assert.equal(result.unsupported.length,0);
  assert.deepEqual(result.endpoints.map(e=>[e.method,e.path]),[['GET','/me/settings'],['PATCH','/me/settings'],['DELETE','/me/settings/{}']]);
});
test('지원하지 않는 서버 매핑을 성공으로 숨기지 않음',t=>{
  const file=fixture(t,'Controller.java',`public class Controller { @GetMapping(dynamicPath) public void get() {} }`);
  assert.equal(extractServer([file]).unsupported.length,1);
});
test('서로 다른 정적 경로 분기는 누락시키지 않고 미해석으로 보고',t=>{
  const file=fixture(t,'api.ts',`import {request} from './client';request(flag?'/a':'/b');`);
  assert.equal(extractApp([file]).unresolved.length,1);
});
test('경로 변수·쿼리 정규화',()=>assert.equal(canonical('/islands/{islandId}?cursor=1'),'/islands/{}'));

test('지역 변수로 가려진 request를 서버 API로 오인하지 않음',t=>{
  const file=fixture(t,'api.ts',`import {request} from './client';request('/me');function local(request){request('/external')}`);
  assert.deepEqual(extractApp([file]).endpoints.map(e=>e.path),['/me']);
});
test('구문 오류를 조용히 누락시키지 않음',t=>{
  const file=fixture(t,'api.ts',`import {request} from './client'; const broken = ;`);
  assert.ok(extractApp([file]).unresolved.length);
});
