const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const draft = require('./submission.json');
const cliEnv = { ...process.env, WRANGLER_LOG_SANITIZE: 'true', WRANGLER_SEND_METRICS: 'false' };

// 응답 키는 메모리로 받은 뒤 Cloudflare 서버의 비밀 환경 변수로 직접 전송한다.
// 키·응답 원문을 파일/명령행 인자/로그에 쓰지 않는다. 저장 실패 시 메모리를 유지한다.
async function main() {
  if (process.argv.slice(2).join(' ') !== '--agree')
    throw new Error('소유자의 이용약관·개인정보처리방침 동의를 확인한 뒤 --agree로 실행하세요.');
  const site = await fetch(draft.url, { signal: AbortSignal.timeout(15000) });
  if (!site.ok || !(await site.text()).includes('집중할고양'))
    throw new Error('공개 웹 배포 상태를 먼저 확인하세요.');
  const listed = spawnSync(
    'npx',
    ['--yes', 'wrangler@4.157.0', 'secret', 'list', '--name', 'cattus-web-api'],
    { encoding: 'utf8', env: cliEnv },
  );
  if (listed.status !== 0) throw new Error('서버 비밀 환경 변수 저장 권한을 먼저 확인하세요.');
  if (/METAMOA_REQUEST_KEY|METAMOA_SUBMISSION_ID|METAMOA_SUBMISSION_PENDING/.test(listed.stdout))
    throw new Error(
      '기존 신청 또는 불확실한 신청이 있습니다. 중복 제출하지 말고 상태를 확인하세요.',
    );
  const save = (values) =>
    spawnSync('npx', ['--yes', 'wrangler@4.157.0', 'secret', 'bulk', '--name', 'cattus-web-api'], {
      input: JSON.stringify(values),
      env: cliEnv,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).status === 0;
  if (!save({ METAMOA_SUBMISSION_PENDING: new Date().toISOString() }))
    throw new Error('서버 저장 사전 확인 실패');
  const response = await fetch('https://metamoa.com/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...draft, api_hookup: true, agree: true }),
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`접수 응답 HTTP ${response.status}. 자동 재제출하지 않습니다.`);
  const result = await response.json();
  if (
    typeof result.id !== 'string' ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(result.id) ||
    typeof result.request_key !== 'string' ||
    !result.request_key.startsWith('mm_req_')
  )
    throw new Error('접수 응답 형식 확인이 필요합니다. 재제출하지 마세요.');
  const values = { METAMOA_REQUEST_KEY: result.request_key, METAMOA_SUBMISSION_ID: result.id };
  while (!save(values)) {
    console.error(
      '서버 비밀 환경 변수 저장 실패. 키는 이 프로세스 메모리에 유지합니다. 종료하지 말고 연결 복구 후 Enter로 재시도하세요.',
    );
    const reader = createInterface({ input: process.stdin, output: process.stderr });
    await reader.question('');
    reader.close();
  }
  const status = await fetch(`https://metamoa.com/api/submit/${encodeURIComponent(result.id)}`, {
    headers: { Authorization: `Bearer ${result.request_key}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const data = status.ok ? await status.json() : {};
  console.log(
    JSON.stringify({
      id: result.id,
      status: data.status || 'submitted',
      key_saved: 'Cloudflare server secret',
      owner_check: `https://metamoa.com/owner?id=${encodeURIComponent(result.id)}`,
    }),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
