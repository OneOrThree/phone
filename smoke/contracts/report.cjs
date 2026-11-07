#!/usr/bin/env node
// 목록·코드 대조·시나리오 등록을 보고한다. 실제 테스트 성공을 추정하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('./inventory.cjs');
const root = path.resolve(__dirname,'../..');
function report() {
  const result = build();
  const approvedFetches = JSON.parse(fs.readFileSync(path.join(__dirname,'external-fetches.json'),'utf8'));
  result.unreviewedFetches = result.otherFetches.filter(e=>!approvedFetches.some(a=>a.file===e.file && a.expression===e.expression));
  const scenarios = JSON.parse(fs.readFileSync(path.join(__dirname,'scenarios.json'),'utf8')).scenarios;
  const keys = new Set(result.endpoints.map(e=>e.method+' '+e.path));
  for (const scenario of scenarios) {
    if (!fs.existsSync(path.join(root,scenario.runner))) throw new Error('시나리오 실행 파일 없음: '+scenario.id);
    for (const api of scenario.apis) if (!keys.has(api)) throw new Error('앱에서 사라진 API 등록: '+api);
  }
  for (const endpoint of result.endpoints) {
    endpoint.scenarios = scenarios.filter(s=>s.apis.includes(endpoint.method+' '+endpoint.path)).map(s=>s.id);
    endpoint.execution = 'NOT_RUN';
  }
  result.scenarios = scenarios;
  const registered = result.endpoints.filter(e=>e.scenarios.length).length;
  const lines = ['# 앱 API·서버 경로·시나리오 커버리지', '',
    `입력 소스 SHA-256: \`${result.sourceDigest}\``, '',
    `API ${result.endpoints.length}개 / 서버 경로 미일치 ${result.endpoints.filter(e=>!e.server.length).length}개 / 미해석 ${result.unresolved.length}개 / 시나리오 등록 ${registered}개`, '',
    '**정적 분석 결과다. 서버 경로 일치·시나리오 등록은 테스트 실행 성공을 의미하지 않는다.**', '',
    '| 메서드 | 경로 | 서버 선언 | 등록 시나리오 | 실제 실행 | 앱 호출 위치 |',
    '| --- | --- | --- | --- | --- | --- |'];
  for (const e of result.endpoints) lines.push(`| ${e.method} | \`${e.path}\` | ${e.server.length?'일치':'미일치'} | ${e.scenarios.join(', ')||'미등록'} | NOT_RUN | ${e.sources.map(s=>s.file+':'+s.line).join(', ')} |`);
  lines.push('', '## 해석·범위 한계', '',
    '- 경로 변수 이름은 `{}`로 통일하고 쿼리 값은 경로 대조에서 제외한다. 쿼리·본문·헤더·응답 계약은 이 검사로 증명하지 않는다.',
    '- TypeScript AST의 공용 request 호출과 직접 인증 refresh 호출을 수집한다. HTTP 외 WebSocket·네이티브 SDK 호출은 제외한다.',
    '- 해석하지 못하는 앱 호출과 서버 매핑은 숨기지 않고 별도 목록에 남기며 CI를 실패시킨다.',
    '- 공용 request 외 fetch는 별도 검토 대상이다. 자산 요청을 서버 API로 집계하지 않는다.', '',
    '```json',JSON.stringify({unresolved:result.unresolved,unsupportedServer:result.unsupportedServer,otherFetches:result.otherFetches,unreviewedFetches:result.unreviewedFetches},null,2),'```');
  return {result,markdown:lines.join('\n')+'\n'};
}
if (require.main === module) {
  const directory = path.resolve(process.argv[2] || '/tmp/phone-api-coverage');
  const {result,markdown} = report();
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'inventory.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(directory,'coverage.md'),markdown);
  console.log(`API ${result.endpoints.length}개, 미등록 ${result.endpoints.filter(e=>!e.scenarios.length).length}개. 실행 결과는 별도 확인.`);
  if (result.unresolved.length || result.unsupportedServer.length || result.unreviewedFetches.length || result.endpoints.some(e=>!e.server.length)) process.exitCode=1;
}
module.exports={report};
